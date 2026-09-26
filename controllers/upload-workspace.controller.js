import {
  createOrReuseUploadSession,
  signUploadFile,
  completeAndVerifyAssetCore,
  getUploadSessionStatus,
  deleteUploadAsset,
  deleteUploadSession,
  UploadWorkspaceError,
} from "../utils/upload-workspace.service.js";
import { logError, logWarn } from "../utils/logger.js";
import { UPLOAD_ERROR_CODES } from "../configs/upload-workspace.constants.js";

function handleControllerError(res, error, operation, req) {
  if (error instanceof UploadWorkspaceError) {
    logWarn(`upload_workspace.${operation}.client_error`, error, req, {
      code: error.code,
      status: error.status,
    });
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  logError(`upload_workspace.${operation}.unexpected_error`, error, req);
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง",
  });
}

/**
 * POST /api/v1/posts/upload-sessions
 */
export async function createSessionHandler(req, res) {
  const started = performance.now();
  try {
    const userId = req.user?.id;
    const draftId = req.body?.draft_id || req.headers["idempotency-key"];

    const data = await createOrReuseUploadSession({
      userId,
      draftId,
    });

    const durationMs = Math.round(performance.now() - started);
    res.setHeader("Server-Timing", `upload_session_create;dur=${durationMs}`);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleControllerError(res, error, "create_session", req);
  }
}

/**
 * POST /api/v1/posts/upload-sessions/:sessionId/files/sign
 */
export async function signFileHandler(req, res) {
  const started = performance.now();
  try {
    const userId = req.user?.id;
    const { sessionId } = req.params;
    const {
      client_file_id: clientFileId,
      asset_type: assetType,
      original_name: originalName,
      content_type: contentType,
      size,
    } = req.body || {};

    const result = await signUploadFile({
      userId,
      sessionId,
      clientFileId,
      assetType,
      originalName,
      contentType,
      size,
    });

    const durationMs = Math.round(performance.now() - started);
    res.setHeader("Server-Timing", `signed_upload_issue;dur=${durationMs}`);

    return res.status(200).json(result);
  } catch (error) {
    return handleControllerError(res, error, "sign_file", req);
  }
}

/**
 * POST /api/v1/posts/upload-sessions/:sessionId/files/:assetId/complete
 */
export async function completeFileHandler(req, res) {
  const started = performance.now();
  try {
    const userId = req.user?.id;
    const { sessionId, assetId } = req.params;
    const clientPayload = req.body || {};

    const verifiedAsset = await completeAndVerifyAssetCore({
      userId,
      sessionId,
      assetId,
      clientPayload,
    });

    const durationMs = Math.round(performance.now() - started);
    res.setHeader("Server-Timing", `asset_verification;dur=${durationMs}`);

    return res.status(200).json({
      success: true,
      data: verifiedAsset,
    });
  } catch (error) {
    return handleControllerError(res, error, "complete_file", req);
  }
}

/**
 * GET /api/v1/posts/upload-sessions/:sessionId
 */
export async function getSessionStatusHandler(req, res) {
  try {
    const userId = req.user?.id;
    const { sessionId } = req.params;

    const data = await getUploadSessionStatus({
      userId,
      sessionId,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleControllerError(res, error, "get_session_status", req);
  }
}

/**
 * DELETE /api/v1/posts/upload-sessions/:sessionId/files/:assetId
 */
export async function deleteFileHandler(req, res) {
  try {
    const userId = req.user?.id;
    const { sessionId, assetId } = req.params;

    const result = await deleteUploadAsset({
      userId,
      sessionId,
      assetId,
    });

    return res.status(200).json(result);
  } catch (error) {
    return handleControllerError(res, error, "delete_file", req);
  }
}

/**
 * DELETE /api/v1/posts/upload-sessions/:sessionId
 */
export async function deleteSessionHandler(req, res) {
  try {
    const userId = req.user?.id;
    const { sessionId } = req.params;

    const result = await deleteUploadSession({
      userId,
      sessionId,
    });

    return res.status(200).json(result);
  } catch (error) {
    return handleControllerError(res, error, "delete_session", req);
  }
}
