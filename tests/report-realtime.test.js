import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import("../configs/prisma.js");
const { initIO } = await import("../configs/socket.js");
const { joinOwnRoom } = await import("../middlewares/socket.middleware.js");
const { reportPost } = await import("../controllers/report.controller.js");
const { actionOnPost } = await import("../controllers/moderator.controller.js");
const { deletePostPermanently } = await import("../utils/post-deletion.js");
const { getBookmarks } = await import("../controllers/bookmark.controller.js");
const { requirePublishedPost } = await import("../middlewares/post-access.middleware.js");

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
    post_status: "UNACTIVED",
    reports: [{ id: "report-1", reason: "สแปม" }],
    author: { username: "author", email: "author@example.com" },
    _count: { reports: 5 },
  };
  replace(t, prisma, "$transaction", async (callback) => callback(prisma));
  replace(t, prisma, "$queryRaw", async () => [{ "?column?": 1 }]);
  let postLookup = 0;
  replace(t, prisma.post, "findUnique", async () => (++postLookup === 1)
    ? { id: "post-1", title: "Reported post", author_id: "owner", post_status: "ACTIVE" }
    : reportedPost);
  replace(t, prisma.report, "findUnique", async () => null);
  replace(t, prisma.report, "create", async () => ({ id: "report-1" }));
  replace(t, prisma.report, "count", async () => 5);
  const update = replace(t, prisma.post, "update", async () => ({ id: "post-1", post_status: "UNACTIVED" }));
  replace(t, prisma.user, "findMany", async () => [{ id: "admin-1" }]);
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
  assert.equal(response.body.reportCount, 5);
  assert.equal(response.body.postStatus, "UNACTIVED");
  assert.deepEqual(update.mock.calls[0].arguments[0].data, { post_status: "UNACTIVED" });
  const adminNotification = events.find((entry) => entry.event === "new_notification");
  assert.equal(adminNotification?.room, "user:admin-1");
  assert.equal(adminNotification.payload.type, "POST_REPORTED");
});

test("four unique reports keep the post active; a duplicate creates nothing", async (t) => {
  const events = socketRecorder(t);
  replace(t, prisma, "$transaction", async (callback) => callback(prisma));
  replace(t, prisma, "$queryRaw", async () => [{ "?column?": 1 }]);
  replace(t, prisma.post, "findUnique", async () => ({
    id: "post-1", title: "Reported post", post_status: "ACTIVE"
  }));
  let duplicate = false;
  replace(t, prisma.report, "findUnique", async () => duplicate ? { id: "old-report" } : null);
  const create = replace(t, prisma.report, "create", async () => ({ id: "report-4" }));
  replace(t, prisma.report, "count", async () => 4);
  const update = replace(t, prisma.post, "update", async () => ({}));

  const first = responseRecorder();
  await reportPost({ user: { id: "reporter-4" }, body: { post_id: "post-1", reason: "สแปม" } }, first.res);
  assert.equal(first.response.status, 201);
  assert.equal(first.response.body.reportCount, 4);
  assert.equal(first.response.body.postStatus, "ACTIVE");
  assert.equal(update.mock.callCount(), 0);

  duplicate = true;
  const second = responseRecorder();
  await reportPost({ user: { id: "reporter-4" }, body: { post_id: "post-1", reason: "สแปม" } }, second.res);
  assert.equal(second.response.status, 400);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(events.filter((event) => event.event === "report_created").length, 1);
});

test("a suspended post is rejected by public post access middleware", async (t) => {
  const lookup = replace(t, prisma.post, "findFirst", async () => null);
  const { response, res } = responseRecorder();
  let allowed = false;
  await requirePublishedPost((req) => req.params.id)(
    { params: { id: "post-1" } }, res, () => { allowed = true; }
  );
  assert.equal(response.status, 404);
  assert.equal(allowed, false);
  assert.deepEqual(lookup.mock.calls[0].arguments[0].where, {
    id: "post-1", post_status: "ACTIVE"
  });
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

test("permanent post deletion removes bookmarks and notifies affected users", async (t) => {
  const events = socketRecorder(t);
  replace(t, prisma.post, "findUnique", async () => ({
    id: "post-deleted",
    author_id: "owner-1",
    title: "Deleted post",
    cover_image: null,
    content: "",
    media: [],
  }));
  replace(t, prisma.like, "findMany", async () => []);
  replace(t, prisma.comment, "findMany", async () => []);
  replace(t, prisma.bookmark, "findMany", async () => [
    { user_id: "bookmark-user-1" },
    { user_id: "bookmark-user-2" },
  ]);
  const deleteBookmarks = replace(t, prisma.bookmark, "deleteMany", async () => ({ count: 2 }));
  const deletePost = replace(t, prisma.post, "delete", async () => ({ id: "post-deleted" }));
  replace(t, prisma, "$transaction", async (operations) => Promise.all(operations));
  replace(t, prisma.post, "count", async () => 0);
  replace(t, prisma.like, "count", async () => 0);
  replace(t, prisma.achievement, "findMany", async () => []);

  await deletePostPermanently("post-deleted");

  assert.deepEqual(deleteBookmarks.mock.calls[0].arguments[0], {
    where: { post_id: "post-deleted" },
  });
  assert.deepEqual(deletePost.mock.calls[0].arguments[0], {
    where: { id: "post-deleted" },
  });
  const deletedEvents = events.filter((entry) => entry.event === "post_deleted");
  assert.deepEqual(deletedEvents.map((entry) => entry.room).sort(), [
    "user:bookmark-user-1",
    "user:bookmark-user-2",
    "user:owner-1",
  ]);
  assert.ok(deletedEvents.every((entry) => entry.payload.postId === "post-deleted"));
});

test("bookmark lists never return deleted or inactive posts", async (t) => {
  const findMany = replace(t, prisma.bookmark, "findMany", async () => []);

  for (const idsOnly of [undefined, "true"]) {
    const { response, res } = responseRecorder();
    await getBookmarks({
      user: { id: "bookmark-user-1" },
      query: { ...(idsOnly && { idsOnly }) },
    }, res);
    assert.equal(response.status, 200);
  }

  assert.equal(findMany.mock.callCount(), 2);
  for (const call of findMany.mock.calls) {
    assert.deepEqual(call.arguments[0].where, {
      user_id: "bookmark-user-1",
      post: { post_status: "ACTIVE" },
    });
  }
});
