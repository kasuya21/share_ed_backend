import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import("../configs/prisma.js");
const { initIO } = await import("../configs/socket.js");
const {
  createLikeNotification,
  removeLikeNotification,
  formatNotification,
} = await import("../utils/notification.helper.js");
const { toggleLike } = await import("../controllers/like.controller.js");

function replace(t, object, key, value) {
  const original = object[key];
  object[key] = t.mock.fn(value);
  t.after(() => { object[key] = original; });
  return object[key];
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

const actor = { id: "actor", username: "alice", profile_image: "avatar.jpg" };
const stored = {
  id: "notification-1",
  type: "LIKE",
  user_id: "recipient",
  actor_id: "actor",
  post_id: "post-1",
  message: "alice ถูกใจโพสต์ของคุณ",
  is_read: false,
  created_at: new Date("2026-09-17T10:00:00.000Z"),
  actor,
};

test("like notification emits the complete frontend contract once", async (t) => {
  const events = socketRecorder(t);
  replace(t, prisma.user, "findUnique", async () => actor);
  replace(t, prisma.notification, "create", async () => stored);

  const result = await createLikeNotification({ recipientId: "recipient", actorId: "actor", postId: "post-1" });

  assert.equal(result.id, "notification-1");
  assert.equal(events.length, 1);
  assert.equal(events[0].room, "user:recipient");
  assert.equal(events[0].event, "new_notification");
  assert.deepEqual(events[0].payload.actor, { id: "actor", username: "alice", avatarUrl: "avatar.jpg" });
  assert.equal(events[0].payload.recipientId, "recipient");
  assert.equal(events[0].payload.actorId, "actor");
  assert.equal(events[0].payload.postId, "post-1");
  assert.equal(events[0].payload.link, "/post/post-1");
});

test("duplicate like returns the existing row without a duplicate socket event", async (t) => {
  const events = socketRecorder(t);
  replace(t, prisma.user, "findUnique", async () => actor);
  replace(t, prisma.notification, "create", async () => { throw Object.assign(new Error("duplicate"), { code: "P2002" }); });
  replace(t, prisma.notification, "findFirst", async () => stored);

  const result = await createLikeNotification({ recipientId: "recipient", actorId: "actor", postId: "post-1" });

  assert.equal(result.id, "notification-1");
  assert.equal(events.length, 0);
});

test("unlike deletes only its like identity and emits notification_removed", async (t) => {
  const events = socketRecorder(t);
  replace(t, prisma.notification, "findFirst", async () => ({ id: "notification-1" }));
  const remove = replace(t, prisma.notification, "deleteMany", async () => ({ count: 1 }));

  const result = await removeLikeNotification({ recipientId: "recipient", actorId: "actor", postId: "post-1" });

  assert.deepEqual(remove.mock.calls[0].arguments[0].where, {
    user_id: "recipient", actor_id: "actor", post_id: "post-1", type: "LIKE",
  });
  assert.equal(result.reason, "UNLIKE");
  assert.equal(events[0].event, "notification_removed");
  assert.equal(events[0].payload.notificationId, "notification-1");
});

test("self-like never creates a notification", async (t) => {
  const create = replace(t, prisma.notification, "create", async () => stored);
  const result = await createLikeNotification({ recipientId: "same", actorId: "same", postId: "post-1" });
  assert.equal(result, null);
  assert.equal(create.mock.callCount(), 0);
});

test("legacy notifications remain readable during the NEW_LIKE transition", () => {
  const legacy = formatNotification({
    id: "old", type: "NEW_LIKE", user_id: "recipient", actor_id: null,
    post_id: "post-1", message: "legacy", is_read: true, created_at: new Date(),
  });
  assert.equal(legacy.type, "NEW_LIKE");
  assert.equal(legacy.actorId, null);
  assert.equal(legacy.title, "มีคนถูกใจโพสต์ของคุณ");
});

test("toggle Like, Unlike and re-Like keeps database and socket state aligned", async (t) => {
  const events = socketRecorder(t);
  let liked = false;
  let notification = null;
  let sequence = 0;

  replace(t, prisma.post, "findUnique", async () => ({ id: "post-1", author_id: "recipient", post_status: "ACTIVE" }));
  replace(t, prisma.post, "findMany", async () => [{ id: "post-1" }]);
  replace(t, prisma.like, "findUnique", async () => liked ? { id: "like-1" } : null);
  replace(t, prisma.like, "create", async () => { liked = true; return { id: "like-1" }; });
  replace(t, prisma.like, "deleteMany", async () => { liked = false; return { count: 1 }; });
  replace(t, prisma.like, "count", async () => liked ? 1 : 0);
  replace(t, prisma.user, "findUnique", async () => actor);
  replace(t, prisma.achievement, "findMany", async () => []);
  replace(t, prisma.notification, "create", async ({ data }) => {
    notification = { ...stored, ...data, id: `notification-${++sequence}`, created_at: new Date(), actor };
    return notification;
  });
  replace(t, prisma.notification, "findFirst", async () => notification ? { id: notification.id } : null);
  replace(t, prisma.notification, "deleteMany", async () => { notification = null; return { count: 1 }; });

  const run = async () => {
    const result = {};
    const res = {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
    };
    await toggleLike({ params: { postId: "post-1" }, user: { id: "actor" } }, res);
    return result;
  };

  assert.equal((await run()).body.isLiked, true);
  assert.equal((await run()).body.isLiked, false);
  assert.equal((await run()).body.isLiked, true);
  assert.deepEqual(events.map(({ event }) => event), [
    "new_notification", "notification_removed", "new_notification",
  ]);
  assert.equal(events[0].payload.notificationId, undefined);
  assert.notEqual(events[0].payload.id, events[2].payload.id);
});
