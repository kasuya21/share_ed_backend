import express from "express";
import { getReportedPosts, actionOnPost } from "../controllers/moderator.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { isAdmin } from "../middlewares/role.middleware.js";

const router = express.Router();

router.use(authMiddleware, isAdmin);

router.get("/reports", getReportedPosts);
router.post("/posts/:post_id/action", actionOnPost);

export default router;
