import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-key";

const { prisma } = await import("../configs/prisma.js");
const { supabase } = await import("../configs/supabase.config.js");
const { registerUser, verifyUser } = await import("../controllers/auth.controller.js");
const { DEFAULT_AVATAR_URL } = await import("../utils/avatar.js");

function replace(t, object, key, implementation) {
  const original = object[key];
  object[key] = t.mock.fn(implementation);
  t.after(() => { object[key] = original; });
  return object[key];
}

function response() {
  const result = {};
  result.res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  return result;
}

test("email registration saves the shared default avatar", async t => {
  replace(t, prisma.user, "findUnique", async () => null);
  const signUp = replace(t, supabase.auth, "signUp", async () => ({
    data: { user: { id: "new-user" }, session: null }, error: null,
  }));
  const create = replace(t, prisma.user, "create", async ({ data }) => data);
  const result = response();

  await registerUser({ body: {
    email: "new@example.com", username: "new-user", password: "Password123",
    confirmPassword: "Password123", education_level: "UNIVERSITY",
  } }, result.res);

  assert.equal(result.status, 201);
  assert.equal(signUp.mock.calls[0].arguments[0].options.data.avatar_url, DEFAULT_AVATAR_URL);
  assert.equal(create.mock.calls[0].arguments[0].data.profile_image, DEFAULT_AVATAR_URL);
  assert.equal(result.body.data.profile_image, DEFAULT_AVATAR_URL);
});

test("current user response supplies an avatar for a legacy account without one", async t => {
  replace(t, prisma.user, "findUnique", async () => ({
    id: "existing-user", status: "ACTIVE", profile_image: null,
  }));
  const result = response();

  await verifyUser({ user: { id: "existing-user", user_metadata: {} } }, result.res);

  assert.equal(result.body.profile_image, DEFAULT_AVATAR_URL);
  assert.equal(result.body.avatar_url, DEFAULT_AVATAR_URL);
});
