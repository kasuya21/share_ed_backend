import express from "express";
import {
  createQuest,
  getAllQuests,
  updateQuest,
  deleteQuest,
  getUserQuests,
  updateQuestProgress,
  claimQuestReward,
} from "../controllers/quest.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

// User APIs (needs authentication)
router.get("/user", authMiddleware, getUserQuests);
router.post("/progress", authMiddleware, updateQuestProgress);
router.post("/claim", authMiddleware, claimQuestReward);

// Global Quests / Admin APIs
// (You might want to add role-based middleware for create/update/delete later)
router.get("/", getAllQuests);
router.post("/", authMiddleware, createQuest);
router.put("/:id", authMiddleware, updateQuest);
router.delete("/:id", authMiddleware, deleteQuest);

export default router;
