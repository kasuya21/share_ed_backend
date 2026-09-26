import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import { deleteFromCloudinary } from "../utils/cloudinary.helper.js";
import cloudinary from "../configs/cloudinary.config.js";
import crypto from "crypto";
import { SUPPORTED_ACHIEVEMENT_TYPES } from "../utils/achievement.helper.js";

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
    logError("controllers.getAllAchievements", error, req);
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
    const parsedTargetValue = Number(target_value);
    if (!Number.isInteger(parsedTargetValue) || parsedTargetValue < 1) {
      return res.status(400).json({ success: false, message: "target_value must be a positive integer" });
    }
    if (!SUPPORTED_ACHIEVEMENT_TYPES.includes(achievement_type)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported achievement_type. Use: ${SUPPORTED_ACHIEVEMENT_TYPES.join(", ")}`,
      });
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
      if (item_type !== "FRAME") {
        return res.status(400).json({ success: false, message: "item_type must be FRAME" });
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
        target_value: parsedTargetValue,
        achievement_type,
        reward_item_id: reward_item_id || null,
      },
    });

    res.status(201).json({ success: true, message: "Achievement created successfully", data: achievement });
  } catch (error) {
    logError("controllers.createAchievement", error, req);
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
    if (target_value !== undefined) {
      const parsedTargetValue = Number(target_value);
      if (!Number.isInteger(parsedTargetValue) || parsedTargetValue < 1) {
        return res.status(400).json({ success: false, message: "target_value must be a positive integer" });
      }
    }
    if (achievement_type && !SUPPORTED_ACHIEVEMENT_TYPES.includes(achievement_type)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported achievement_type. Use: ${SUPPORTED_ACHIEVEMENT_TYPES.join(", ")}`,
      });
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
      if (item_type !== "FRAME") {
        return res.status(400).json({ success: false, message: "item_type must be FRAME" });
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
    if (target_value !== undefined) updateData.target_value = Number(target_value);
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
    logError("controllers.updateAchievement", error, req);
    res.status(500).json({ success: false, message: "Failed to update achievement" });
  }
};

// DELETE /api/v1/admin/achievements/:id
export const deleteAchievement = async (req, res) => {
  try {
    const { id } = req.params;

    const existingAchievement = await prisma.achievement.findUnique({
      where: { id },
      include: { reward_item: true },
    });
    if (!existingAchievement) {
      return res.status(404).json({ success: false, message: "Achievement not found" });
    }

    const reward = existingAchievement.reward_item;
    const rewardId = existingAchievement.reward_item_id;

    // ตรวจสอบว่ามี Achievement อื่นใช้ Reward นี้ร่วมกันอยู่หรือไม่
    let shouldDeleteReward = false;
    if (rewardId) {
      const otherAchievementsCount = await prisma.achievement.count({
        where: {
          reward_item_id: rewardId,
          id: { not: id },
        },
      });
      shouldDeleteReward = otherAchievementsCount === 0;
    }

    const transactionSteps = [
      // 1. ลบความคืบหน้าของผู้ใช้ทั้งหมดสำหรับ Achievement นี้
      prisma.userAchievement.deleteMany({
        where: { achievement_id: id },
      }),
      // 2. ลบ Achievement
      prisma.achievement.delete({
        where: { id },
      }),
    ];

    if (shouldDeleteReward && rewardId) {
      // 3. รีเซ็ตกรอบสำหรับผู้ใช้ที่กำลังสวมใส่อยู่
      transactionSteps.push(
        prisma.user.updateMany({
          where: { current_frame_id: rewardId },
          data: { current_frame_id: null },
        }),
        // 4. ลบประวัติการปลดล็อกไอเทมของผู้ใช้
        prisma.userUnlockedItem.deleteMany({
          where: { item_id: rewardId },
        }),
        // 5. ลบของรางวัล/กรอบ (RewardItem) ออกจากระบบ
        prisma.rewardItem.delete({
          where: { id: rewardId },
        })
      );
    }

    await prisma.$transaction(transactionSteps);

    // 6. ลบรูปกรอบออกจาก Cloudinary เมื่อลบของรางวัลสำเร็จ
    if (shouldDeleteReward && reward?.image_url) {
      const resourceType = reward.image_url.includes("/raw/upload/") ? "raw" : "image";
      await deleteFromCloudinary(reward.image_url, resourceType);
    }

    res.status(200).json({
      success: true,
      message: shouldDeleteReward
        ? "ลบความสำเร็จและกรอบรางวัลเรียบร้อยแล้ว"
        : "ลบความสำเร็จเรียบร้อยแล้ว",
    });
  } catch (error) {
    logError("controllers.deleteAchievement", error, req);
    res.status(500).json({ success: false, message: "Failed to delete achievement" });
  }
};
