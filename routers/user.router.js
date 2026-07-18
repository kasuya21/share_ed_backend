import express from "express";
import { updateProfile, updateProfileWithMedia, equipItem, getUserById } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = express.Router();

router.put("/profile", authMiddleware, updateProfile);
router.put(
  "/profile/with-media",
  authMiddleware,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "banner", maxCount: 1 },
    { name: "wallpaper", maxCount: 1 },
  ]),
  updateProfileWithMedia
);
router.put("/equip", authMiddleware, equipItem);
router.get("/:id", getUserById);

export default router;
