import express from "express";
import { reportPost } from "../controllers/report.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", authMiddleware, reportPost);

export default router;
