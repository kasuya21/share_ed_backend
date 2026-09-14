import { requirePublishedPost } from "../middlewares/post-access.middleware.js";
import express from "express";
import { toggleLike, getLikeStatus } from "../controllers/like.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/:postId", authMiddleware, requirePublishedPost(req => req.params.postId), getLikeStatus);
router.post("/:postId", authMiddleware, requirePublishedPost(req => req.params.postId), toggleLike);

export default router;
