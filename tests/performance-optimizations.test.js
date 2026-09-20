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
  assert.equal(query.select.author.select.current_frame.select.image_url, true);
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

test("liking a post does not recount all author likes across all posts", async t => {
  const { toggleLike } = await import("../controllers/like.controller.js");
  replace(t, prisma.post, "findUnique", async () => ({ id: "post-1", author_id: "author-1", post_status: "ACTIVE" }));
  replace(t, prisma.like, "findUnique", async () => null);
  replace(t, prisma.like, "create", async () => ({ id: "like-1" }));
  const likeCount = replace(t, prisma.like, "count", async () => 0);
  replace(t, prisma.user, "findUnique", async () => ({ id: "user-1", username: "user" }));
  const achievementFind = replace(t, prisma.achievement, "findMany", async () => []);
  replace(t, prisma.notification, "create", async () => ({ id: "notif-1" }));

  const result = response();
  await toggleLike({ params: { postId: "post-1" }, user: { id: "user-1" } }, result.res);

  assert.equal(result.body.isLiked, true);
  assert.equal(likeCount.mock.callCount(), 0);
  assert.deepEqual(achievementFind.mock.calls[0].arguments[0].where, { achievement_type: "POST_LIKES" });
});

test("upload signature generation signs folder and timestamp", async () => {
  const { getUploadSignature } = await import("../controllers/post.controller.js");
  process.env.CLOUDINARY_API_KEY = "test-api-key";
  process.env.CLOUDINARY_API_SECRET = "test-api-secret";
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  const result = response();
  await getUploadSignature({ query: { type: "cover" }, user: { id: "user-1" } }, result.res);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.data.apiKey, "test-api-key");
  assert.equal(result.body.data.cloudName, "test-cloud");
  assert.equal(result.body.data.folder, "share-ed/users/user-1/posts/covers");
  assert.equal(result.body.data.uploadParams.allowed_formats, "jpg,jpeg,png,webp");
  assert.ok(typeof result.body.data.signature === "string");
  assert.ok(typeof result.body.data.timestamp === "number");
});

test("upload signature rejects unknown upload types", async () => {
  const { getUploadSignature } = await import("../controllers/post.controller.js");
  const result = response();
  await getUploadSignature({ query: { type: "video" } }, result.res);
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "INVALID_UPLOAD_TYPE");
});

test("batch upload signatures create an expiring session and scope every upload to it", async t => {
  const { getUploadSignatures } = await import("../controllers/post.controller.js");
  process.env.CLOUDINARY_API_KEY = "test-api-key";
  process.env.CLOUDINARY_API_SECRET = "test-api-secret";
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  const sessionCreate = replace(t, prisma.uploadSession, "create", async ({ data }) => data);
  const result = response();

  await getUploadSignatures({ body: { types: ["cover", "media", "pdf"] }, user: { id: "user-1" } }, result.res);

  assert.equal(result.status, 200);
  assert.match(result.body.data.sessionId, /^[a-f0-9-]{36}$/);
  assert.ok(Date.parse(result.body.data.expiresAt) > Date.now());
  assert.deepEqual(Object.keys(result.body.data.uploads), ["cover", "media", "pdf"]);
  const prefix = `share-ed/users/user-1/upload-sessions/${result.body.data.sessionId}`;
  assert.equal(result.body.data.uploads.cover.folder, `${prefix}/covers`);
  assert.equal(result.body.data.uploads.media.folder, `${prefix}/media`);
  assert.equal(result.body.data.uploads.pdf.folder, `${prefix}/pdfs`);
  assert.equal(result.body.data.uploads.cover.timestamp, result.body.data.uploads.pdf.timestamp);
  assert.match(result.body.data.uploads.media.uploadUrl, /\/image\/upload$/);
  assert.match(result.body.data.uploads.pdf.uploadUrl, /\/raw\/upload$/);
  assert.deepEqual(sessionCreate.mock.calls[0].arguments[0].data.requested_types, ["cover", "media", "pdf"]);
});

test("batch upload signatures reject invalid request shapes and upload types", async () => {
  const { getUploadSignatures } = await import("../controllers/post.controller.js");

  for (const types of [undefined, [], ["cover", "media", "pdf", "content", "cover"]]) {
    const result = response();
    await getUploadSignatures({ body: { types } }, result.res);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "INVALID_UPLOAD_TYPES");
  }

  const invalidType = response();
  await getUploadSignatures({ body: { types: ["cover", "video"] } }, invalidType.res);
  assert.equal(invalidType.status, 400);
  assert.equal(invalidType.body.code, "INVALID_UPLOAD_TYPE");
});



test("unknown category names cannot publish uncategorized posts", async t => {
  const { createPost } = await import("../controllers/post.controller.js");
  const lookup = replace(t, prisma.category, "findUnique", async () => null);
  const create = replace(t, prisma.post, "create", async () => { throw new Error("Must not save"); });
  const result = response();
  await createPost({user:{id:"user-1"},body:{post_status:"ACTIVE",title:"Title",summary:"Summary",education_level:"UNIVERSITY",category:"Unknown",cover_upload:{public_id:"cover"},media_uploads:[{public_id:"media"}]}},result.res);
  assert.equal(result.status,400);
  assert.deepEqual(lookup.mock.calls[0].arguments[0].where,{name:"Unknown"});
  assert.equal(create.mock.callCount(),0);
});

test("post creation retry returns the existing post for the same idempotency key", async t => {
  const { createPost } = await import("../controllers/post.controller.js");
  const existing = { id: "post-1", title: "Already created" };
  const findFirst = replace(t, prisma.post, "findFirst", async () => existing);
  const result = response();

  await createPost({
    user: { id: "user-1" },
    body: { idempotency_key: "retry-key-123456789" },
  }, result.res);

  assert.equal(result.status, 200);
  assert.equal(result.body.replayed, true);
  assert.equal(result.body.data, existing);
  assert.deepEqual(findFirst.mock.calls[0].arguments[0].where, {
    author_id: "user-1",
    idempotency_key: "retry-key-123456789",
  });
});
