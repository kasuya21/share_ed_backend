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
