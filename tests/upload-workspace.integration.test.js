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
} = await import("../utils/upload-workspace.service.js");
const { createPost } = await import("../controllers/post.controller.js");
const { claimNextJob, enqueueJob, completeJob } = await import("../utils/job-queue.js");
const cloudinary = (await import("../configs/cloudinary.config.js")).default;
const { supabaseAdmin } = await import("../configs/supabase.config.js");

function replace(t, object, key, implementation) {
  const original = object[key];
  object[key] = t.mock.fn(implementation);
  t.after(() => { object[key] = original; });
  return object[key];
}

function response() {
  const result = { headers: {} };
  result.res = {
    setHeader(name, value) { result.headers[name] = value; return this; },
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  return result;
}

const VALID_DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const VALID_SESSION_ID = "66666666-6666-4666-8666-666666666666";
const COVER_CLIENT_ID = "77777777-7777-4777-8777-777777777777";
const PDF_CLIENT_ID = "88888888-8888-4888-8888-888888888888";
const COVER_ASSET_ID = "99999999-9999-4999-8999-999999999999";
const PDF_ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("integration: end-to-end upload workspace flow (session -> sign -> complete -> verified -> create post)", async t => {
  // Mock DB stores
  const session = {
    id: VALID_SESSION_ID,
    user_id: "user-1",
    draft_id: VALID_DRAFT_ID,
    status: "OPEN",
    expires_at: new Date(Date.now() + 7200000),
    last_activity_at: new Date(),
    reserved_bytes: 0,
    assets: [],
  };

  const assets = new Map();

  replace(t, prisma.uploadSession, "findUnique", async ({ where }) => {
    if (where.id === VALID_SESSION_ID) {
      return { ...session, assets: Array.from(assets.values()) };
    }
    return null;
  });

  replace(t, prisma.uploadSession, "update", async ({ data }) => {
    Object.assign(session, data);
    return session;
  });

  replace(t, prisma.uploadAsset, "create", async ({ data }) => {
    assets.set(data.id, { ...data, created_at: new Date() });
    return assets.get(data.id);
  });

  replace(t, prisma.uploadAsset, "findUnique", async ({ where }) => {
    const a = assets.get(where.id);
    return a ? { ...a, upload_session: session } : null;
  });

  replace(t, prisma.uploadAsset, "updateMany", async ({ where, data }) => {
    let count = 0;
    for (const [id, a] of assets) {
      if (where.id === id || (where.id?.in && where.id.in.includes(id))) {
        Object.assign(a, data);
        count++;
      }
    }
    return { count };
  });

  replace(t, prisma.uploadAsset, "update", async ({ where, data }) => {
    const a = assets.get(where.id);
    if (a) Object.assign(a, data);
    return a;
  });

  // Mock Cloudinary signing & verify
  replace(t, cloudinary.utils, "verify_api_response_signature", () => true);
  replace(t, cloudinary.api, "resource", async () => ({
    bytes: 1024,
    format: "png",
    secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v123/share-ed/users/user-1/upload-sessions/${VALID_SESSION_ID}/covers/${COVER_CLIENT_ID}.png`,
  }));

  // Mock Supabase storage
  replace(t, supabaseAdmin.storage, "from", () => ({
    createSignedUploadUrl: async () => ({
      data: { token: "signed-token", signedUrl: "https://supabase.co/upload" },
      error: null,
    }),
    info: async () => ({
      data: { size: 5000, contentType: "application/pdf" },
      error: null,
    }),
    download: async () => ({
      data: Buffer.from("%PDF-1.4"),
      error: null,
    }),
  }));

  // 1. Sign Cover Image
  const coverSign = await signUploadFile({
    userId: "user-1",
    sessionId: VALID_SESSION_ID,
    clientFileId: COVER_CLIENT_ID,
    assetType: "COVER",
    originalName: "cover.png",
    contentType: "image/png",
    size: 1024,
  });
  assert.equal(coverSign.success, true);
  const coverAssetId = coverSign.data.asset_id;

  // 2. Sign PDF File
  const pdfSign = await signUploadFile({
    userId: "user-1",
    sessionId: VALID_SESSION_ID,
    clientFileId: PDF_CLIENT_ID,
    assetType: "PDF",
    originalName: "paper.pdf",
    contentType: "application/pdf",
    size: 5000,
  });
  assert.equal(pdfSign.success, true);
  const pdfAssetId = pdfSign.data.asset_id;

  // 3. Complete and Verify Cover Image
  const verifiedCover = await completeAndVerifyAssetCore({
    userId: "user-1",
    sessionId: VALID_SESSION_ID,
    assetId: coverAssetId,
    clientPayload: {
      public_id: `share-ed/users/user-1/upload-sessions/${VALID_SESSION_ID}/covers/${COVER_CLIENT_ID}`,
      version: 123,
      signature: "valid-sig",
      secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v123/share-ed/users/user-1/upload-sessions/${VALID_SESSION_ID}/covers/${COVER_CLIENT_ID}.png`,
      resource_type: "image",
      format: "png",
      bytes: 1024,
    },
  });
  assert.equal(verifiedCover.status, "VERIFIED");

  // 4. Complete and Verify PDF File
  const verifiedPdf = await completeAndVerifyAssetCore({
    userId: "user-1",
    sessionId: VALID_SESSION_ID,
    assetId: pdfAssetId,
    clientPayload: {
      bucket: "post-pdfs",
      path: `users/user-1/upload-sessions/${VALID_SESSION_ID}/${PDF_CLIENT_ID}.pdf`,
    },
  });
  assert.equal(verifiedPdf.status, "VERIFIED");

  // 5. Create Post using Verified Assets
  // Spy on Cloudinary and Supabase to PROVE that Create Post does NOT call provider APIs!
  const cloudinaryResourceSpy = replace(t, cloudinary.api, "resource", async () => {
    throw new Error("Create Post must NOT call Cloudinary API for verified assets!");
  });
  const supabaseInfoSpy = replace(t, supabaseAdmin.storage, "from", () => {
    throw new Error("Create Post must NOT call Supabase Storage API for verified assets!");
  });

  replace(t, prisma.category, "findUnique", async () => ({ id: "cat-1", name: "Science" }));
  replace(t, prisma.tag, "findMany", async () => []);
  replace(t, prisma.post, "findFirst", async () => null);

  let committedSession = false;
  replace(t, prisma, "$transaction", async callback => {
    const tx = {
      uploadSession: {
        findUnique: async () => ({ ...session }),
        updateMany: async ({ where, data }) => {
          if (data.status === "COMMITTED") committedSession = true;
          return { count: 1 };
        },
      },
      uploadAsset: {
        findMany: async () => Array.from(assets.values()),
        updateMany: async () => ({ count: assets.size }),
      },
      post: {
        create: async ({ data }) => ({
          id: "new-post-1",
          ...data,
          author: { id: "user-1", username: "testuser" },
          media: data.media.create,
        }),
      },
    };
    return callback(tx);
  });

  const res = response();
  await createPost(
    {
      user: { id: "user-1" },
      body: {
        title: "Introduction to Biology",
        summary: "Comprehensive guide for biology",
        content: "Detailed markdown content...",
        category_id: "cat-1",
        education_level: "UNIVERSITY",
        post_status: "ACTIVE",
        upload_session_id: VALID_SESSION_ID,
        cover_asset_id: coverAssetId,
        media_asset_ids: [pdfAssetId],
        idempotency_key: "0123456789abcdef0123456789abcdef",
      },
    },
    res.res
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.title, "Introduction to Biology");
  assert.ok(res.body.data.id);
  assert.equal(committedSession, true);
  assert.equal(cloudinaryResourceSpy.mock.callCount(), 0);
  assert.equal(supabaseInfoSpy.mock.callCount(), 0);
  assert.ok(res.headers["Server-Timing"]?.includes("create_post_transaction"));
});

test("integration: Cloudinary verification rejects forged signature and mismatched folder", async t => {
  replace(t, prisma.uploadAsset, "findUnique", async () => ({
    id: COVER_ASSET_ID,
    upload_session_id: VALID_SESSION_ID,
    status: "SIGNED",
    provider: "CLOUDINARY",
    upload_session: { user_id: "user-1" },
  }));
  replace(t, prisma.uploadAsset, "updateMany", async () => ({ count: 1 }));
  replace(t, prisma.uploadAsset, "update", async () => ({}));

  // Mismatched folder test
  await assert.rejects(
    () => completeAndVerifyAssetCore({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      assetId: COVER_ASSET_ID,
      clientPayload: {
        public_id: "share-ed/users/attacker/upload-sessions/other-session/covers/file-1",
        version: 123,
        signature: "fake-sig",
        secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v123/file.png",
      },
    }),
    /โฟลเดอร์/
  );

  // Forged signature test
  replace(t, cloudinary.utils, "verify_api_response_signature", () => false);
  await assert.rejects(
    () => completeAndVerifyAssetCore({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      assetId: COVER_ASSET_ID,
      clientPayload: {
        public_id: `share-ed/users/user-1/upload-sessions/${VALID_SESSION_ID}/covers/file-1`,
        version: 123,
        signature: "forged-sig",
        secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v123/file.png",
      },
    }),
    /ลายเซ็นตอบกลับ/
  );
});

test("integration: Supabase PDF verification rejects invalid magic bytes and oversized file", async t => {
  const validStoragePath = `users/user-1/upload-sessions/${VALID_SESSION_ID}/${PDF_CLIENT_ID}.pdf`;
  replace(t, prisma.uploadAsset, "findUnique", async () => ({
    id: PDF_ASSET_ID,
    upload_session_id: VALID_SESSION_ID,
    status: "SIGNED",
    provider: "SUPABASE",
    storage_path: validStoragePath,
    upload_session: { user_id: "user-1" },
  }));
  replace(t, prisma.uploadAsset, "updateMany", async () => ({ count: 1 }));
  replace(t, prisma.uploadAsset, "update", async () => ({}));

  // 1. Oversized PDF (> 20MB)
  replace(t, supabaseAdmin.storage, "from", () => ({
    info: async () => ({
      data: { size: 21 * 1024 * 1024, contentType: "application/pdf" },
      error: null,
    }),
    download: async () => ({ data: Buffer.from("%PDF-"), error: null }),
  }));

  await assert.rejects(
    () => completeAndVerifyAssetCore({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      assetId: PDF_ASSET_ID,
      clientPayload: {
        bucket: "post-pdfs",
        path: validStoragePath,
      },
    }),
    /PDF เกิน 20 MB/
  );

  // 2. Corrupt / invalid magic bytes (e.g. text file pretending to be PDF)
  replace(t, supabaseAdmin.storage, "from", () => ({
    info: async () => ({
      data: { size: 1024, contentType: "application/pdf" },
      error: null,
    }),
    download: async () => ({ data: Buffer.from("NOT_A_PDF"), error: null }),
  }));

  await assert.rejects(
    () => completeAndVerifyAssetCore({
      userId: "user-1",
      sessionId: VALID_SESSION_ID,
      assetId: PDF_ASSET_ID,
      clientPayload: {
        bucket: "post-pdfs",
        path: validStoragePath,
      },
    }),
    /Magic bytes ไม่ถูกต้อง/
  );
});

test("integration: create post idempotency retry returns the same post without creating duplicate", async t => {
  const existingPost = {
    id: "post-already-created",
    title: "Existing Post",
    author_id: "user-1",
    idempotency_key: "0123456789abcdef0123456789abcdef",
  };

  replace(t, prisma.post, "findFirst", async () => existingPost);
  const txSpy = replace(t, prisma, "$transaction", async () => {
    throw new Error("Must not run transaction on replayed post!");
  });

  const res = response();
  await createPost(
    {
      user: { id: "user-1" },
      body: {
        title: "Existing Post",
        upload_session_id: VALID_SESSION_ID,
        cover_asset_id: COVER_ASSET_ID,
        idempotency_key: "0123456789abcdef0123456789abcdef",
      },
    },
    res.res
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.replayed, true);
  assert.equal(res.body.data.id, "post-already-created");
  assert.equal(txSpy.mock.callCount(), 0);
});

test("integration: job queue claims jobs with FOR UPDATE SKIP LOCKED without double claiming", async t => {
  const jobsInDb = [
    {
      id: "job-1",
      type: "CLEANUP_UPLOAD_ASSET",
      payload: { assetId: "asset-1" },
      status: "PENDING",
      attempts: 0,
      max_attempts: 3,
    },
  ];

  let locked = false;
  const mockClient = {
    $queryRaw: async () => {
      if (locked) return [];
      locked = true;
      return jobsInDb;
    },
  };

  // Worker 1 claims job
  const job1 = await claimNextJob({ workerId: "worker-1", client: mockClient });
  assert.ok(job1);
  assert.equal(job1.id, "job-1");

  // Worker 2 attempts to claim simultaneously: gets null (empty) because job is locked
  const job2 = await claimNextJob({ workerId: "worker-2", client: mockClient });
  assert.equal(job2, null);
});

test("integration: when UPLOAD_WORKSPACE_V2_ENABLED is false, system bypasses V2 flow and falls back to legacy", async t => {
  const previous = process.env.UPLOAD_WORKSPACE_V2_ENABLED;
  process.env.UPLOAD_WORKSPACE_V2_ENABLED = "false";
  t.after(() => {
    if (previous === undefined) delete process.env.UPLOAD_WORKSPACE_V2_ENABLED;
    else process.env.UPLOAD_WORKSPACE_V2_ENABLED = previous;
  });

  replace(t, prisma.category, "findUnique", async () => ({ id: "cat-1" }));
  replace(t, prisma.post, "findFirst", async () => null);

  const res = response();
  // Request with V2 asset IDs but flag disabled will fall back to legacy flow which checks files
  await createPost(
    {
      user: { id: "user-1" },
      body: {
        title: "Legacy Fallback Post",
        summary: "Summary",
        content: "Content",
        category_id: "cat-1",
        education_level: "UNIVERSITY",
        post_status: "ACTIVE",
        upload_session_id: VALID_SESSION_ID,
        cover_asset_id: COVER_ASSET_ID,
      },
      files: {},
    },
    res.res
  );

  // In legacy flow without multipart files or direct upload objects, it rejects missing cover/media files
  assert.equal(res.status, 400);
});

