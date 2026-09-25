import crypto from "node:crypto";
import { supabaseAdmin } from "../configs/supabase.config.js";
import { logError, logWarn } from "./logger.js";

export const PDF_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export function getPostPdfMaxBytes() {
  const parsed = Number.parseInt(process.env.POST_PDF_MAX_BYTES, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : PDF_MAX_BYTES;
}

export function getSupabasePdfBucket() {
  return process.env.SUPABASE_STORAGE_PDF_BUCKET || "post-pdfs";
}

export class SupabasePdfError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SupabasePdfError";
    this.code = code;
    this.status = status;
  }
}

export function normalizePdfFileName(value) {
  if (typeof value !== "string") return null;
  const baseName = value
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!baseName) return null;
  const trimmed = baseName.slice(0, 255);
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
}

export function isAllowedPdfPath(path, userId, sessionId) {
  if (typeof path !== "string" || !userId || !sessionId) return false;
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = `users/${safeUserId}/upload-sessions/${sessionId}/`;
  if (!path.startsWith(prefix)) return false;
  const remainder = path.slice(prefix.length);
  return /^[a-f0-9-]{36}\.pdf$/i.test(remainder);
}

export function buildSupabasePdfPath(userId, sessionId, fileId = crypto.randomUUID()) {
  const safeUserId = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `users/${safeUserId}/upload-sessions/${sessionId}/${fileId}.pdf`;
}

export async function createSignedPdfUpload({
  userId,
  sessionId,
  bucket = getSupabasePdfBucket(),
}) {
  if (!userId || !sessionId) {
    throw new SupabasePdfError("UPLOAD_SESSION_FORBIDDEN", "ต้องระบุ userId และ sessionId สำหรับการขออัปโหลด PDF", 403);
  }

  const path = buildSupabasePdfPath(userId, sessionId);
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path);

  if (error || !data) {
    logError("supabase_storage.create_signed_upload_failed", error, undefined, { bucket, path });
    throw new SupabasePdfError("PDF_STORAGE_ERROR", "ไม่สามารถสร้าง URL สำหรับอัปโหลด PDF ได้", 500);
  }

  const maxBytes = getPostPdfMaxBytes();

  return {
    provider: "SUPABASE",
    bucket,
    path,
    token: data.token,
    signedUploadUrl: data.signedUrl,
    uploadSessionId: sessionId,
    maxBytes,
  };
}

export async function verifyUploadedPdf(asset, { userId, sessionId, bucket = getSupabasePdfBucket() }) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    throw new SupabasePdfError("INVALID_PDF", "ข้อมูลไฟล์ PDF ไม่ถูกต้อง", 400);
  }

  const assetProvider = String(asset.provider || "").toUpperCase();
  if (assetProvider !== "SUPABASE") {
    throw new SupabasePdfError("INVALID_PDF", "ผู้ให้บริการจัดเก็บไฟล์ไม่ใช่ SUPABASE", 400);
  }

  const assetBucket = asset.bucket || bucket;
  if (assetBucket !== bucket) {
    throw new SupabasePdfError("UPLOAD_SESSION_FORBIDDEN", "ที่จัดเก็บไฟล์ (bucket) ไม่ตรงกับที่กำหนด", 403);
  }

  const assetSessionId = asset.upload_session_id || asset.sessionId;
  if (!assetSessionId || assetSessionId !== sessionId) {
    throw new SupabasePdfError("UPLOAD_SESSION_FORBIDDEN", "upload session ของไฟล์ไม่ถูกต้องหรือไม่ตรงกัน", 403);
  }

  const assetPath = asset.path;
  if (!isAllowedPdfPath(assetPath, userId, sessionId)) {
    throw new SupabasePdfError("UPLOAD_SESSION_FORBIDDEN", "เส้นทางไฟล์ PDF ไม่ถูกต้องหรือไม่ได้รับอนุญาต", 403);
  }

  // ห้ามเชื่อ path, MIME และขนาดที่ frontend ส่งมาโดยตรง: อ่าน metadata
  // จาก Storage และดาวน์โหลดเฉพาะ 5 ไบต์แรกสำหรับตรวจ magic bytes เท่านั้น
  const storage = supabaseAdmin.storage.from(bucket);
  let infoResult;
  try {
    infoResult = await storage.info(assetPath);
  } catch (error) {
    logError("supabase_storage.verify_info_exception", error, undefined, { bucket, assetPath });
    throw new SupabasePdfError("PDF_STORAGE_ERROR", "เกิดข้อผิดพลาดในการตรวจสอบไฟล์ PDF", 500);
  }

  const error = infoResult?.error;
  const data = infoResult?.data;

  if (error || !data) {
    if (error?.status === 404 || error?.statusCode === "404" || error?.statusCode === 404 || error?.message?.toLowerCase().includes("not found")) {
      throw new SupabasePdfError("PDF_OBJECT_NOT_FOUND", "ไม่พบไฟล์ PDF ใน Storage", 404);
    }
    logError("supabase_storage.verify_download_error", error, undefined, { bucket, assetPath });
    throw new SupabasePdfError("PDF_STORAGE_ERROR", "เกิดข้อผิดพลาดในการเข้าถึงไฟล์ใน Storage", 500);
  }

  // ตรวจสอบขนาดไฟล์
  const maxBytes = getPostPdfMaxBytes();
  const actualSize = Number(data?.size);
  if (actualSize <= 0) {
    throw new SupabasePdfError("INVALID_PDF", "ขนาดไฟล์ PDF ไม่ถูกต้อง (ไฟล์ว่างเปล่า)", 400);
  }
  if (actualSize > maxBytes) {
    throw new SupabasePdfError("PDF_TOO_LARGE", `ขนาดไฟล์ PDF เกิน ${Math.round(maxBytes / (1024 * 1024))} MB`, 400);
  }

  // ตรวจสอบ MIME type
  const rawMime = data?.contentType || data?.content_type || data?.metadata?.mimetype || "";
  const actualMime = String(rawMime).split(";")[0].trim().toLowerCase();
  if (!["application/pdf", "application/x-pdf"].includes(actualMime)) {
    throw new SupabasePdfError("INVALID_PDF", "ประเภทไฟล์ต้องเป็น application/pdf เท่านั้น", 400);
  }

  // ตรวจสอบ Magic bytes (%PDF- => 0x25, 0x50, 0x44, 0x46, 0x2D)
  let headerResult;
  try {
    headerResult = await storage.download(assetPath, {}, {
      headers: { Range: "bytes=0-4" },
    });
  } catch (headerError) {
    logError("supabase_storage.verify_header_exception", headerError, undefined, { bucket, assetPath });
    throw new SupabasePdfError("PDF_STORAGE_ERROR", "เกิดข้อผิดพลาดในการอ่านข้อมูลไฟล์ PDF", 500);
  }
  if (headerResult?.error || !headerResult?.data) {
    logError("supabase_storage.verify_header_error", headerResult?.error, undefined, { bucket, assetPath });
    throw new SupabasePdfError("PDF_STORAGE_ERROR", "เกิดข้อผิดพลาดในการอ่านข้อมูลไฟล์ PDF", 500);
  }
  const headerData = headerResult.data;
  const headerBuffer = typeof headerData.arrayBuffer === "function"
    ? Buffer.from(await headerData.arrayBuffer()).subarray(0, 5)
    : Buffer.from(headerData).subarray(0, 5);

  if (headerBuffer.length < 5 || headerBuffer.toString("ascii") !== "%PDF-") {
    throw new SupabasePdfError("INVALID_PDF", "เนื้อหาไฟล์ไม่ใช่ PDF ที่ถูกต้อง (Magic bytes ไม่ถูกต้อง)", 400);
  }

  const originalName = normalizePdfFileName(asset.original_name) || "document.pdf";

  return {
    storage_provider: "SUPABASE",
    storage_bucket: bucket,
    storage_path: assetPath,
    file_size: actualSize,
    original_name: originalName,
    media_type: "PDF",
    media_url: null,
  };
}

export async function createSignedPdfDownloadUrl(bucket, path, expiresInSeconds = 300) {
  const actualBucket = bucket || getSupabasePdfBucket();
  const { data, error } = await supabaseAdmin.storage.from(actualBucket).createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    logError("supabase_storage.create_signed_download_failed", error, undefined, { bucket: actualBucket, path });
    throw new SupabasePdfError("PDF_STORAGE_ERROR", "ไม่สามารถสร้าง URL สำหรับดาวน์โหลด PDF ได้", 500);
  }

  return data.signedUrl;
}

export async function deleteSupabasePdfObject(bucket, path, { throwOnError = false } = {}) {
  if (!path) return true;
  const actualBucket = bucket || getSupabasePdfBucket();
  try {
    const { error } = await supabaseAdmin.storage.from(actualBucket).remove([path]);
    if (error) {
      logWarn("supabase_storage.delete_failed", error, undefined, { bucket: actualBucket, path });
      if (throwOnError) {
        throw new SupabasePdfError("PDF_STORAGE_ERROR", "ไม่สามารถลบไฟล์ PDF จาก Storage ได้", 502);
      }
      return false;
    }
    return true;
  } catch (err) {
    logWarn("supabase_storage.delete_exception", err, undefined, { bucket: actualBucket, path });
    if (throwOnError) throw err;
    return false;
  }
}

export async function cleanupSupabaseUploadSession(userId, sessionId, bucket = getSupabasePdfBucket()) {
  const safeUserId = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const folder = `users/${safeUserId}/upload-sessions/${sessionId}`;
  try {
    const { data: files, error } = await supabaseAdmin.storage.from(bucket).list(folder);
    if (error) {
      throw new SupabasePdfError("PDF_STORAGE_ERROR", "ไม่สามารถอ่านไฟล์ของ upload session ได้", 502);
    }
    if (!Array.isArray(files) || files.length === 0) return true;

    const pathsToDelete = files
      .filter(f => f && f.name)
      .map(f => `${folder}/${f.name}`);

    if (pathsToDelete.length > 0) {
      const { error: removeError } = await supabaseAdmin.storage.from(bucket).remove(pathsToDelete);
      if (removeError) {
        throw new SupabasePdfError("PDF_STORAGE_ERROR", "ไม่สามารถล้างไฟล์ของ upload session ได้", 502);
      }
    }
    return true;
  } catch (error) {
    logWarn("supabase_storage.cleanup_session_failed", error, undefined, { userId, sessionId, folder });
    throw error;
  }
}
