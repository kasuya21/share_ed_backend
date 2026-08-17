import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.config.js";
import crypto from "crypto";

// Helper for Cloudinary Uploads
const uploadToCloudinary = async (fileBuffer, folder, transformation = []) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        transformation,
        quality: "auto",
        fetch_format: "auto"
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(fileBuffer);
  });
};

// GET /api/v1/admin/achievements
export const getAllAchievements = async (req, res) => {
  try {
    const achievements = await prisma.achievement.findMany({
      include: {
        reward_item: true,
      },
      orderBy: { created_at: "desc" },
    });
    res.status(200).json({ success: true, data: achievements });
  } catch (error) {
    console.error("Get all achievements error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch achievements" });
  }
};

// POST /api/v1/admin/achievements
export const createAchievement = async (req, res) => {
  try {
    // Basic achievement fields
    const { title, description, target_value, achievement_type } = req.body;
    // Reward fields (optional)
    let { reward_item_id } = req.body;
    const { item_name, item_type, item_description, is_active } = req.body;

    if (!title || !description || target_value === undefined || !achievement_type) {
      return res.status(400).json({ success: false, message: "Missing required achievement fields" });
    }

    // If reward_item_id is provided, check if it exists
    if (reward_item_id) {
      const reward = await prisma.rewardItem.findUnique({ where: { id: reward_item_id } });
      if (!reward) {
        return res.status(404).json({ success: false, message: "Reward item not found" });
      }
      if (!reward.is_active) {
        return res.status(400).json({ success: false, message: "ไม่สามารถเลือกของรางวัลที่มีสถานะปิดใช้งานได้" });
      }
    } else if (item_name && item_type) {
      // Create new reward inline
      if (!["THEME", "FRAME"].includes(item_type)) {
        return res.status(400).json({ success: false, message: "item_type must be THEME or FRAME" });
      }
      let image_url = null;
      if (req.file) {
        const result = await uploadToCloudinary(req.file.buffer, "share-ed/rewards");
        image_url = result.secure_url;
      }
      const metadata = item_description ? { description: item_description } : {};
      const isActiveBool = is_active !== undefined ? String(is_active) === "true" : true;

      const newReward = await prisma.rewardItem.create({
        data: {
          id: crypto.randomUUID(),
          item_name,
          item_type,
          image_url,
          metadata,
          is_active: isActiveBool
        }
      });
      reward_item_id = newReward.id;
    }

    const achievement = await prisma.achievement.create({
      data: {
        title,
        description,
        target_value: parseInt(target_value, 10),
        achievement_type,
        reward_item_id: reward_item_id || null,
      },
    });

    res.status(201).json({ success: true, message: "Achievement created successfully", data: achievement });
  } catch (error) {
    console.error("Create achievement error:", error);
    res.status(500).json({ success: false, message: "Failed to create achievement" });
  }
};

// PUT /api/v1/admin/achievements/:id
export const updateAchievement = async (req, res) => {
  try {
    const { id } = req.params;
    // Basic achievement fields
    const { title, description, target_value, achievement_type } = req.body;
    // Reward fields (optional)
    let { reward_item_id } = req.body;
    const { item_name, item_type, item_description, is_active } = req.body;

    const existingAchievement = await prisma.achievement.findUnique({ where: { id } });
    if (!existingAchievement) {
      return res.status(404).json({ success: false, message: "Achievement not found" });
    }

    // If an existing reward_item_id is provided directly
    if (reward_item_id) {
      const reward = await prisma.rewardItem.findUnique({ where: { id: reward_item_id } });
      if (!reward) {
        return res.status(404).json({ success: false, message: "Reward item not found" });
      }
      if (!reward.is_active) {
        return res.status(400).json({ success: false, message: "ไม่สามารถเลือกของรางวัลที่มีสถานะปิดใช้งานได้" });
      }
    } else if (item_name && item_type) {
      // Create new reward inline
      if (!["THEME", "FRAME"].includes(item_type)) {
        return res.status(400).json({ success: false, message: "item_type must be THEME or FRAME" });
      }
      let image_url = null;
      if (req.file) {
        const result = await uploadToCloudinary(req.file.buffer, "share-ed/rewards");
        image_url = result.secure_url;
      }
      const metadata = item_description ? { description: item_description } : {};
      const isActiveBool = is_active !== undefined ? String(is_active) === "true" : true;

      const newReward = await prisma.rewardItem.create({
        data: {
          id: crypto.randomUUID(),
          item_name,
          item_type,
          image_url,
          metadata,
          is_active: isActiveBool
        }
      });
      reward_item_id = newReward.id;
    }

    const updateData = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (target_value !== undefined) updateData.target_value = parseInt(target_value, 10);
    if (achievement_type) updateData.achievement_type = achievement_type;

    // Explicitly check for null vs undefined to allow unsetting reward
    if (reward_item_id !== undefined) {
      updateData.reward_item_id = reward_item_id;
    }

    const updatedAchievement = await prisma.achievement.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({ success: true, message: "Achievement updated successfully", data: updatedAchievement });
  } catch (error) {
    console.error("Update achievement error:", error);
    res.status(500).json({ success: false, message: "Failed to update achievement" });
  }
};

// DELETE /api/v1/admin/achievements/:id
export const deleteAchievement = async (req, res) => {
  try {
    const { id } = req.params;

    const existingAchievement = await prisma.achievement.findUnique({ where: { id } });
    if (!existingAchievement) {
      return res.status(404).json({ success: false, message: "Achievement not found" });
    }

    // Check if there are user achievements associated
    const userAchievementsCount = await prisma.userAchievement.count({
      where: { achievement_id: id }
    });

    if (userAchievementsCount > 0) {
      return res.status(400).json({ success: false, message: "Cannot delete achievement, users have progress on it" });
    }

    await prisma.achievement.delete({
      where: { id },
    });

    res.status(200).json({ success: true, message: "Achievement deleted successfully" });
  } catch (error) {
    console.error("Delete achievement error:", error);
    res.status(500).json({ success: false, message: "Failed to delete achievement" });
  }
};
