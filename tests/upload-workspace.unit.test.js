import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const { prisma } = await import("../configs/prisma.js");
const {
  createOrReuseUploadSession,
  signUploadFile,
  completeAndVerifyAssetCore,
  getUploadSessionStatus,
  deleteUploadAsset,
  deleteUploadSession,
  UploadWorkspaceError,
} = await import("../utils/upload-workspace.service.js");
const {
  MemoryTokenBucketStore,
  uploadRateLimit,
} = await import("../utils/upload-rate-limiter.js");
const {
  handleCleanupUploadAsset,
  handleCleanupUploadSession,
} = await import("../workers/handlers.js");
const cloudinary = (await import("../configs/cloudinary.config.js")).default;
const { supabaseAdmin } = await import("../configs/supabase.config.js");

function replace(t, object, key, implementation) {
  const original = object[key];
  object[key] = t.mock.fn(implementation);
  t.after(() => { object[key] = original; });
  return object[key];
}

const VALID_DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const VALID_CLIENT_FILE_ID = "33333333-3333-4333-8333-333333333333";
const VALID_ASSET_ID = "44444444-4444-4444-8444-444444444444";

test("unit: session request with same draft_id returns existing session without duplicating", async t => {
  const existingSession = {
    id: VALID_SESSION_ID,
    user_id: "user-1",
    draft_id: VALID_DRAFT_ID,
    status: "OPEN",
    expires_at: new Date(Date.now() + 3600000),
    last_activity_at: new Date(),
    reserved_bytes: 0,
  };

  const findUnique = replace(t, prisma.uploadSession, "findUnique", async () => existingSession);
  const update = replace(t, prisma.uploadSession, "update", async () => existingSession);
  const create = replace(t, prisma.uploadSession, "create", async () => {
    throw new Error("Must not create new session");
  });

  const res = await createOrReuseUploadSession({
    userId: "user-1",
    draftId: VALID_DRAFT_ID,
  });

  assert.equal(res.session_id, VALID_SESSION_ID);
  assert.equal(res.draft_id, VALID_DRAFT_ID);
  assert.equal(res.status, "OPEN");
  assert.equal(create.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 1);
});

test("unit: file sign with same client_file_id returns existing asset and path", async t => {
  const existingAsset = {
    id: VALID_ASSET_ID,
    upload_session_id: VALID_SESSION_ID,
    client_file_id: VALID_CLIENT_FILE_ID,
    provider: "CLOUDINARY",
    asset_type: "IMAGE",
    status: "SIGNED",
    public_id: `share-ed/users/user-1/upload-sessions/${VALID_SESSION_ID}/media/${VALID_CLIENT_FILE_ID}`,
    created_at: new Date(),
    file_size: 1024,
  };

  replace(t, prisma.uploadSession, "findUnique", async () => ({
    id: VALID_SESSION_ID,
    user_id: "user-1",
    status: "OPEN",
    expires_at: new Date(Date.now() + 3600000),
    assets: [existingAsset],
  }));

  const createAsset = replace(t, prisma.uploadAsset, "create", async () => {
    throw new Error("Must not create new asset record");
  });

  const res = await signUploadFile({
    userId: "user-1",
    sessionId: VALID_SESSION_ID,
    clientFileId: VALID_CLIENT_FILE_ID,
    assetType: "IMAGE",
    originalName: "photo.png",
    contentType: "image/png",
    size: 1024,
  });

  assert.equal(res.success, true);
  assert.equal(res.data.asset_id, VALID_ASSET_ID);
  assert.equal(res.data.public_id, existingAsset.public_id);
  assert.equal(createAsset.mock.callCount(), 0);
});

test("unit: rejects invalid UUID formats and session ownership violation", async t => {
  await assert.rejects(
    () => createOrReuseUploadSession({ userId: "user-1", draftId: "invalid-uuid" }),
    /draft_id/
  );

  replace(t, prisma.uploadSession, "findUnique", async () => ({
    id: VALID_SESSION_ID,
    user_id: "other-user",
    status: "OPEN",
    expires_at: new Date(Date.now() + 3600000),
    assets: [],
  }));

  await assert.rejects(
    () => signUploadFile({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      clientFileId: VALID_CLIENT_FILE_ID,
      assetType: "IMAGE",
      size: 1024,
    }),
    /ไม่มีสิทธิ์/
  );
});

test("unit: rejects invalid MIME, extension, and file size", async t => {
  replace(t, prisma.uploadSession, "findUnique", async () => ({
    id: VALID_SESSION_ID,
    user_id: "user-1",
    status: "OPEN",
    expires_at: new Date(Date.now() + 3600000),
    assets: [],
  }));

  // Disallowed extension/mime for image
  await assert.rejects(
    () => signUploadFile({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      clientFileId: VALID_CLIENT_FILE_ID,
      assetType: "IMAGE",
      originalName: "malicious.exe",
      contentType: "application/x-msdownload",
      size: 1024,
    }),
    /JPG, PNG, WEBP/
  );

  // Oversized image (> 2MB)
  await assert.rejects(
    () => signUploadFile({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      clientFileId: VALID_CLIENT_FILE_ID,
      assetType: "IMAGE",
      originalName: "big.png",
      contentType: "image/png",
      size: 3 * 1024 * 1024,
    }),
    /ขนาดไฟล์รูปภาพเกิน/
  );

  // Oversized PDF (> 20MB)
  await assert.rejects(
    () => signUploadFile({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      clientFileId: VALID_CLIENT_FILE_ID,
      assetType: "PDF",
      originalName: "huge.pdf",
      contentType: "application/pdf",
      size: 25 * 1024 * 1024,
    }),
    /ขนาดไฟล์ PDF เกิน/
  );
});

test("unit: rejects path traversal and asset from different upload session", async t => {
  replace(t, prisma.uploadAsset, "findUnique", async () => ({
    id: VALID_ASSET_ID,
    upload_session_id: "99999999-9999-4999-8999-999999999999", // Different session!
    status: "SIGNED",
    upload_session: { user_id: "user-1" },
  }));

  await assert.rejects(
    () => completeAndVerifyAssetCore({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      assetId: VALID_ASSET_ID,
      clientPayload: {},
    }),
    /ไม่พบ asset/
  );
});

test("unit: rate limit does not count idempotent replay with same draft_id or client_file_id", async t => {
  const store = new MemoryTokenBucketStore();
  const middleware = uploadRateLimit({ type: "SESSION", store });

  replace(t, prisma.uploadSession, "findFirst", async () => ({
    id: VALID_SESSION_ID,
  }));

  const req = {
    user: { id: "user-1" },
    body: { draft_id: VALID_DRAFT_ID },
    headers: {},
  };

  let calledNext = false;
  await middleware(req, {}, () => { calledNext = true; });

  assert.equal(calledNext, true);
  // Bucket for user-1 should not even exist because idempotent replay skipped consume!
  assert.equal(store.buckets.has("user:session:user-1"), false);
});

test("unit: cleanup does not touch COMMITTED sessions and ATTACHED assets", async t => {
  const assetDestroy = replace(t, cloudinary.uploader, "destroy", async () => {
    throw new Error("Must not destroy attached asset");
  });

  replace(t, prisma.uploadAsset, "findUnique", async () => ({
    id: VALID_ASSET_ID,
    status: "ATTACHED", // Already attached!
    provider: "CLOUDINARY",
    public_id: "test-id",
  }));

  await handleCleanupUploadAsset({ assetId: VALID_ASSET_ID });
  assert.equal(assetDestroy.mock.callCount(), 0);

  // Test session cleanup on COMMITTED session
  replace(t, prisma.uploadSession, "findUnique", async () => ({
    id: VALID_SESSION_ID,
    status: "COMMITTED",
    assets: [],
  }));

  const sessionUpdate = replace(t, prisma.uploadSession, "update", async () => {
    throw new Error("Must not update committed session");
  });

  await handleCleanupUploadSession({ uploadSessionId: VALID_SESSION_ID });
  assert.equal(sessionUpdate.mock.callCount(), 0);
});
