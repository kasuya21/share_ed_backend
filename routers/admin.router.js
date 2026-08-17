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
  mapRewardToAchievement
} from "../controllers/admin.reward.controller.js";
import {
  getAllAchievements,
  createAchievement,
  updateAchievement,
  deleteAchievement
} from "../controllers/admin.achievement.controller.js";
import {
  createCategory,
  updateCategory,
  deleteCategory
} from "../controllers/category.controller.js";
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

// Achievement mapping
router.patch("/achievements/:id/reward", mapRewardToAchievement);

// Achievement Management
router.get("/achievements", getAllAchievements);
router.post("/achievements", upload.single("image"), createAchievement);
router.put("/achievements/:id", upload.single("image"), updateAchievement);
router.delete("/achievements/:id", deleteAchievement);

// Category Management
router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

export default router;
