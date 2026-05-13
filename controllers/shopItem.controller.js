import { prisma } from "../configs/prisma.js";

// GET /shop-items — list all active shop items
export const getAllShopItems = async (req, res) => {
  try {
    const { item_type } = req.query;

    const where = { is_active: true };
    if (item_type) {
      where.item_type = item_type; // "THEME" or "FRAME"
    }

    const items = await prisma.shopItem.findMany({
      where,
      orderBy: { price: "asc" },
    });

    res.json(items);
  } catch (error) {
    console.error("getAllShopItems error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// GET /shop-items/:id — get a single shop item
export const getShopItemById = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await prisma.shopItem.findUnique({
      where: { id },
    });

    if (!item) {
      return res.status(404).json({ message: "Shop item not found" });
    }

    res.json(item);
  } catch (error) {
    console.error("getShopItemById error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// POST /shop-items — create a new shop item (admin)
export const createShopItem = async (req, res) => {
  try {
    const { id, item_name, item_type, price, image_url } = req.body;

    if (!id || !item_name || !item_type || price == null) {
      return res.status(400).json({
        message: "Missing required fields: id, item_name, item_type, price",
      });
    }

    if (!["THEME", "FRAME"].includes(item_type)) {
      return res
        .status(400)
        .json({ message: "item_type must be THEME or FRAME" });
    }

    const item = await prisma.shopItem.create({
      data: {
        id,
        item_name,
        item_type,
        price,
        image_url: image_url || null,
      },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error("createShopItem error:", error);

    if (error.code === "P2002") {
      return res
        .status(409)
        .json({ message: "Shop item with this ID already exists" });
    }

    res.status(500).json({ message: "Server error" });
  }
};

// PUT /shop-items/:id — update a shop item (admin)
export const updateShopItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { item_name, item_type, price, image_url, is_active } = req.body;

    const existing = await prisma.shopItem.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Shop item not found" });
    }

    if (item_type && !["THEME", "FRAME"].includes(item_type)) {
      return res
        .status(400)
        .json({ message: "item_type must be THEME or FRAME" });
    }

    const data = {};
    if (item_name !== undefined) data.item_name = item_name;
    if (item_type !== undefined) data.item_type = item_type;
    if (price !== undefined) data.price = price;
    if (image_url !== undefined) data.image_url = image_url;
    if (is_active !== undefined) data.is_active = is_active;

    const item = await prisma.shopItem.update({
      where: { id },
      data,
    });

    res.json(item);
  } catch (error) {
    console.error("updateShopItem error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// DELETE /shop-items/:id — soft-delete (deactivate) a shop item (admin)
export const deleteShopItem = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.shopItem.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Shop item not found" });
    }

    await prisma.shopItem.update({
      where: { id },
      data: { is_active: false },
    });

    res.json({ message: "Shop item deactivated" });
  } catch (error) {
    console.error("deleteShopItem error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// POST /shop-items/:id/purchase — purchase a shop item
export const purchaseShopItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: itemId } = req.params;

    // 1. Find the item
    const item = await prisma.shopItem.findUnique({ where: { id: itemId } });
    if (!item || !item.is_active) {
      return res
        .status(404)
        .json({ message: "Shop item not found or not available" });
    }

    // 2. Check if user already purchased this item
    const existingPurchase = await prisma.purchase.findFirst({
      where: { user_id: userId, item_id: itemId },
    });
    if (existingPurchase) {
      return res
        .status(409)
        .json({ message: "You already own this item" });
    }

    // 3. Get user and check coin balance
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.coin_balance < item.price) {
      return res.status(400).json({ message: "Insufficient coins" });
    }

    // 4. Execute purchase in a transaction
    const [purchase, updatedUser] = await prisma.$transaction([
      prisma.purchase.create({
        data: {
          user_id: userId,
          item_id: itemId,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          coin_balance: { decrement: item.price },
        },
      }),
    ]);

    res.status(201).json({
      message: "Purchase successful",
      purchase,
      coin_balance: updatedUser.coin_balance,
    });
  } catch (error) {
    console.error("purchaseShopItem error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
