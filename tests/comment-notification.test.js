import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import("../configs/prisma.js");
const { initIO } = await import("../configs/socket.js");
const { createComment } = await import("../controllers/comment.controller.js");

function replace(t, object, key, value) {
  const original = object[key];
  object[key] = t.mock.fn(value);
  t.after(() => { object[key] = original; });
  return object[key];
}

test("comment notification links to the commented post", async (t) => {
  const events = [];
  initIO({
    to(room) {
      return { emit(event, payload) { events.push({ room, event, payload }); } };
    },
  });
  t.after(() => initIO(null));

  replace(t, prisma.comment, "create", async ({ data }) => ({
    id: "comment-1",
    ...data,
    user: { id: data.user_id, username: "alice", profile_image: null },
  }));
  replace(t, prisma.post, "findUnique", async () => ({
    author_id: "post-owner",
    title: "Linked post",
  }));
  replace(t, prisma.user, "findUnique", async () => ({ username: "alice" }));
  replace(t, prisma.notification, "create", async ({ data }) => ({
    id: "notification-1",
    ...data,
    created_at: new Date("2026-09-21T10:00:00.000Z"),
  }));
  replace(t, prisma.comment, "count", async () => 1);
  replace(t, prisma.achievement, "findMany", async () => []);

  const response = {};
  const res = {
    status(code) { response.status = code; return this; },
    json(body) { response.body = body; return this; },
  };

  await createComment({
    body: { post_id: "post-1", content: "Great post" },
    user: { id: "commenter-1" },
  }, res);

  assert.equal(response.status, 201);
  assert.equal(events.length, 1);
  assert.equal(events[0].room, "user:post-owner");
  assert.equal(events[0].event, "new_notification");
  assert.equal(events[0].payload.postId, "post-1");
  assert.equal(events[0].payload.actorId, "commenter-1");
  assert.equal(events[0].payload.link, "/post/post-1");
});

test("comment notification is persisted before responding while the post owner is offline", async (t) => {
  initIO(null);
  const order = [];

  replace(t, prisma.comment, "create", async ({ data }) => ({
    id: "comment-2",
    ...data,
    user: { id: data.user_id, username: "bob", profile_image: null },
  }));
  replace(t, prisma.post, "findUnique", async () => ({
    author_id: "offline-owner",
    title: "Offline post",
  }));
  replace(t, prisma.user, "findUnique", async () => ({ username: "bob" }));
  const createNotification = replace(t, prisma.notification, "create", async ({ data }) => {
    order.push("notification");
    return {
      id: "notification-2",
      ...data,
      created_at: new Date("2026-09-22T10:00:00.000Z"),
    };
  });
  replace(t, prisma.comment, "count", async () => 1);
  replace(t, prisma.achievement, "findMany", async () => []);

  const response = {};
  const res = {
    status(code) { response.status = code; return this; },
    json(body) {
      order.push("response");
      response.body = body;
      return this;
    },
  };

  await createComment({
    body: { post_id: "post-offline", content: "Saved while offline" },
    user: { id: "commenter-2" },
  }, res);

  assert.equal(response.status, 201);
  assert.deepEqual(order, ["notification", "response"]);
  assert.equal(createNotification.mock.callCount(), 1);
  assert.deepEqual(createNotification.mock.calls[0].arguments[0].data, {
    user_id: "offline-owner",
    type: "NEW_COMMENT",
    message: 'bob commented on your post "Offline post"',
    post_id: "post-offline",
    actor_id: "commenter-2",
    is_read: false,
  });
});
