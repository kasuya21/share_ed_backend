import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";
import {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getUserPosts,
  getTrendingPosts,
  getMostLikedPosts,
  getPlatformStats
} from "../controllers/post.controller.js";

const router = express.Router();

router.get("/stats", getPlatformStats);
router.get("/", getAllPosts);
router.get("/trending", getTrendingPosts);
router.get("/most-liked", getMostLikedPosts);
router.get("/user/my-posts", authMiddleware, getUserPosts);
router.get("/:id", authMiddleware, getPostById);

// Multi-file upload: cover_image (1) + media_files (up to 15 PDFs/images)
const postUpload = upload.fields([
  { name: "cover_image", maxCount: 1 },
  { name: "media_files", maxCount: 15 },
]);

//require authentication
router.post("/", authMiddleware, postUpload, createPost);
router.put("/:id", authMiddleware, postUpload, updatePost);
router.delete("/:id", authMiddleware, deletePost);

export default router;
