import { requirePublishedPost } from "../middlewares/post-access.middleware.js";
import express from "express";
import { toggleBookmark, getBookmarks } from "../controllers/bookmark.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, getBookmarks);
router.post("/:postId", authMiddleware, requirePublishedPost(req => req.params.postId), toggleBookmark);

export default router;
