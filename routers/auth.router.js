import express from "express";
import { verifyUser, registerUser, loginUser } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

// POST /api/v1/auth/register - Register a new member
router.post("/register", registerUser);

// POST /api/v1/auth/login - Log in with email/password
router.post("/login", loginUser);

// GET /api/v1/auth/me - Verify session token (Google OAuth & standard login)
router.get("/me", authMiddleware, verifyUser);

export default router;
