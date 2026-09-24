import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.config.js";
import { deleteFromCloudinary } from "../utils/cloudinary.helper.js";
import crypto from "crypto";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function isAnimatedPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const next = offset + 12 + length;
    if (next > buffer.length) return false;
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset = next;
  }
  return false;
}

export function rewardUploadOptions(fileBuffer, folder) {
  if (!isAnimatedPng(fileBuffer)) return { folder, resource_type: "image" };

  // Cloudinary's image pipeline can flatten APNGs during ingestion. Raw assets
  // retain the exact bytes; keeping a .png suffix also gives browsers the
  // correct content type when the returned URL is rendered in an <img>.
  return {
    folder,
    public_id: `${crypto.randomUUID()}.png`,
    resource_type: "raw",
  };
}

const uploadToCloudinary = async (fileBuffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      rewardUploadOptions(fileBuffer, folder),
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
    logError("controllers.getAllRewards", error, req);
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
    logError("controllers.createReward", error, req);
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
      if (reward.image_url) {
        const resourceType = reward.image_url.includes("/raw/upload/") ? "raw" : "image";
        await deleteFromCloudinary(reward.image_url, resourceType);
      }
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
    logError("controllers.updateReward", error, req);
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
    logError("controllers.toggleRewardStatus", error, req);
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

    // Clean up user equipment, unlocked items, and delete reward
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { current_frame_id: id },
        data: { current_frame_id: null },
      }),
      prisma.user.updateMany({
        where: { current_theme_id: id },
        data: { current_theme_id: null },
      }),
      prisma.userUnlockedItem.deleteMany({
        where: { item_id: id },
      }),
      prisma.rewardItem.delete({
        where: { id },
      }),
    ]);

    if (reward.image_url) {
      const resourceType = reward.image_url.includes("/raw/upload/") ? "raw" : "image";
      await deleteFromCloudinary(reward.image_url, resourceType);
    }

    res.status(200).json({ success: true, message: "ลบของรางวัลเรียบร้อยแล้ว" });
  } catch (error) {
    logError("controllers.deleteReward", error, req);
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
    logError("controllers.mapRewardToAchievement", error, req);
    res.status(500).json({ success: false, message: "Failed to map reward to achievement" });
  }
};
