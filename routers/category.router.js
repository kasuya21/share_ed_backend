import express from "express";
import { getAllCategories } from "../controllers/category.controller.js";

const router = express.Router();

// GET /api/v1/categories - Get all categories
router.get("/", getAllCategories);

export default router;
