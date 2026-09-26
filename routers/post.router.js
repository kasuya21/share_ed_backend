import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { postUpload, uploadConcurrencyGuard } from "../middlewares/upload.middleware.js";
import { rateLimit } from "../utils/security.js";
import {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getUserPosts,
  getTrendingPosts,
  getMostLikedPosts,
  getPlatformStats,
  getUploadSignature,
  getUploadSignatures,
  getPdfUploadSignature,
  downloadPostMedia,
} from "../controllers/post.controller.js";
import {
  createSessionHandler,
  signFileHandler,
  completeFileHandler,
  getSessionStatusHandler,
  deleteFileHandler,
  deleteSessionHandler,
} from "../controllers/upload-workspace.controller.js";
import { uploadRateLimit } from "../utils/upload-rate-limiter.js";


const router = express.Router();

router.get("/stats", getPlatformStats);
router.get("/", getAllPosts);
router.get("/trending", getTrendingPosts);
router.get("/most-liked", getMostLikedPosts);
router.get("/user/my-posts", authMiddleware, getUserPosts);
const uploadSignatureRateLimit = rateLimit({
  limit: 15,
  windowMs: 60_000,
  key: req => req.user?.id || req.ip || req.socket.remoteAddress,
});
router.get("/upload-signature", authMiddleware, uploadSignatureRateLimit, getUploadSignature);
router.post("/upload-signatures", authMiddleware, uploadSignatureRateLimit, getUploadSignatures);
router.post("/upload-signatures/pdf", authMiddleware, uploadSignatureRateLimit, getPdfUploadSignature);

// ─── Upload Workspace V2 Endpoints ───
router.post("/upload-sessions", authMiddleware, uploadRateLimit({ type: "SESSION" }), createSessionHandler);
router.get("/upload-sessions/:sessionId", authMiddleware, getSessionStatusHandler);
router.delete("/upload-sessions/:sessionId", authMiddleware, deleteSessionHandler);
router.post("/upload-sessions/:sessionId/files/sign", authMiddleware, uploadRateLimit({ type: "FILE_SIGN" }), signFileHandler);
router.post("/upload-sessions/:sessionId/files/:assetId/complete", authMiddleware, completeFileHandler);
router.delete("/upload-sessions/:sessionId/files/:assetId", authMiddleware, deleteFileHandler);

router.get("/:postId/media/:mediaId/download", authMiddleware, downloadPostMedia);
router.get("/:id", authMiddleware, getPostById);

// Multi-file upload: cover_image (1) + media_files (up to 15 PDFs/images)
const postFiles = postUpload.fields([
  { name: "cover_image", maxCount: 1 },
  { name: "media_files", maxCount: 15 },
]);

const postOperation = operation => (req, res, next) => {
  req.logOperation = operation;
  next();
};

//require authentication
router.post("/", postOperation("post.create"), authMiddleware, uploadConcurrencyGuard, postFiles, createPost);
router.put("/:id", postOperation("post.update"), authMiddleware, uploadConcurrencyGuard, postFiles, updatePost);
router.delete("/:id", postOperation("post.delete"), authMiddleware, deletePost);

export default router;
