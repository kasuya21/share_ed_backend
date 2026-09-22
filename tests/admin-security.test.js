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

async function createRequest(t, aal = "aal2") {
  mock(t, supabase.auth, "getClaims", async () => ({
    data: { claims: { sub: "admin-1", aal } },
    error: null,
  }));
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

test("role changes require an AAL2 Supabase session", async t => {
  mock(t, prisma.user, "findUnique", async () => ({ id: "admin-1", status: "ACTIVE", role: "ADMIN" }));
  const request = await createRequest(t, "aal1");
  const response = await request("/admin/users/member-1/role", { role: "ADMIN" });
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
