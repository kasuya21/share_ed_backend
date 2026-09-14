import { requirePublishedPost } from "../middlewares/post-access.middleware.js";
import express from "express";
import {
  createComment,
  getCommentsByPost,
  deleteComment,
  updateComment
} from "../controllers/comment.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", authMiddleware, requirePublishedPost(req => req.body?.post_id), createComment);
router.get("/post/:postId", requirePublishedPost(req => req.params.postId), getCommentsByPost);
router.delete("/:id", authMiddleware, deleteComment);
router.put("/:id", authMiddleware, updateComment);

export default router;
