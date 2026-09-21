import { logError, logWarn } from "../utils/logger.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { isSupportedFile } from "../utils/upload-validation.js";

const MB = 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const PDF_TYPE = "application/pdf";
const VIDEO_TYPE = "video/mp4";
const ALL_TYPES = new Set([...IMAGE_TYPES, PDF_TYPE, VIDEO_TYPE]);
const uploadBytes = Symbol("uploadBytes");

function uploadError(code, message) {
  return Object.assign(new Error(message), { code });
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function createBoundedMemoryStorage({ totalBytes, fileBytes }) {
  return {
    _handleFile(req, file, callback) {
      const chunks = [];
      const maximumFileBytes = fileBytes(file);
      let currentFileBytes = 0;
      let failure;
      let completed = false;

      const complete = (error, result) => {
        if (completed) return;
        completed = true;
        callback(error, result);
      };

      req[uploadBytes] ??= 0;

      file.stream.on("data", chunk => {
        currentFileBytes += chunk.length;
        req[uploadBytes] += chunk.length;

        if (!failure && currentFileBytes > maximumFileBytes) {
          failure = uploadError("LIMIT_FILE_SIZE", `File exceeds ${maximumFileBytes} bytes`);
          chunks.length = 0;
          return;
        }
        if (!failure && req[uploadBytes] > totalBytes) {
          failure = uploadError("LIMIT_TOTAL_FILE_SIZE", `Upload exceeds ${totalBytes} bytes`);
          chunks.length = 0;
          return;
        }
        if (!failure) chunks.push(chunk);
      });

      file.stream.once("error", complete);
      file.stream.once("end", () => {
        if (failure) return complete(failure);
        const buffer = Buffer.concat(chunks, currentFileBytes);
        if (!isSupportedFile(buffer)) {
          return complete(uploadError("INVALID_UPLOAD", "Unsupported file content"));
        }
        complete(null, { buffer, size: currentFileBytes });
      });
    },
    _removeFile(req, file, callback) {
      delete file.buffer;
      callback(null);
    },
  };
}

function createUpload({ allowed, totalBytes, fileBytes, files, fields = 30 }) {
  return multer({
    storage: createBoundedMemoryStorage({ totalBytes, fileBytes }),
    limits: {
      files,
      fields,
      parts: files + fields,
      fieldSize: 100 * 1024,
      fileSize: 25 * MB,
    },
    fileFilter(req, file, callback) {
      file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
      if (allowed(file)) return callback(null, true);
      callback(uploadError("INVALID_UPLOAD", "Unsupported file type"), false);
    },
  });
}

export const postUpload = createUpload({
  allowed: file => file.fieldname === "cover_image"
    ? IMAGE_TYPES.has(file.mimetype)
    : file.fieldname === "media_files" && (IMAGE_TYPES.has(file.mimetype) || file.mimetype === PDF_TYPE),
  fileBytes: file => file.mimetype === PDF_TYPE ? 20 * MB : 2 * MB,
  totalBytes: positiveInteger(process.env.POST_UPLOAD_TOTAL_MB, 50, 64) * MB,
  files: 16,
});

export const profileMediaUpload = createUpload({
  allowed: file => file.fieldname === "wallpaper"
    ? IMAGE_TYPES.has(file.mimetype) || file.mimetype === VIDEO_TYPE
    : IMAGE_TYPES.has(file.mimetype),
  fileBytes: file => file.fieldname === "wallpaper" ? 25 * MB : 8 * MB,
  totalBytes: positiveInteger(process.env.PROFILE_UPLOAD_TOTAL_MB, 41, 64) * MB,
  files: 3,
});

export const adminImageUpload = createUpload({
  allowed: file => file.fieldname === "image" && IMAGE_TYPES.has(file.mimetype),
  fileBytes: () => 8 * MB,
  totalBytes: 8 * MB,
  files: 1,
});

// Backward-compatible export for routes outside the explicit policies.
export const upload = createUpload({
  allowed: file => ALL_TYPES.has(file.mimetype),
  fileBytes: () => 25 * MB,
  totalBytes: 25 * MB,
  files: 1,
});

// Temporary circuit breaker for old multipart routes only. Direct-to-provider
// uploads never pass through this guard and can run concurrently at the provider.
const maximumConcurrentUploads = positiveInteger(process.env.LEGACY_MULTIPART_CONCURRENCY, 1, 8);
let activeUploads = 0;

export function uploadConcurrencyGuard(req, res, next) {
  if (!req.is("multipart/form-data")) return next();
  if (activeUploads >= maximumConcurrentUploads) {
    res.setHeader("Retry-After", "2");
    logWarn("upload.concurrency_rejected", undefined, req, {
      activeUploads,
      maximumConcurrentUploads,
    });
    return res.status(503).json({
      success: false,
      code: "UPLOAD_BUSY",
      message: "ระบบอัปโหลดกำลังมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้ง",
      retry_after: 2,
    });
  }

  activeUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

export const uploadToCloudinary = (fileBuffer, folder = "share-ed", transformation = []) => {
  if (!isSupportedFile(fileBuffer)) {
    return Promise.reject(uploadError("INVALID_UPLOAD", "Unsupported file content"));
  }
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", transformation, quality: "auto", fetch_format: "auto" },
      (error, result) => {
        if (error) {
          logError("middlewares.uploadToCloudinary", error);
          return reject(error);
        }
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};
