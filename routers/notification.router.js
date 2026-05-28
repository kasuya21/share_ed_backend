import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
} from "../controllers/notification.controller.js";

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// GET  /api/v1/notifications           — ดึงการแจ้งเตือนทั้งหมด
router.get("/", getMyNotifications);

// PATCH /api/v1/notifications/read-all — อ่านทั้งหมด (ต้องอยู่ก่อน /:id)
router.patch("/read-all", markAllAsRead);

// PATCH /api/v1/notifications/:id/read — อ่านรายการเดียว
router.patch("/:id/read", markAsRead);

// DELETE /api/v1/notifications/:id
router.delete("/:id", deleteNotification);

export default router;
