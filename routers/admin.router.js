import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { isAdmin } from "../middlewares/role.middleware.js";
import {
  getAllUsers,
  changeUserRole
} from "../controllers/admin.controller.js";

const router = express.Router();

// All routes require authentication and ADMIN role
router.use(authMiddleware, isAdmin);

// Get all users
router.get("/users", getAllUsers);

// Change user role
router.patch("/users/:id/role", changeUserRole);

export default router;
