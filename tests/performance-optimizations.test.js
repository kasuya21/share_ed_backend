import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-key";
const { prisma } = await import("../configs/prisma.js");
const { getAllPosts, getPlatformStats } = await import("../controllers/post.controller.js");
const { verifyAccessToken } = await import("../utils/auth-token.js");

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

test("post listing is paginated and omits detail-only content and media", async t => {
  const findMany = replace(t, prisma.post, "findMany", async () => [{ id: "post" }]);
  replace(t, prisma.post, "count", async () => 27);
  const result = response();

  await getAllPosts({ query: { page: "2", limit: "10" } }, result.res);

  const query = findMany.mock.calls[0].arguments[0];
  assert.equal(query.skip, 10);
  assert.equal(query.take, 10);
  assert.equal(query.select.content, undefined);
  assert.equal(query.select.media, undefined);
  assert.deepEqual(result.body.pagination, {
    page: 2, limit: 10, total: 27, totalPages: 3,
    hasNextPage: true, hasPreviousPage: true,
  });
});

test("post listing caps page size at 50", async t => {
  const findMany = replace(t, prisma.post, "findMany", async () => []);
  replace(t, prisma.post, "count", async () => 0);
  await getAllPosts({ query: { limit: "999999" } }, response().res);
  assert.equal(findMany.mock.calls[0].arguments[0].take, 50);
});

test("platform stat counts start concurrently", async t => {
  let resolvePosts;
  let resolveUsers;
  const postResult = new Promise(resolve => { resolvePosts = resolve; });
  const userResult = new Promise(resolve => { resolveUsers = resolve; });
  const postCount = replace(t, prisma.post, "count", () => postResult);
  const userCount = replace(t, prisma.user, "count", () => userResult);
  const result = response();

  const request = getPlatformStats({}, result.res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(postCount.mock.callCount(), 1);
  assert.equal(userCount.mock.callCount(), 1);
  resolvePosts(29);
  resolveUsers(35);
  await request;
  assert.deepEqual(result.body.data, { totalPosts: 29, totalSharers: 35 });
});

test("access token verification uses signed claims", async () => {
  const calls = [];
  const supabase = { auth: { getClaims: async token => {
    calls.push(token);
    return { data: { claims: { sub: "user-1", email: "user@example.com" } }, error: null };
  } } };
  const result = await verifyAccessToken(supabase, "signed-token");
  assert.deepEqual(calls, ["signed-token"]);
  assert.equal(result.user.id, "user-1");
});
