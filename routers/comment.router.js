import express from "express";
import {
  createComment,
  getCommentsByPost,
  deleteComment,
  updateComment
} from "../controllers/comment.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", authMiddleware, createComment);
router.get("/post/:postId", getCommentsByPost);
router.delete("/:id", authMiddleware, deleteComment);
router.put("/:id", authMiddleware, updateComment);

export default router;
