import express from "express";
import { toggleLike } from "../controllers/like.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/:postId", authMiddleware, toggleLike);

export default router;
