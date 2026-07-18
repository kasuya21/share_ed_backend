import express from "express";
import { getReportedPosts, actionOnPost } from "../controllers/moderator.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { isModeratorOrAdmin } from "../middlewares/role.middleware.js";

const router = express.Router();

router.use(authMiddleware, isModeratorOrAdmin);

router.get("/reports", getReportedPosts);
router.post("/posts/:post_id/action", actionOnPost);

export default router;
