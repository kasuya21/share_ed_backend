import express from "express";
import { toggleBookmark, getBookmarks } from "../controllers/bookmark.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, getBookmarks);
router.post("/:postId", authMiddleware, toggleBookmark);

export default router;
