import express from "express";
import { getAchievements, claimAchievementReward } from "../controllers/achievement.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, getAchievements);
router.post("/:id/claim", authMiddleware, claimAchievementReward);

export default router;
