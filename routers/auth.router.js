import express from "express";
import { verifyUser, registerUser, loginUser, changePassword, logoutUser, resendVerificationEmail } from "../controllers/auth.controller.js";
import { authMiddleware, provisioningAuthMiddleware } from "../middlewares/auth.middleware.js";
import { rateLimit } from "../utils/security.js";

const router = express.Router();
const verificationResendRateLimit = rateLimit({
  limit: 3,
  windowMs: 15 * 60 * 1000,
  key: req => `email-verification:${req.ip || req.socket.remoteAddress}`,
});

// POST /api/v1/auth/register - Register a new member
router.post("/register", registerUser);

// POST /api/v1/auth/login - Log in with email/password
router.post("/login", loginUser);

// POST /api/v1/auth/resend-verification - Resend signup OTP
router.post("/resend-verification", verificationResendRateLimit, resendVerificationEmail);

// POST /api/v1/auth/logout - Log out
router.post("/logout", authMiddleware, logoutUser);

// GET /api/v1/auth/me - Verify session token (Google OAuth & standard login)
router.get("/me", provisioningAuthMiddleware, verifyUser);

// PUT /api/v1/auth/change-password - Change user password
router.put("/change-password", authMiddleware, changePassword);

export default router;
