import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-key";
const { prisma } = await import("../configs/prisma.js");
const {
  getAllPosts,
  getPlatformStats,
  getTrendingPosts,
  recordPostView,
  trendingPostsCache,
} = await import("../controllers/post.controller.js");
const { verifyAccessToken } = await import("../utils/auth-token.js");
const { equipItem } = await import("../controllers/user.controller.js");
const { verifyUser } = await import("../controllers/auth.controller.js");
const { isAnimatedPng, rewardUploadOptions } = await import("../controllers/admin.reward.controller.js");

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
  const now = Math.floor(Date.now() / 1000);
  const supabase = { auth: { getClaims: async token => {
    calls.push(token);
    return { data: { claims: { sub: "user-1", email: "user@example.com", iat: now, exp: now + 3600 } }, error: null };
  } } };
  const result = await verifyAccessToken(supabase, "signed-token");
  assert.deepEqual(calls, ["signed-token"]);
  assert.equal(result.user.id, "user-1");
});

test("access tokens issued for longer than one hour are rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  const supabase = { auth: { getClaims: async () => ({
    data: { claims: { sub: "user-1", iat: now, exp: now + 7200 } },
    error: null,
  }) } };
  const result = await verifyAccessToken(supabase, "long-lived-token");
  assert.equal(result.user, null);
  assert.match(result.error.message, /lifetime/i);
});

test("auth me loads the current frame from the database", async t => {
  const user = {
    id: "user-1",
    email: "user@example.com",
    status: "ACTIVE",
    profile_image: null,
    profile_banner: null,
    wallpaper: null,
    social_links: null,
    current_frame_id: "frame-1",
    current_frame: { id: "frame-1", item_name: "Frame 1" },
  };
  const findUnique = replace(t, prisma.user, "findUnique", async () => user);
  const result = response();

  await verifyUser({
    user: { id: "user-1", email: "user@example.com", user_metadata: {} },
  }, result.res);

  const query = findUnique.mock.calls[0].arguments[0];
  assert.equal(query.include.current_frame, true);
  assert.equal(result.body.current_frame_id, "frame-1");
  assert.deepEqual(result.body.current_frame, user.current_frame);
});

test("liking a post synchronizes exact achievement totals for both users", async t => {
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
  assert.equal(likeCount.mock.callCount(), 2);
  const achievementTypes = achievementFind.mock.calls.map(
    call => call.arguments[0].where.achievement_type
  );
  assert.deepEqual(achievementTypes.sort(), ["LIKES_GIVEN", "POST_LIKES"].sort());
});

test("equipping a frame rejects an inactive unlocked item", async t => {
  replace(t, prisma.userUnlockedItem, "findFirst", async () => ({
    item: { item_type: "FRAME", is_active: false },
  }));
  const update = replace(t, prisma.user, "update", async () => ({}));
  const result = response();

  await equipItem({
    user: { id: "user-1" },
    body: { itemId: "frame-inactive", type: "FRAME" },
  }, result.res);

  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  assert.equal(update.mock.callCount(), 0);
});

test("equipping a frame returns the database-backed equipped state", async t => {
  replace(t, prisma.userUnlockedItem, "findFirst", async () => ({
    item: { item_type: "FRAME", is_active: true },
  }));
  const equippedState = {
    current_frame_id: "frame-1",
    current_frame: { id: "frame-1", item_name: "Frame 1" },
  };
  const update = replace(t, prisma.user, "update", async () => equippedState);
  const result = response();

  await equipItem({
    user: { id: "user-1" },
    body: { itemId: "frame-1", type: "FRAME" },
  }, result.res);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, equippedState);
  assert.deepEqual(update.mock.calls[0].arguments[0].where, { id: "user-1" });
  assert.deepEqual(update.mock.calls[0].arguments[0].data, { current_frame_id: "frame-1" });
});

test("animated reward PNGs use raw Cloudinary storage to preserve every frame", () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const animationChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 8]),
    Buffer.from("acTL"),
    Buffer.alloc(8),
    Buffer.alloc(4),
  ]);
  const animatedPng = Buffer.concat([signature, animationChunk]);

  assert.equal(isAnimatedPng(animatedPng), true);
  const options = rewardUploadOptions(animatedPng, "share-ed/rewards");
  assert.equal(options.folder, "share-ed/rewards");
  assert.equal(options.resource_type, "raw");
  assert.match(options.public_id, /^[0-9a-f-]+\.png$/);
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
  assert.equal(result.body.data.uploadParams.allowed_formats, "jpg,jpeg,png,webp,apng");
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

test("trending ranks unique viewers inside the requested recent window", async t => {
  trendingPostsCache.clear();
  const groupBy = replace(t, prisma.postView, "groupBy", async () => [
    { post_id: "post-2", _count: { post_id: 7 } },
    { post_id: "post-1", _count: { post_id: 4 } },
  ]);
  const findMany = replace(t, prisma.post, "findMany", async () => [
    { id: "post-1", title: "One" },
    { id: "post-2", title: "Two" },
  ]);
  const result = response();
  const before = Date.now() - 24 * 60 * 60 * 1000;

  await getTrendingPosts({ query: { window: "24h", limit: "10", level: "UNIVERSITY" } }, result.res);

  const query = groupBy.mock.calls[0].arguments[0];
  assert.equal(query.take, 10);
  assert.equal(query.where.post.education_level, "UNIVERSITY");
  assert.ok(query.where.viewed_at.gte.getTime() >= before);
  assert.deepEqual(findMany.mock.calls[0].arguments[0].where.id.in, ["post-2", "post-1"]);
  assert.deepEqual(result.body.data.map(post => [post.id, post.recent_view_count]), [
    ["post-2", 7],
    ["post-1", 4],
  ]);
  assert.equal(result.body.meta.window, "24h");
  assert.equal(result.body.meta.fallback, null);
});

test("trending validates window and limit before querying", async t => {
  trendingPostsCache.clear();
  const groupBy = replace(t, prisma.postView, "groupBy", async () => []);
  for (const query of [{ window: "1y" }, { limit: "0" }, { limit: "many" }]) {
    const result = response();
    await getTrendingPosts({ query }, result.res);
    assert.equal(result.status, 400);
  }
  assert.equal(groupBy.mock.callCount(), 0);
});

test("trending falls back to latest active posts when the window has no views", async t => {
  trendingPostsCache.clear();
  replace(t, prisma.postView, "groupBy", async () => []);
  const findMany = replace(t, prisma.post, "findMany", async () => [{ id: "new-post" }]);
  const result = response();

  await getTrendingPosts({ query: { window: "7d", limit: "5" } }, result.res);

  const query = findMany.mock.calls[0].arguments[0];
  assert.deepEqual(query.orderBy, { created_at: "desc" });
  assert.equal(query.take, 5);
  assert.equal(result.body.data[0].recent_view_count, 0);
  assert.equal(result.body.meta.fallback, "latest_posts");
});

test("repeat views refresh recency without increasing lifetime view count", async t => {
  const viewedAt = new Date("2026-09-22T00:00:00.000Z");
  replace(t, prisma.postView, "findUnique", async () => ({ id: "view-1" }));
  const update = replace(t, prisma.postView, "update", async () => ({}));
  const create = replace(t, prisma.postView, "create", async () => { throw new Error("must not create"); });
  const postUpdate = replace(t, prisma.post, "update", async () => { throw new Error("must not increment"); });

  const result = await recordPostView("user-1", "post-1", viewedAt);

  assert.deepEqual(result, { created: false });
  assert.deepEqual(update.mock.calls[0].arguments[0], {
    where: { id: "view-1" },
    data: { viewed_at: viewedAt },
  });
  assert.equal(create.mock.callCount(), 0);
  assert.equal(postUpdate.mock.callCount(), 0);
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
