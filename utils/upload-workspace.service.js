import crypto from "node:crypto";
import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.config.js";
import { supabaseAdmin } from "../configs/supabase.config.js";
import {
  UPLOAD_WORKSPACE_LIMITS,
  UPLOAD_ERROR_CODES,
  ALLOWED_IMAGE_FORMATS,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_PDF_FORMATS,
  ALLOWED_PDF_MIMES,
  isValidUuid,
} from "../configs/upload-workspace.constants.js";
import {
  getSupabasePdfBucket,
  getPostPdfMaxBytes,
  isAllowedPdfPath,
  normalizePdfFileName,
  deleteSupabasePdfObject,
} from "./supabase-storage.js";
import { enqueueJob, JOB_TYPES } from "./job-queue.js";
import { logWarn, logError } from "./logger.js";

export class UploadWorkspaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "UploadWorkspaceError";
    this.code = code;
    this.status = status;
  }
}

/**
 * 1. Create or Reuse Upload Session (Idempotent)
 */
export async function createOrReuseUploadSession({ userId, draftId }) {
  if (!userId) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
      "ต้องระบุผู้ใช้งาน",
      401
    );
  }

  if (!isValidUuid(draftId)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_UPLOAD_SESSION,
      "รหัส draft_id ต้องเป็น UUID ที่ถูกต้อง",
      400
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_WORKSPACE_LIMITS.SESSION_TTL_MS);

  // Check existing session for (user_id, draft_id)
  const existing = await prisma.uploadSession.findUnique({
    where: {
      user_id_draft_id: {
        user_id: userId,
        draft_id: draftId,
      },
    },
  });

  if (existing) {
    // If OPEN and not expired -> return existing session and touch last_activity_at
    if (existing.status === "OPEN" && existing.expires_at > now) {
      await prisma.uploadSession.update({
        where: { id: existing.id },
        data: { last_activity_at: now },
      });
      return formatSessionResponse(existing);
    }

    // If session was committed, it belongs to an existing post
    if (existing.status === "COMMITTED" || existing.post_id) {
      return formatSessionResponse(existing);
    }

    // If expired and not committed, check if it had attached assets
    const attachedCount = await prisma.uploadAsset.count({
      where: { upload_session_id: existing.id, status: "ATTACHED" },
    });

    if (attachedCount === 0) {
      // Reopen session with new expiration safely
      const updated = await prisma.uploadSession.update({
        where: { id: existing.id },
        data: {
          status: "OPEN",
          expires_at: expiresAt,
          last_activity_at: now,
        },
      });
      return formatSessionResponse(updated);
    }
  }

  // Create new session
  const created = await prisma.uploadSession.create({
    data: {
      id: crypto.randomUUID(),
      user_id: userId,
      draft_id: draftId,
      status: "OPEN",
      expires_at: expiresAt,
      last_activity_at: now,
      reserved_bytes: 0,
    },
  });

  return formatSessionResponse(created);
}

function formatSessionResponse(session) {
  return {
    session_id: session.id,
    draft_id: session.draft_id,
    status: session.status,
    expires_at: session.expires_at.toISOString(),
    limits: {
      max_files: UPLOAD_WORKSPACE_LIMITS.MAX_FILES,
      max_total_bytes: UPLOAD_WORKSPACE_LIMITS.MAX_TOTAL_BYTES,
      max_pdf_bytes: UPLOAD_WORKSPACE_LIMITS.MAX_PDF_BYTES,
    },
  };
}

/**
 * 2. Signed Upload Per File (Idempotent)
 */
export async function signUploadFile({
  userId,
  sessionId,
  clientFileId,
  assetType,
  originalName,
  contentType,
  size,
}) {
  if (!isValidUuid(sessionId)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_UPLOAD_SESSION,
      "รหัส upload session ไม่ถูกต้อง",
      400
    );
  }

  if (!isValidUuid(clientFileId)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
      "รหัส client_file_id ต้องเป็น UUID ที่ถูกต้อง",
      400
    );
  }

  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId },
    include: {
      assets: true,
    },
  });

  if (!session || session.user_id !== userId) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
      "ไม่มีสิทธิ์เข้าถึง upload session นี้",
      403
    );
  }

  const now = new Date();
  if (session.status !== "OPEN" || session.expires_at <= now) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_SESSION_EXPIRED,
      "upload session หมดอายุหรือไม่อยู่ในสถานะเปิดใช้งาน",
      410
    );
  }

  // 1. Idempotency Check: if (session_id, client_file_id) already exists, return existing signed info
  const existingAsset = session.assets.find(a => a.client_file_id === clientFileId);
  if (existingAsset) {
    return buildSignResponse(existingAsset, userId, sessionId);
  }

  // 2. Validate Asset Type
  const upperType = String(assetType || "").toUpperCase();
  if (!["COVER", "IMAGE", "PDF"].includes(upperType)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_IMAGE,
      "ประเภท asset_type ไม่ถูกต้อง (ต้องเป็น COVER, IMAGE หรือ PDF)",
      400
    );
  }

  // 3. Validate File Size & Quotas
  const parsedSize = Number(size);
  if (!Number.isSafeInteger(parsedSize) || parsedSize <= 0) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_IMAGE,
      "ขนาดไฟล์ไม่ถูกต้อง",
      400
    );
  }

  if (upperType === "PDF") {
    if (parsedSize > UPLOAD_WORKSPACE_LIMITS.MAX_PDF_BYTES) {
      throw new UploadWorkspaceError(
        UPLOAD_ERROR_CODES.PDF_TOO_LARGE,
        `ขนาดไฟล์ PDF เกิน ${Math.round(UPLOAD_WORKSPACE_LIMITS.MAX_PDF_BYTES / (1024 * 1024))} MB`,
        400
      );
    }
  } else {
    if (parsedSize > UPLOAD_WORKSPACE_LIMITS.MAX_IMAGE_BYTES) {
      throw new UploadWorkspaceError(
        UPLOAD_ERROR_CODES.INVALID_IMAGE,
        `ขนาดไฟล์รูปภาพเกิน ${Math.round(UPLOAD_WORKSPACE_LIMITS.MAX_IMAGE_BYTES / (1024 * 1024))} MB`,
        400
      );
    }
  }

  // Check active assets count and total size
  const activeAssets = session.assets.filter(
    a => !["FAILED", "DELETED", "DETACHED"].includes(a.status)
  );

  if (activeAssets.length >= UPLOAD_WORKSPACE_LIMITS.MAX_FILES) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.TOTAL_UPLOAD_TOO_LARGE,
      `แนบไฟล์ได้สูงสุด ${UPLOAD_WORKSPACE_LIMITS.MAX_FILES} ไฟล์`,
      400
    );
  }

  const currentTotalBytes = activeAssets.reduce((sum, a) => sum + (Number(a.file_size) || 0), 0);
  if (currentTotalBytes + parsedSize > UPLOAD_WORKSPACE_LIMITS.MAX_TOTAL_BYTES) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.TOTAL_UPLOAD_TOO_LARGE,
      `ขนาดไฟล์รวมเกิน ${Math.round(UPLOAD_WORKSPACE_LIMITS.MAX_TOTAL_BYTES / (1024 * 1024))} MB`,
      400
    );
  }

  // 4. Validate MIME & Extensions
  const safeOriginalName = (typeof originalName === "string" ? originalName : "file")
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.slice(0, 255) || "file";
  const ext = safeOriginalName.split(".").pop()?.toLowerCase();
  const safeContentType = String(contentType || "").toLowerCase();

  if (upperType === "PDF") {
    if (ext !== "pdf" || (!ALLOWED_PDF_MIMES.includes(safeContentType) && safeContentType)) {
      throw new UploadWorkspaceError(
        UPLOAD_ERROR_CODES.INVALID_PDF,
        "ชนิดไฟล์ต้องเป็น PDF (application/pdf) เท่านั้น",
        400
      );
    }
  } else {
    if (!ALLOWED_IMAGE_FORMATS.includes(ext) || (!ALLOWED_IMAGE_MIMES.includes(safeContentType) && safeContentType)) {
      throw new UploadWorkspaceError(
        UPLOAD_ERROR_CODES.INVALID_IMAGE,
        "ชนิดไฟล์รูปภาพต้องเป็น JPG, PNG, WEBP หรือ APNG เท่านั้น",
        400
      );
    }
  }

  // 5. Generate Isolated Path & Provider-specific Signatures
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const provider = upperType === "PDF" ? "SUPABASE" : "CLOUDINARY";
  const assetId = crypto.randomUUID();

  let signData = null;
  let publicId = null;
  let storagePath = null;
  let bucket = null;

  if (provider === "CLOUDINARY") {
    const subfolder = upperType === "COVER" ? "covers" : "media";
    const folder = `share-ed/users/${safeUserId}/upload-sessions/${sessionId}/${subfolder}`;
    publicId = `${folder}/${clientFileId}`;
    const timestamp = Math.round(now.getTime() / 1000);

    const signParams = {
      folder,
      public_id: publicId,
      timestamp,
      return_delete_token: true,
      allowed_formats: ALLOWED_IMAGE_FORMATS.join(","),
    };

    const signature = cloudinary.utils.api_sign_request(
      signParams,
      process.env.CLOUDINARY_API_SECRET
    );

    signData = {
      provider: "CLOUDINARY",
      upload_url: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
      api_key: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder,
      public_id: publicId,
      resource_type: "image",
      allowed_formats: ALLOWED_IMAGE_FORMATS,
    };
  } else {
    // SUPABASE PDF
    bucket = getSupabasePdfBucket();
    storagePath = `users/${safeUserId}/upload-sessions/${sessionId}/${clientFileId}.pdf`;

    const { data: uploadData, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !uploadData) {
      logError("upload_workspace.supabase_create_signed_url_failed", error);
      throw new UploadWorkspaceError(
        UPLOAD_ERROR_CODES.STORAGE_PROVIDER_ERROR,
        "ไม่สามารถสร้าง URL สำหรับอัปโหลด PDF ได้",
        500
      );
    }

    signData = {
      provider: "SUPABASE",
      bucket,
      path: storagePath,
      token: uploadData.token,
      signedUploadUrl: uploadData.signedUrl,
      max_bytes: UPLOAD_WORKSPACE_LIMITS.MAX_PDF_BYTES,
    };
  }

  // 6. Save UploadAsset record with status SIGNED
  const newAsset = await prisma.uploadAsset.create({
    data: {
      id: assetId,
      upload_session_id: sessionId,
      client_file_id: clientFileId,
      provider,
      asset_type: upperType,
      status: "SIGNED",
      bucket,
      storage_path: storagePath,
      public_id: publicId,
      original_name: safeOriginalName,
      mime_type: safeContentType || (upperType === "PDF" ? "application/pdf" : "image/jpeg"),
      file_size: parsedSize,
    },
  });

  // Touch session
  await prisma.uploadSession.update({
    where: { id: sessionId },
    data: { last_activity_at: now },
  });

  return {
    success: true,
    data: {
      asset_id: newAsset.id,
      client_file_id: newAsset.client_file_id,
      asset_type: newAsset.asset_type,
      status: newAsset.status,
      ...signData,
    },
  };
}

function buildSignResponse(asset, userId, sessionId) {
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (asset.provider === "CLOUDINARY") {
    const subfolder = asset.asset_type === "COVER" ? "covers" : "media";
    const folder = `share-ed/users/${safeUserId}/upload-sessions/${sessionId}/${subfolder}`;
    const timestamp = Math.round(asset.created_at.getTime() / 1000);
    const signParams = {
      folder,
      public_id: asset.public_id,
      timestamp,
      return_delete_token: true,
      allowed_formats: ALLOWED_IMAGE_FORMATS.join(","),
    };
    const signature = cloudinary.utils.api_sign_request(
      signParams,
      process.env.CLOUDINARY_API_SECRET
    );

    return {
      success: true,
      data: {
        asset_id: asset.id,
        client_file_id: asset.client_file_id,
        asset_type: asset.asset_type,
        status: asset.status,
        provider: "CLOUDINARY",
        upload_url: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
        api_key: process.env.CLOUDINARY_API_KEY,
        timestamp,
        signature,
        folder,
        public_id: asset.public_id,
        resource_type: "image",
        allowed_formats: ALLOWED_IMAGE_FORMATS,
      },
    };
  }

  // Supabase PDF
  return {
    success: true,
    data: {
      asset_id: asset.id,
      client_file_id: asset.client_file_id,
      asset_type: asset.asset_type,
      status: asset.status,
      provider: "SUPABASE",
      bucket: asset.bucket || getSupabasePdfBucket(),
      path: asset.storage_path,
      max_bytes: UPLOAD_WORKSPACE_LIMITS.MAX_PDF_BYTES,
    },
  };
}

/**
 * 3. Complete and Verify File in Advance (Phase 4)
 */
export async function completeAndVerifyAssetCore({
  userId,
  sessionId,
  assetId,
  clientPayload,
}) {
  if (!isValidUuid(sessionId) || !isValidUuid(assetId)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_UPLOAD_SESSION,
      "รหัส sessionId หรือ assetId ไม่ถูกต้อง",
      400
    );
  }

  const asset = await prisma.uploadAsset.findUnique({
    where: { id: assetId },
    include: { upload_session: true },
  });

  if (!asset || asset.upload_session_id !== sessionId) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_ASSET_NOT_FOUND,
      "ไม่พบ asset นี้ใน upload session",
      404
    );
  }

  if (asset.upload_session.user_id !== userId) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
      "ไม่มีสิทธิ์เข้าถึง asset นี้",
      403
    );
  }

  // Idempotency: if already VERIFIED, return result immediately
  if (asset.status === "VERIFIED") {
    return formatVerifiedAssetResponse(asset);
  }

  // Atomic transition: SIGNED -> VERIFYING
  const transition = await prisma.uploadAsset.updateMany({
    where: {
      id: assetId,
      status: { in: ["SIGNED", "UPLOADED", "FAILED"] },
    },
    data: { status: "VERIFYING" },
  });

  if (transition.count === 0 && asset.status !== "VERIFYING") {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
      `Asset อยู่ในสถานะที่ไม่สามารถยืนยันได้: ${asset.status}`,
      409
    );
  }

  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const now = new Date();

  try {
    if (asset.provider === "CLOUDINARY") {
      // 1. Validate Cloudinary fields
      const { public_id, version, signature, secure_url, resource_type, format, bytes } = clientPayload || {};
      if (!public_id || !version || !signature || !secure_url) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.UPLOAD_VERIFICATION_FAILED,
          "ข้อมูลตอบกลับจาก Cloudinary ไม่ครบถ้วน",
          400
        );
      }

      // Expected prefix
      const expectedFolder = `share-ed/users/${safeUserId}/upload-sessions/${sessionId}`;
      if (!public_id.startsWith(`${expectedFolder}/`)) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
          "ไฟล์ไม่ได้อยู่ในโฟลเดอร์ของ upload session นี้",
          403
        );
      }

      // Verify Cloudinary API response signature
      const validSignature = cloudinary.utils.verify_api_response_signature(
        public_id,
        version,
        signature
      );
      if (!validSignature) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.UPLOAD_VERIFICATION_FAILED,
          "ลายเซ็นตอบกลับของ Cloudinary ไม่ถูกต้อง",
          400
        );
      }

      // Validate secure_url format and domain
      let url;
      try {
        url = new URL(secure_url);
      } catch {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.INVALID_IMAGE,
          "URL ของรูปภาพไม่ถูกต้อง",
          400
        );
      }
      if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.INVALID_IMAGE,
          "URL รูปภาพต้องเป็น HTTPS Cloudinary ของระบบ",
          400
        );
      }

      // 2. Authoritative metadata call over authenticated Cloudinary Admin API
      let authoritative;
      try {
        authoritative = await cloudinary.api.resource(public_id, {
          resource_type: "image",
          type: "upload",
          timeout: 10000,
        });
      } catch (adminErr) {
        logError("upload_workspace.cloudinary_admin_lookup_failed", adminErr, undefined, { public_id });
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.STORAGE_PROVIDER_ERROR,
          "ไม่สามารถตรวจสอบข้อมูลไฟล์กับ Cloudinary ได้",
          502
        );
      }

      if (Number(authoritative.bytes) > UPLOAD_WORKSPACE_LIMITS.MAX_IMAGE_BYTES) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.INVALID_IMAGE,
          `ขนาดรูปภาพเกิน ${Math.round(UPLOAD_WORKSPACE_LIMITS.MAX_IMAGE_BYTES / (1024 * 1024))} MB`,
          400
        );
      }

      const authoritativeFormat = String(authoritative.format || "").toLowerCase();
      if (!ALLOWED_IMAGE_FORMATS.includes(authoritativeFormat)) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.INVALID_IMAGE,
          "ฟอร์แมตของรูปภาพไม่ถูกต้อง",
          400
        );
      }

      // Verification passed: update to VERIFIED
      const updated = await prisma.uploadAsset.update({
        where: { id: assetId },
        data: {
          status: "VERIFIED",
          secure_url: authoritative.secure_url || secure_url,
          file_size: authoritative.bytes,
          mime_type: `image/${authoritativeFormat === "jpg" ? "jpeg" : authoritativeFormat}`,
          verified_at: now,
          verification_error: null,
        },
      });

      await prisma.uploadSession.update({
        where: { id: sessionId },
        data: { last_activity_at: now },
      });

      return formatVerifiedAssetResponse(updated);
    } else {
      // 2. SUPABASE PDF Verification
      const { bucket = getSupabasePdfBucket(), path } = clientPayload || {};
      const expectedBucket = getSupabasePdfBucket();
      if (bucket !== expectedBucket) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
          "Bucket สำหรับจัดเก็บ PDF ไม่ถูกต้อง",
          403
        );
      }

      const targetPath = path || asset.storage_path;
      if (!isAllowedPdfPath(targetPath, userId, sessionId)) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
          "เส้นทางไฟล์ PDF ไม่ถูกต้องหรือไม่อยู่ในพื้นที่ของผู้ใช้",
          403
        );
      }

      const storage = supabaseAdmin.storage.from(bucket);
      let infoResult;
      try {
        infoResult = await storage.info(targetPath);
      } catch (storageErr) {
        logError("upload_workspace.supabase_info_exception", storageErr, undefined, { targetPath });
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.STORAGE_PROVIDER_ERROR,
          "เกิดข้อผิดพลาดในการตรวจสอบไฟล์ PDF",
          500
        );
      }

      const error = infoResult?.error;
      const data = infoResult?.data;
      if (error || !data) {
        if (error?.status === 404 || error?.statusCode === "404" || error?.statusCode === 404 || error?.message?.toLowerCase().includes("not found")) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_ASSET_NOT_FOUND,
            "ไม่พบไฟล์ PDF ใน Storage",
            404
          );
        }
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.STORAGE_PROVIDER_ERROR,
          "เกิดข้อผิดพลาดในการเข้าถึงไฟล์ใน Storage",
          502
        );
      }

      const actualSize = Number(data.size);
      if (actualSize <= 0) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.INVALID_PDF,
          "ขนาดไฟล์ PDF ว่างเปล่า",
          400
        );
      }
      if (actualSize > UPLOAD_WORKSPACE_LIMITS.MAX_PDF_BYTES) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.PDF_TOO_LARGE,
          `ขนาดไฟล์ PDF เกิน ${Math.round(UPLOAD_WORKSPACE_LIMITS.MAX_PDF_BYTES / (1024 * 1024))} MB`,
          400
        );
      }

      const rawMime = data.contentType || data.content_type || data.metadata?.mimetype || "";
      const actualMime = String(rawMime).split(";")[0].trim().toLowerCase();
      if (!ALLOWED_PDF_MIMES.includes(actualMime)) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.INVALID_PDF,
          "ประเภทไฟล์ต้องเป็น application/pdf เท่านั้น",
          400
        );
      }

      // Check PDF Magic Bytes (%PDF- => 0x25, 0x50, 0x44, 0x46, 0x2D)
      let headerResult;
      try {
        headerResult = await storage.download(targetPath, {}, {
          headers: { Range: "bytes=0-4" },
        });
      } catch (hErr) {
        logError("upload_workspace.supabase_header_exception", hErr, undefined, { targetPath });
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.STORAGE_PROVIDER_ERROR,
          "ไม่สามารถอ่านข้อมูล magic bytes ของไฟล์ PDF ได้",
          500
        );
      }

      if (headerResult?.error || !headerResult?.data) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.STORAGE_PROVIDER_ERROR,
          "ไม่สามารถอ่านข้อมูล magic bytes ของไฟล์ PDF ได้",
          500
        );
      }

      const headerData = headerResult.data;
      const headerBuffer = typeof headerData.arrayBuffer === "function"
        ? Buffer.from(await headerData.arrayBuffer()).subarray(0, 5)
        : Buffer.from(headerData).subarray(0, 5);

      if (headerBuffer.length < 5 || headerBuffer.toString("ascii") !== "%PDF-") {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.INVALID_PDF,
          "เนื้อหาไฟล์ไม่ใช่ PDF ที่ถูกต้อง (Magic bytes ไม่ถูกต้อง)",
          400
        );
      }

      // Verification passed: update to VERIFIED
      const updated = await prisma.uploadAsset.update({
        where: { id: assetId },
        data: {
          status: "VERIFIED",
          file_size: actualSize,
          mime_type: "application/pdf",
          storage_path: targetPath,
          bucket,
          verified_at: now,
          verification_error: null,
        },
      });

      await prisma.uploadSession.update({
        where: { id: sessionId },
        data: { last_activity_at: now },
      });

      return formatVerifiedAssetResponse(updated);
    }
  } catch (verifyError) {
    // Record FAILED status with safe error code
    const safeCode = verifyError instanceof UploadWorkspaceError
      ? verifyError.code
      : UPLOAD_ERROR_CODES.UPLOAD_VERIFICATION_FAILED;

    await prisma.uploadAsset.update({
      where: { id: assetId },
      data: {
        status: "FAILED",
        verification_error: safeCode,
      },
    }).catch(() => {});

    throw verifyError;
  }
}

function formatVerifiedAssetResponse(asset) {
  return {
    id: asset.id,
    client_file_id: asset.client_file_id,
    asset_type: asset.asset_type,
    status: asset.status,
    original_name: asset.original_name,
    file_size: asset.file_size,
    verified_at: asset.verified_at?.toISOString() || null,
  };
}

/**
 * 4. Status Endpoint: GET Upload Session
 */
export async function getUploadSessionStatus({ userId, sessionId }) {
  if (!isValidUuid(sessionId)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_UPLOAD_SESSION,
      "รหัส upload session ไม่ถูกต้อง",
      400
    );
  }

  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId },
    include: {
      assets: {
        orderBy: { created_at: "asc" },
      },
    },
  });

  if (!session || session.user_id !== userId) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
      "ไม่มีสิทธิ์เข้าถึง upload session นี้",
      403
    );
  }

  // Filter sensitive details: no secrets, no service-role keys, no internal signatures
  return {
    session_id: session.id,
    draft_id: session.draft_id,
    status: session.status,
    expires_at: session.expires_at.toISOString(),
    assets: session.assets.map(a => ({
      id: a.id,
      client_file_id: a.client_file_id,
      asset_type: a.asset_type,
      status: a.status,
      original_name: a.original_name,
      file_size: a.file_size,
      verification_error: a.verification_error || null,
    })),
  };
}

/**
 * 5. Delete or Cancel File
 */
export async function deleteUploadAsset({ userId, sessionId, assetId }) {
  if (!isValidUuid(sessionId) || !isValidUuid(assetId)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_UPLOAD_SESSION,
      "รหัส sessionId หรือ assetId ไม่ถูกต้อง",
      400
    );
  }

  const asset = await prisma.uploadAsset.findUnique({
    where: { id: assetId },
    include: { upload_session: true },
  });

  if (!asset || asset.upload_session_id !== sessionId) {
    // Idempotent: if already gone, return success
    return { success: true };
  }

  if (asset.upload_session.user_id !== userId) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
      "ไม่มีสิทธิ์ลบ asset นี้",
      403
    );
  }

  if (asset.status === "ATTACHED") {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
      "ไม่สามารถลบไฟล์ที่ผูกกับโพสต์แล้วได้",
      400
    );
  }

  if (asset.status === "DELETED" || asset.status === "DELETE_PENDING") {
    return { success: true };
  }

  // Atomic mark as DELETE_PENDING
  await prisma.uploadAsset.update({
    where: { id: assetId },
    data: { status: "DELETE_PENDING" },
  });

  // Enqueue cleanup job
  await enqueueJob(JOB_TYPES.CLEANUP_UPLOAD_ASSET, {
    assetId: asset.id,
    uploadSessionId: sessionId,
  }).catch(err => {
    logWarn("upload_workspace.enqueue_asset_cleanup_failed", err, undefined, { assetId });
  });

  return { success: true };
}

/**
 * 6. Cancel or Delete Entire Draft Session
 */
export async function deleteUploadSession({ userId, sessionId }) {
  if (!isValidUuid(sessionId)) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.INVALID_UPLOAD_SESSION,
      "รหัส upload session ไม่ถูกต้อง",
      400
    );
  }

  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return { success: true };
  }

  if (session.user_id !== userId) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
      "ไม่มีสิทธิ์ลบ upload session นี้",
      403
    );
  }

  if (session.status === "COMMITTED" || session.post_id) {
    throw new UploadWorkspaceError(
      UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
      "ไม่สามารถยกเลิก upload session ที่เผยแพร่โพสต์แล้วได้",
      400
    );
  }

  // Mark session as CLEANING
  await prisma.uploadSession.update({
    where: { id: sessionId },
    data: { status: "CLEANING" },
  });

  // Enqueue cleanup job
  await enqueueJob(JOB_TYPES.CLEANUP_UPLOAD_SESSION, {
    uploadSessionId: sessionId,
    force: true, // User explicitly cancelled draft, no need to wait 24h grace period
  }).catch(err => {
    logWarn("upload_workspace.enqueue_session_cleanup_failed", err, undefined, { sessionId });
  });

  return { success: true };
}
