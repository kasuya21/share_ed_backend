import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import("../configs/prisma.js");
const { initIO } = await import("../configs/socket.js");
const { joinOwnRoom } = await import("../middlewares/socket.middleware.js");
const { reportPost } = await import("../controllers/report.controller.js");
const { actionOnPost } = await import("../controllers/moderator.controller.js");

function replace(t, object, key, value) {
  const original = object[key];
  object[key] = t.mock.fn(value);
  t.after(() => { object[key] = original; });
  return object[key];
}

function responseRecorder() {
  const response = {};
  return {
    response,
    res: {
      status(code) { response.status = code; return this; },
      json(body) { response.body = body; return this; },
    },
  };
}

function socketRecorder(t) {
  const events = [];
  initIO({
    to(room) {
      return { emit(event, payload) { events.push({ room, event, payload }); } };
    },
  });
  t.after(() => initIO(null));
  return events;
}

test("only admin sockets join the protected admin room", () => {
  const adminRooms = [];
  const adminSocket = {
    data: { userId: "admin-1", role: "ADMIN" },
    join(room) { adminRooms.push(room); },
    on() {},
  };
  const moderatorRooms = [];
  const moderatorSocket = {
    data: { userId: "moderator-1", role: "MODERATOR" },
    join(room) { moderatorRooms.push(room); },
    on() {},
  };

  joinOwnRoom(adminSocket);
  joinOwnRoom(moderatorSocket);

  assert.deepEqual(adminRooms, ["user:admin-1", "role:admin"]);
  assert.deepEqual(moderatorRooms, ["user:moderator-1"]);
});

test("a new report broadcasts the complete updated post to reviewers", async (t) => {
  const events = socketRecorder(t);
  const reportedPost = {
    id: "post-1",
    title: "Reported post",
    post_status: "ACTIVE",
    reports: [{ id: "report-1", reason: "สแปม" }],
    author: { username: "author", email: "author@example.com" },
    _count: { reports: 10 },
  };
  let postLookup = 0;
  replace(t, prisma.post, "findUnique", async () => {
    postLookup += 1;
    return postLookup === 1
      ? { id: "post-1", title: "Reported post", author_id: "owner", post_status: "ACTIVE", _count: { reports: 9 } }
      : reportedPost;
  });
  replace(t, prisma.report, "findUnique", async () => null);
  replace(t, prisma.report, "create", async () => ({ id: "report-1" }));
  replace(t, prisma.post, "update", async () => ({ id: "post-1", post_status: "UNACTIVED" }));
  replace(t, prisma.user, "findMany", async () => []);
  replace(t, prisma.notification, "create", async ({ data }) => ({
    id: "notification-1",
    ...data,
    created_at: new Date("2026-09-24T00:00:00.000Z"),
  }));

  const { response, res } = responseRecorder();
  await reportPost({
    user: { id: "reporter-1" },
    body: { post_id: "post-1", reason: "สแปม" },
  }, res);

  assert.equal(response.status, 201);
  const reportEvent = events.find((entry) => entry.event === "report_created");
  assert.ok(reportEvent);
  assert.equal(reportEvent.room, "role:admin");
  assert.deepEqual(reportEvent.payload.post, reportedPost);
});

test("a moderation decision broadcasts an immediate badge update", async (t) => {
  const events = socketRecorder(t);
  replace(t, prisma.post, "findUnique", async () => ({
    id: "post-1",
    author_id: "owner-1",
    title: "Reported post",
  }));
  replace(t, prisma.post, "update", async () => ({ id: "post-1", post_status: "UNACTIVED" }));
  replace(t, prisma.notification, "create", async ({ data }) => ({
    id: "notification-1",
    ...data,
    created_at: new Date("2026-09-23T10:00:00.000Z"),
  }));

  const { response, res } = responseRecorder();
  await actionOnPost({ params: { post_id: "post-1" }, body: { action: "SUSPEND" } }, res);

  assert.equal(response.status, 200);
  const ownerNotification = events.find((entry) => entry.event === "new_notification");
  assert.ok(ownerNotification);
  assert.equal(ownerNotification.room, "user:owner-1");
  assert.equal(ownerNotification.payload.postId, "post-1");
  assert.match(ownerNotification.payload.message, /Reported post/);
  const moderationEvent = events.find((entry) => entry.event === "report_reviewed");
  assert.ok(moderationEvent);
  assert.equal(moderationEvent.room, "role:admin");
  assert.deepEqual(moderationEvent.payload, { postId: "post-1", action: "SUSPEND" });
});

test("a moderator can approve a reported post and clear its reports", async (t) => {
  const events = socketRecorder(t);
  replace(t, prisma.post, "findUnique", async () => ({
    id: "post-reported",
    author_id: "owner-1",
    title: "Reported post",
    post_status: "UNACTIVED",
  }));
  replace(t, prisma.report, "deleteMany", async () => ({ count: 1 }));
  const update = replace(t, prisma.post, "update", async () => ({
    id: "post-reported",
    post_status: "ACTIVE",
  }));
  replace(t, prisma, "$transaction", async (operations) => Promise.all(operations));

  const { response, res } = responseRecorder();
  await actionOnPost({
    params: { post_id: "post-reported" },
    body: { action: "APPROVE" },
  }, res);

  assert.equal(response.status, 200);
  assert.deepEqual(update.mock.calls[0].arguments[0].data, { post_status: "ACTIVE" });
  const reviewEvent = events.find((entry) => entry.event === "report_reviewed");
  assert.deepEqual(reviewEvent.payload, { postId: "post-reported", action: "APPROVE" });
});
