import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-key";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import("../configs/prisma.js");
const { supabase } = await import("../configs/supabase.config.js");
const adminRouter = (await import("../routers/admin.router.js")).default;

function mock(t, object, key, implementation) {
  const original = object[key];
  object[key] = t.mock.fn(implementation);
  t.after(() => { object[key] = original; });
  return object[key];
}

async function createRequest(t, aal = "aal2", sessionOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  mock(t, supabase.auth, "getClaims", async () => ({
    data: {
      claims: {
        sub: "admin-1",
        aal,
        session_id: "22222222-2222-4222-8222-222222222222",
        iat: now,
        exp: now + 3600,
      }
    },
    error: null,
  }));
  mock(t, prisma, "$queryRaw", async () => [{
    created_at_epoch: now - 60,
    refreshed_at_epoch: now - 60,
    not_after_epoch: null,
    ...sessionOverrides,
  }]);
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: "PATCH",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("role changes require an AAL2 Supabase session when MFA enforcement is enabled", async t => {
  const previousValue = process.env.REQUIRE_MFA_FOR_ROLE_CHANGES;
  process.env.REQUIRE_MFA_FOR_ROLE_CHANGES = "true";

  t.after(() => {
    if (previousValue === undefined) {
      delete process.env.REQUIRE_MFA_FOR_ROLE_CHANGES;
    } else {
      process.env.REQUIRE_MFA_FOR_ROLE_CHANGES = previousValue;
    }
  });

  mock(t, prisma.user, "findUnique", async () => ({
    id: "admin-1",
    status: "ACTIVE",
    role: "ADMIN"
  }));

  const request = await createRequest(t, "aal1");
  const response = await request("/admin/users/member-1/role", {
    role: "ADMIN"
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "MFA_REQUIRED");
});

test("admins cannot change their own role", async t => {
  mock(t, prisma.user, "findUnique", async () => ({ id: "admin-1", status: "ACTIVE", role: "ADMIN" }));
  const request = await createRequest(t);
  const response = await request("/admin/users/admin-1/role", { role: "MEMBER" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "SELF_ROLE_CHANGE_FORBIDDEN");
});

test("role update and security audit are committed together", async t => {
  mock(t, prisma.user, "findUnique", async ({ where }) => where.id === "admin-1"
    ? { id: "admin-1", status: "ACTIVE", role: "ADMIN" }
    : { id: "member-1", username: "member", email: "member@example.com", status: "ACTIVE", role: "MEMBER" });
  const update = t.mock.fn(async () => ({ id: "member-1", role: "ADMIN" }));
  const audit = t.mock.fn(async () => ({}));
  mock(t, prisma, "$transaction", async callback => callback({
    user: { update },
    adminSecurityAudit: { create: audit },
  }));
  const request = await createRequest(t);
  const response = await request("/admin/users/member-1/role", { role: "ADMIN" });
  assert.equal(response.status, 200);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(audit.mock.callCount(), 1);
  const data = audit.mock.calls[0].arguments[0].data;
  assert.equal(data.actor_id, "admin-1");
  assert.equal(data.target_user_id, "member-1");
  assert.equal(data.old_value, "MEMBER");
  assert.equal(data.new_value, "ADMIN");
});

test("admin sessions older than twelve hours require a new login", async t => {
  mock(t, prisma.user, "findUnique", async () => ({ id: "admin-1", status: "ACTIVE", role: "ADMIN" }));
  const now = Math.floor(Date.now() / 1000);
  const request = await createRequest(t, "aal2", {
    created_at_epoch: now - (12 * 60 * 60) - 1,
  });
  const response = await request("/admin/users/member-1/role", { role: "ADMIN" });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "ADMIN_REAUTHENTICATION_REQUIRED");
});

test("deleteAchievement cascades user progress and associated reward frame deletion in transaction", async t => {
  const existing = {
    id: "ach-1",
    title: "Test Achievement",
    reward_item_id: "reward-1",
    reward_item: {
      id: "reward-1",
      item_name: "Diamond Frame",
      item_type: "FRAME",
      image_url: "https://res.cloudinary.com/test/image/upload/v123/frame.png",
    },
  };
  mock(t, prisma.achievement, "findUnique", async () => existing);
  mock(t, prisma.achievement, "count", async () => 0); // No other achievements using this reward

  let deletedUserAchievementsWhere = null;
  let deletedAchievementWhere = null;
  let deletedRewardWhere = null;
  let deletedUnlockedItemsWhere = null;
  let updatedUsersFrame = null;

  mock(t, prisma, "$transaction", async (operations) => Promise.all(operations));
  mock(t, prisma.userAchievement, "deleteMany", async ({ where }) => {
    deletedUserAchievementsWhere = where;
    return { count: 3 };
  });
  mock(t, prisma.achievement, "delete", async ({ where }) => {
    deletedAchievementWhere = where;
    return existing;
  });
  mock(t, prisma.user, "updateMany", async ({ where, data }) => {
    if (where.current_frame_id) updatedUsersFrame = { where, data };
    return { count: 1 };
  });
  mock(t, prisma.userUnlockedItem, "deleteMany", async ({ where }) => {
    deletedUnlockedItemsWhere = where;
    return { count: 2 };
  });
  mock(t, prisma.rewardItem, "delete", async ({ where }) => {
    deletedRewardWhere = where;
    return existing.reward_item;
  });

  const req = { params: { id: "ach-1" } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };

  const { deleteAchievement } = await import("../controllers/admin.achievement.controller.js");
  await deleteAchievement(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(deletedUserAchievementsWhere, { achievement_id: "ach-1" });
  assert.deepEqual(deletedAchievementWhere, { id: "ach-1" });
  assert.deepEqual(deletedRewardWhere, { id: "reward-1" });
  assert.deepEqual(deletedUnlockedItemsWhere, { item_id: "reward-1" });
  assert.deepEqual(updatedUsersFrame, {
    where: { current_frame_id: "reward-1" },
    data: { current_frame_id: null },
  });
});
