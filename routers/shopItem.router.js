import express from "express";
import {
  getAllShopItems,
  getShopItemById,
  createShopItem,
  updateShopItem,
  deleteShopItem,
  purchaseShopItem,
} from "../controllers/shopItem.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Public routes
router.get("/", getAllShopItems);
router.get("/:id", getShopItemById);

// Admin routes (auth required)
router.post("/", authMiddleware, createShopItem);
router.put("/:id", authMiddleware, updateShopItem);
router.delete("/:id", authMiddleware, deleteShopItem);

// Purchase route (auth required)
router.post("/:id/purchase", authMiddleware, purchaseShopItem);

export default router;
