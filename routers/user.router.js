import express from "express";
import { updateProfile, equipItem, getPublicProfile } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = express.Router();

// GET  /api/v1/users/:id     — ดูโปรไฟล์ผู้ใช้ (public)
router.get("/:id", getPublicProfile);

// PUT  /api/v1/users/profile — แก้ไขโปรไฟล์ตัวเอง (ต้อง login)
// รับ multipart/form-data: field "profile_image" คือไฟล์รูป (optional)
router.put("/profile", authMiddleware, upload.single("profile_image"), updateProfile);

// PUT  /api/v1/users/equip   — สวมใส่ Theme/Frame (ต้อง login)
router.put("/equip", authMiddleware, equipItem);

export default router;

