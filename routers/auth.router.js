import express from "express";
import { verifyUser } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/me", authMiddleware, verifyUser);


export default router;
