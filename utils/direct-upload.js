const MB = 1024 * 1024;

export const DIRECT_UPLOAD_POLICIES = Object.freeze({
  cover: Object.freeze({ resourceType: "image", formats: ["jpg", "jpeg", "png", "webp"], maxBytes: 2 * MB, folder: "covers" }),
  media: Object.freeze({ resourceType: "image", formats: ["jpg", "jpeg", "png", "webp"], maxBytes: 2 * MB, folder: "media" }),
  content: Object.freeze({ resourceType: "image", formats: ["jpg", "jpeg", "png", "webp"], maxBytes: 2 * MB, folder: "content" }),
  pdf: Object.freeze({ resourceType: "raw", formats: ["pdf"], maxBytes: 20 * MB, folder: "pdfs" }),
});

export class DirectUploadValidationError extends Error {
  constructor(message, field = "media_uploads") {
    super(message);
    this.name = "DirectUploadValidationError";
    this.code = "DIRECT_UPLOAD_INVALID";
    this.field = field;
  }
}

export function directUploadFolder(type, userId) {
  const policy = DIRECT_UPLOAD_POLICIES[type];
  if (!policy) throw new DirectUploadValidationError("ประเภทการอัปโหลดไม่ถูกต้อง");
  const safeUserId = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safeUserId) throw new DirectUploadValidationError("ไม่พบผู้ใช้งานสำหรับการอัปโหลด");
  return `share-ed/users/${safeUserId}/posts/${policy.folder}`;
}

export function directUploadParams(type, userId, timestamp) {
  const policy = DIRECT_UPLOAD_POLICIES[type];
  return {
    allowed_formats: policy.formats.join(","),
    folder: directUploadFolder(type, userId),
    timestamp,
  };
}

function requiredString(asset, key, field) {
  if (typeof asset?.[key] !== "string" || !asset[key]) {
    throw new DirectUploadValidationError(`ข้อมูลไฟล์ไม่สมบูรณ์: ${key}`, field);
  }
  return asset[key];
}

export function verifyDirectUploadAsset(asset, { type, userId, cloudName, verifySignature, field }) {
  const policy = DIRECT_UPLOAD_POLICIES[type];
  if (!policy || !asset || typeof asset !== "object" || Array.isArray(asset)) {
    throw new DirectUploadValidationError("ข้อมูลไฟล์ที่อัปโหลดไม่ถูกต้อง", field);
  }

  const publicId = requiredString(asset, "public_id", field);
  const signature = requiredString(asset, "signature", field);
  const secureUrl = requiredString(asset, "secure_url", field);
  const version = Number(asset.version);
  const bytes = Number(asset.bytes);
  const resourceType = requiredString(asset, "resource_type", field).toLowerCase();
  const format = String(asset.format || (publicId.toLowerCase().endsWith(".pdf") ? "pdf" : "")).toLowerCase();

  if (!Number.isSafeInteger(version) || version <= 0 || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new DirectUploadValidationError("ข้อมูลเวอร์ชันหรือขนาดไฟล์ไม่ถูกต้อง", field);
  }
  if (resourceType !== policy.resourceType || !policy.formats.includes(format)) {
    throw new DirectUploadValidationError("ชนิดไฟล์ที่อัปโหลดไม่ถูกต้อง", field);
  }
  if (bytes > policy.maxBytes) {
    throw new DirectUploadValidationError("ขนาดไฟล์เกินกำหนด", field);
  }

  const expectedFolder = directUploadFolder(type, userId);
  if (!publicId.startsWith(`${expectedFolder}/`)) {
    throw new DirectUploadValidationError("ไฟล์ไม่ได้อยู่ในพื้นที่ของผู้ใช้งาน", field);
  }
  if (!verifySignature(publicId, version, signature)) {
    throw new DirectUploadValidationError("ลายเซ็นยืนยันไฟล์ไม่ถูกต้อง", field);
  }

  let url;
  try {
    url = new URL(secureUrl);
  } catch {
    throw new DirectUploadValidationError("URL ของไฟล์ไม่ถูกต้อง", field);
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); } catch {
    throw new DirectUploadValidationError("URL ของไฟล์ไม่ถูกต้อง", field);
  }
  const expectedPrefix = `/${cloudName}/${policy.resourceType}/upload/v${version}/`;
  const expectedAsset = policy.resourceType === "image" ? `${publicId}.${format}` : publicId;
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.search || url.hash || !decodedPath.startsWith(expectedPrefix) || decodedPath.slice(expectedPrefix.length) !== expectedAsset) {
    throw new DirectUploadValidationError("URL ของไฟล์ไม่ตรงกับข้อมูลที่ Cloudinary ยืนยัน", field);
  }

  return {
    media_url: secureUrl,
    media_type: type === "pdf" ? "PDF" : "IMAGE",
  };
}
