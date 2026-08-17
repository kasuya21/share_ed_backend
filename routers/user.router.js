import express from "express";
import { updateProfile, updateProfileWithMedia, equipItem, getPublicProfile, onboardUser, getUserInventory } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = express.Router();

// GET  /api/v1/users/me/inventory — ดึงรายการของรางวัลที่ปลดล็อกแล้วทั้งหมด
router.get("/me/inventory", authMiddleware, getUserInventory);

// GET  /api/v1/users/:id     — ดูโปรไฟล์ผู้ใช้ (public)
router.get("/:id", getPublicProfile);

// PUT  /api/v1/users/profile — แก้ไขโปรไฟล์ตัวเอง (ต้อง login)
// รับ multipart/form-data: field "profile_image", "wallpaper", "profile_banner" (optional)
const profileUpload = upload.fields([
  { name: "profile_image", maxCount: 1 },
  { name: "wallpaper", maxCount: 1 },
  { name: "profile_banner", maxCount: 1 }
]);
router.put("/profile", authMiddleware, profileUpload, updateProfile);

router.put(
  "/profile/with-media",
  authMiddleware,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "banner", maxCount: 1 },
    { name: "wallpaper", maxCount: 1 }
  ]),
  updateProfileWithMedia
);

// PUT  /api/v1/users/equip   — สวมใส่ Theme/Frame (ต้อง login)
router.put("/equip", authMiddleware, equipItem);

// PUT  /api/v1/users/onboard — กรอกข้อมูลครั้งแรก
router.put("/onboard", authMiddleware, onboardUser);

export default router;
