import { requirePublishedPost } from "../middlewares/post-access.middleware.js";
import express from "express";
import { reportPost, getMyReports } from "../controllers/report.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

// POST /api/v1/reports       — ส่ง report
router.post("/", authMiddleware, requirePublishedPost(req => req.body?.post_id), reportPost);

// GET  /api/v1/reports/my    — ดู reports ที่ตัวเองส่ง
router.get("/my", authMiddleware, getMyReports);

export default router;
