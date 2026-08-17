import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.config.js";
import { deleteFromCloudinary } from "../utils/cloudinary.helper.js";
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

// 4.1.7.3.5: แสดงรายการของรางวัล
export const getAllRewards = async (req, res) => {
  try {
    const rewards = await prisma.rewardItem.findMany({
      orderBy: { created_at: "desc" }
    });
    
    res.status(200).json({ success: true, data: rewards });
  } catch (error) {
    console.error("Get all rewards error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch rewards" });
  }
};

// 4.1.7.3.1: สร้างข้อมูลของรางวัลใหม่
export const createReward = async (req, res) => {
  try {
    const { item_name, description, item_type, is_active } = req.body;

    if (!item_name || !item_type) {
      return res.status(400).json({ success: false, message: "Missing item_name or item_type" });
    }

    if (!["THEME", "FRAME"].includes(item_type)) {
      return res.status(400).json({ success: false, message: "item_type must be THEME or FRAME" });
    }

    // Generate ID automatically using Prisma
    // Assuming uuid is string
    let image_url = null;
    
    if (req.file) {
      const result = await uploadToCloudinary(
        req.file.buffer,
        "share-ed/rewards"
      );
      image_url = result.secure_url;
    }

    const metadata = description ? { description } : {};
    const isActiveBool = is_active !== undefined ? String(is_active) === "true" : true;

    // Notice: id needs to be generated if schema uses @id without default(uuid())
    // Let's check schema: id String @id @map("item_id")
    // Wait, earlier schema showed RewardItem: `id String @id @map("item_id")` (no default(uuid))
    // We should use crypto.randomUUID()
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

    res.status(201).json({ success: true, message: "Reward created successfully", data: newReward });
  } catch (error) {
    console.error("Create reward error:", error);
    res.status(500).json({ success: false, message: "Failed to create reward" });
  }
};

// 4.1.7.3.2: แก้ไขข้อมูลของรางวัล
export const updateReward = async (req, res) => {
  try {
    const { id } = req.params;
    const { item_name, description, item_type } = req.body;

    const reward = await prisma.rewardItem.findUnique({ where: { id } });
    if (!reward) {
      return res.status(404).json({ success: false, message: "Reward not found" });
    }

    const updateData = {};
    if (item_name) updateData.item_name = item_name;
    if (item_type) {
      if (!["THEME", "FRAME"].includes(item_type)) {
         return res.status(400).json({ success: false, message: "item_type must be THEME or FRAME" });
      }
      updateData.item_type = item_type;
    }
    
    if (description !== undefined) {
      const existingMetadata = reward.metadata ? (typeof reward.metadata === 'string' ? JSON.parse(reward.metadata) : reward.metadata) : {};
      updateData.metadata = { ...existingMetadata, description };
    }

    if (req.file) {
      if (reward.image_url) await deleteFromCloudinary(reward.image_url);
      const result = await uploadToCloudinary(
        req.file.buffer,
        "share-ed/rewards"
      );
      updateData.image_url = result.secure_url;
    }

    const updatedReward = await prisma.rewardItem.update({
      where: { id },
      data: updateData
    });

    res.status(200).json({ success: true, message: "Reward updated successfully", data: updatedReward });
  } catch (error) {
    console.error("Update reward error:", error);
    res.status(500).json({ success: false, message: "Failed to update reward" });
  }
};

// 4.1.7.3.3: เปิดใช้งานและปิดใช้งานของรางวัล
export const toggleRewardStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (is_active === undefined) {
      return res.status(400).json({ success: false, message: "is_active is required" });
    }

    const reward = await prisma.rewardItem.findUnique({ where: { id } });
    if (!reward) {
      return res.status(404).json({ success: false, message: "Reward not found" });
    }

    const updatedReward = await prisma.rewardItem.update({
      where: { id },
      data: { is_active: Boolean(is_active) }
    });

    res.status(200).json({ success: true, message: "Reward status updated", data: updatedReward });
  } catch (error) {
    console.error("Toggle reward status error:", error);
    res.status(500).json({ success: false, message: "Failed to toggle reward status" });
  }
};

// 4.1.7.3.6: ลบของรางวัล
export const deleteReward = async (req, res) => {
  try {
    const { id } = req.params;

    const reward = await prisma.rewardItem.findUnique({ where: { id } });
    if (!reward) {
      return res.status(404).json({ success: false, message: "Reward not found" });
    }

    // Check if used in Achievements
    const usedInAchievements = await prisma.achievement.findFirst({
      where: { reward_item_id: id }
    });

    if (usedInAchievements) {
      return res.status(400).json({ 
        success: false, 
        message: "ไม่สามารถลบได้ เนื่องจากของรางวัลถูกนำไปผูกกับ Achievement อยู่" 
      });
    }

    // Can delete safely
    await prisma.rewardItem.delete({
      where: { id }
    });

    res.status(200).json({ success: true, message: "ลบของรางวัลเรียบร้อยแล้ว" });
  } catch (error) {
    console.error("Delete reward error:", error);
    res.status(500).json({ success: false, message: "Failed to delete reward" });
  }
};

// 4.1.7.3.4: การเชื่อมโยงของรางวัลกับเป้าหมายความสำเร็จ
export const mapRewardToAchievement = async (req, res) => {
  try {
    const { id } = req.params; // achievement ID
    const { reward_id } = req.body;

    const achievement = await prisma.achievement.findUnique({ where: { id } });
    if (!achievement) {
      return res.status(404).json({ success: false, message: "Achievement not found" });
    }

    if (reward_id) {
      const reward = await prisma.rewardItem.findUnique({ where: { id: reward_id } });
      if (!reward) {
        return res.status(404).json({ success: false, message: "Reward not found" });
      }

      if (!reward.is_active) {
        return res.status(400).json({ success: false, message: "ไม่สามารถผูกกับของรางวัลที่ Inactive ได้" });
      }
    }

    const updatedAchievement = await prisma.achievement.update({
      where: { id },
      data: { reward_item_id: reward_id || null }
    });

    res.status(200).json({ success: true, message: "Mapped reward to achievement successfully", data: updatedAchievement });
  } catch (error) {
    console.error("Map reward to achievement error:", error);
    res.status(500).json({ success: false, message: "Failed to map reward to achievement" });
  }
};
