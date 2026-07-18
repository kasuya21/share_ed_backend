import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing
} from "../controllers/follow.controller.js";

const router = express.Router();

// GET  /api/v1/follow/:userId/followers  — ดูรายชื่อ followers ของ user (public)
router.get("/:userId/followers", getFollowers);

// GET  /api/v1/follow/:userId/following  — ดูรายชื่อที่ user กำลังตาม (public)
router.get("/:userId/following", getFollowing);

// POST   /api/v1/follow/:userId          — กดติดตาม (ต้อง login)
router.post("/:userId", authMiddleware, followUser);

// DELETE /api/v1/follow/:userId          — ยกเลิกติดตาม (ต้อง login)
router.delete("/:userId", authMiddleware, unfollowUser);

export default router;
