import test from "node:test";
import assert from "node:assert/strict";
import {
  DirectUploadValidationError,
  directUploadParams,
  verifyDirectUploadAsset,
} from "../utils/direct-upload.js";

function imageAsset(overrides = {}) {
  return {
    public_id: "share-ed/users/user-1/posts/covers/cover-id",
    version: 1700000000,
    signature: "response-signature",
    secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v1700000000/share-ed/users/user-1/posts/covers/cover-id.png",
    resource_type: "image",
    format: "png",
    bytes: 1024,
    ...overrides,
  };
}

test("direct upload parameters isolate files by user and restrict formats", () => {
  assert.deepEqual(directUploadParams("cover", "user-1", 123), {
    return_delete_token: true,
    allowed_formats: "jpg,jpeg,png,webp,apng",
    folder: "share-ed/users/user-1/posts/covers",
    timestamp: 123,
  });
  assert.deepEqual(directUploadParams("pdf", "user-1", 123), {
    return_delete_token: true,
    allowed_formats: "pdf",
    folder: "share-ed/users/user-1/posts/pdfs",
    timestamp: 123,
  });
  assert.equal(
    directUploadParams("cover", "user-1", 123, "session-1").folder,
    "share-ed/users/user-1/upload-sessions/session-1/covers"
  );
});

test("verified Cloudinary metadata is converted to post media", () => {
  const calls = [];
  const result = verifyDirectUploadAsset(imageAsset(), {
    type: "cover",
    userId: "user-1",
    cloudName: "test-cloud",
    field: "cover_upload",
    verifySignature: (...args) => { calls.push(args); return true; },
  });
  assert.deepEqual(calls, [["share-ed/users/user-1/posts/covers/cover-id", 1700000000, "response-signature"]]);
  assert.equal(result.media_type, "IMAGE");
  assert.match(result.media_url, /^https:\/\/res\.cloudinary\.com\//);
});

test("direct uploads reject forged signatures, URLs, folders and oversized files", () => {
  const base = {
    type: "cover",
    userId: "user-1",
    cloudName: "test-cloud",
    field: "cover_upload",
    verifySignature: () => true,
  };
  for (const [asset, options] of [
    [imageAsset(), { ...base, verifySignature: () => false }],
    [imageAsset({ secure_url: "https://evil.example/cover.png" }), base],
    [imageAsset({ public_id: "share-ed/users/user-2/posts/covers/cover-id" }), base],
    [imageAsset({ bytes: 2 * 1024 * 1024 + 1 }), base],
    [imageAsset({ format: "svg", secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v1700000000/share-ed/users/user-1/posts/covers/cover-id.svg" }), base],
  ]) {
    assert.throws(() => verifyDirectUploadAsset(asset, options), DirectUploadValidationError);
  }
});

test("session-scoped verification rejects an asset from another upload session", () => {
  assert.throws(() => verifyDirectUploadAsset(imageAsset(), {
    type: "cover",
    userId: "user-1",
    sessionId: "session-1",
    cloudName: "test-cloud",
    field: "cover_upload",
    verifySignature: () => true,
  }), DirectUploadValidationError);
});

test("provider size overrides forged client bytes", async () => {
  const { verifyStoredDirectUpload } = await import("../utils/direct-upload.js");
  await assert.rejects(verifyStoredDirectUpload(imageAsset({bytes:1}), {
    type:"cover", userId:"user-1", cloudName:"test-cloud", verifySignature:()=>true,
  }, async()=>imageAsset({bytes:3*1024*1024})), /ขนาดไฟล์/);
});
test("direct media count and duplicates are rejected", async () => {
  const { validateDirectUploadList } = await import("../utils/direct-upload.js");
  assert.throws(()=>validateDirectUploadList(null, Array(16).fill(imageAsset())));
  assert.throws(()=>validateDirectUploadList(imageAsset(), [imageAsset()]));
});
