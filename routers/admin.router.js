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
import { adminImageUpload, uploadConcurrencyGuard } from "../middlewares/upload.middleware.js";

const router = express.Router();

// All routes require authentication and ADMIN role
router.use(authMiddleware, isAdmin);

const requireRoleChangeAssurance = (req, res, next) => {
  // Supabase accounts without an enrolled MFA factor always receive an aal1
  // access token. Keep MFA enforcement opt-in until the frontend provides the
  // enrollment and challenge flow; the route is still protected by isAdmin's
  // database role check and fresh admin-session requirement.
  const requireMfa = process.env.REQUIRE_MFA_FOR_ROLE_CHANGES === "true";
  if (!requireMfa || req.user?.aal === "aal2") return next();
  return res.status(403).json({
    success: false,
    code: "MFA_REQUIRED",
    message: "ต้องยืนยันตัวตนสองขั้นตอนก่อนเปลี่ยนบทบาทผู้ใช้"
  });
};

// Get all users
router.get("/users", getAllUsers);

// Change user role
router.patch("/users/:id/role", requireRoleChangeAssurance, changeUserRole);

// Ban / Unban user
router.patch("/users/:id/ban", banUser);
router.patch("/users/:id/unban", unbanUser);
router.patch("/users/:id/suspend", suspendUser);
router.patch("/users/:id/activate", activateUser);

// Reward Management
router.get("/rewards", getAllRewards);
router.post("/rewards", uploadConcurrencyGuard, adminImageUpload.single("image"), createReward);
router.put("/rewards/:id", uploadConcurrencyGuard, adminImageUpload.single("image"), updateReward);
router.patch("/rewards/:id/status", toggleRewardStatus);
router.delete("/rewards/:id", deleteReward);

// Achievement mapping
router.patch("/achievements/:id/reward", mapRewardToAchievement);

// Achievement Management
router.get("/achievements", getAllAchievements);
router.post("/achievements", uploadConcurrencyGuard, adminImageUpload.single("image"), createAchievement);
router.put("/achievements/:id", uploadConcurrencyGuard, adminImageUpload.single("image"), updateAchievement);
router.delete("/achievements/:id", deleteAchievement);

// Category Management
router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

export default router;
