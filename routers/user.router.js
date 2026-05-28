import express from "express";
import { updateProfile, equipItem } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.put("/profile", authMiddleware, updateProfile);
router.put("/equip", authMiddleware, equipItem);

export default router;
