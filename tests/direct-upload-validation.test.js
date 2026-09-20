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
    allowed_formats: "jpg,jpeg,png,webp",
    folder: "share-ed/users/user-1/posts/covers",
    timestamp: 123,
  });
  assert.deepEqual(directUploadParams("pdf", "user-1", 123), {
    allowed_formats: "pdf",
    folder: "share-ed/users/user-1/posts/pdfs",
    timestamp: 123,
  });
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
