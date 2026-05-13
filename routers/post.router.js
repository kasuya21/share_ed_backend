import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  getUserPosts
} from "../controllers/post.controller.js";

const router = express.Router();


router.get("/", getAllPosts);
router.get("/:id", getPostById);

//require authentication
router.post("/", authMiddleware, createPost);
router.put("/:id", authMiddleware, updatePost);
router.delete("/:id", authMiddleware, deletePost);
router.get("/user/my-posts", authMiddleware, getUserPosts);

export default router;
