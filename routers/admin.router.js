import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { isAdmin } from "../middlewares/role.middleware.js";
import {
  getAllUsers,
  changeUserRole,
  banUser,
  unbanUser,
  suspendUser,
  activateUser
} from "../controllers/admin.controller.js";
import {
  getAllRewards,
  createReward,
  updateReward,
  toggleRewardStatus,
  deleteReward,
  mapRewardToMilestone
} from "../controllers/admin.reward.controller.js";
import {
  getAllMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone
} from "../controllers/admin.milestone.controller.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = express.Router();

// All routes require authentication and ADMIN role
router.use(authMiddleware, isAdmin);

// Get all users
router.get("/users", getAllUsers);

// Change user role
router.patch("/users/:id/role", changeUserRole);

// Ban / Unban user
router.patch("/users/:id/ban", banUser);
router.patch("/users/:id/unban", unbanUser);
router.patch("/users/:id/suspend", suspendUser);
router.patch("/users/:id/activate", activateUser);

// Reward Management
router.get("/rewards", getAllRewards);
router.post("/rewards", upload.single("image"), createReward);
router.put("/rewards/:id", upload.single("image"), updateReward);
router.patch("/rewards/:id/status", toggleRewardStatus);
router.delete("/rewards/:id", deleteReward);

// Milestone mapping
router.patch("/milestones/:id/reward", mapRewardToMilestone);

// Milestone Management
router.get("/milestones", getAllMilestones);
router.post("/milestones", upload.single("image"), createMilestone);
router.put("/milestones/:id", upload.single("image"), updateMilestone);
router.delete("/milestones/:id", deleteMilestone);

export default router;
