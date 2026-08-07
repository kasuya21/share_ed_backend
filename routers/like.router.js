import express from "express";
import { toggleLike, getLikeStatus } from "../controllers/like.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/:postId", authMiddleware, getLikeStatus);
router.post("/:postId", authMiddleware, toggleLike);

export default router;
