import express from "express";
import { getMilestones, claimMilestoneReward } from "../controllers/milestone.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, getMilestones);
router.post("/:id/claim", authMiddleware, claimMilestoneReward);

export default router;
