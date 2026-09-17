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
  getUploadSignatures
} from "../controllers/post.controller.js";

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
