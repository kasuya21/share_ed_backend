import express from "express";
import { verifyUser, registerUser, loginUser, changePassword, logoutUser } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

// POST /api/v1/auth/register - Register a new member
router.post("/register", registerUser);

// POST /api/v1/auth/login - Log in with email/password
router.post("/login", loginUser);

// POST /api/v1/auth/logout - Log out
router.post("/logout", authMiddleware, logoutUser);

// GET /api/v1/auth/me - Verify session token (Google OAuth & standard login)
router.get("/me", authMiddleware, verifyUser);

// PUT /api/v1/auth/change-password - Change user password
router.put("/change-password", authMiddleware, changePassword);

export default router;
