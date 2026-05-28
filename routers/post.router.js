import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getUserPosts,
  getTrendingPosts,
  getMostLikedPosts
} from "../controllers/post.controller.js";

const router = express.Router();


router.get("/", getAllPosts);
router.get("/trending", getTrendingPosts);
router.get("/most-liked", getMostLikedPosts);
router.get("/user/my-posts", authMiddleware, getUserPosts);
router.get("/:id", getPostById);

//require authentication
router.post("/", authMiddleware, createPost);
router.put("/:id", authMiddleware, updatePost);
router.delete("/:id", authMiddleware, deletePost);

export default router;
