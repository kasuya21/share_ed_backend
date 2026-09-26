const MB = 1024 * 1024;

export const UPLOAD_WORKSPACE_LIMITS = Object.freeze({
  MAX_FILES: 15,
  MAX_TOTAL_BYTES: 50 * MB, // 52,428,800 bytes
  MAX_PDF_BYTES: 20 * MB,   // 20,971,520 bytes
  MAX_IMAGE_BYTES: 2 * MB,  // 2,097,152 bytes
  SESSION_TTL_MS: 2 * 60 * 60 * 1000, // 2 hours
  CLEANUP_GRACE_PERIOD_MS: 24 * 60 * 60 * 1000, // 24 hours
  DOWNLOAD_URL_TTL_SECONDS: 300,
});

export const UPLOAD_RATE_LIMITS = Object.freeze({
  SESSION: Object.freeze({
    WINDOW_MS: 60 * 60 * 1000, // 1 hour
    MAX_REQUESTS: 10,
    BURST: 5,
  }),
  FILE_SIGN: Object.freeze({
    WINDOW_MS: 60 * 60 * 1000, // 1 hour
    MAX_REQUESTS: 60,
    BURST: 20,
  }),
});

export const WORKER_CONCURRENCY = Object.freeze({
  VERIFICATION: 3,
  CLEANUP: 2,
  NOTIFICATION: 5,
  ACHIEVEMENT: 3,
});

export const UPLOAD_ERROR_CODES = Object.freeze({
  INVALID_UPLOAD_SESSION: "INVALID_UPLOAD_SESSION",
  UPLOAD_SESSION_EXPIRED: "UPLOAD_SESSION_EXPIRED",
  UPLOAD_SESSION_FORBIDDEN: "UPLOAD_SESSION_FORBIDDEN",
  UPLOAD_ASSET_NOT_FOUND: "UPLOAD_ASSET_NOT_FOUND",
  UPLOAD_ASSET_CONFLICT: "UPLOAD_ASSET_CONFLICT",
  INVALID_IMAGE: "INVALID_IMAGE",
  INVALID_PDF: "INVALID_PDF",
  PDF_TOO_LARGE: "PDF_TOO_LARGE",
  TOTAL_UPLOAD_TOO_LARGE: "TOTAL_UPLOAD_TOO_LARGE",
  UPLOAD_VERIFICATION_FAILED: "UPLOAD_VERIFICATION_FAILED",
  STORAGE_PROVIDER_ERROR: "STORAGE_PROVIDER_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
});

export const ALLOWED_IMAGE_FORMATS = Object.freeze(["jpg", "jpeg", "png", "webp", "apng"]);
export const ALLOWED_IMAGE_MIMES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/apng",
]);

export const ALLOWED_PDF_FORMATS = Object.freeze(["pdf"]);
export const ALLOWED_PDF_MIMES = Object.freeze(["application/pdf", "application/x-pdf"]);

export const UUID_V4_OR_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const UUID_GENERAL_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(str) {
  return typeof str === "string" && UUID_GENERAL_REGEX.test(str.trim());
}

export const UPLOAD_WORKSPACE_V2_ENABLED = () =>
  process.env.UPLOAD_WORKSPACE_V2_ENABLED !== "false";
