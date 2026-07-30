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

// GET /api/v1/admin/milestones
export const getAllMilestones = async (req, res) => {
  try {
    const milestones = await prisma.milestone.findMany({
      include: {
        reward_item: true,
      },
      orderBy: { created_at: "desc" },
    });
    res.status(200).json({ success: true, data: milestones });
  } catch (error) {
    console.error("Get all milestones error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch milestones" });
  }
};

// POST /api/v1/admin/milestones
export const createMilestone = async (req, res) => {
  try {
    // Basic milestone fields
    const { title, description, target_value, milestone_type } = req.body;
    // Reward fields (optional)
    let { reward_item_id } = req.body;
    const { item_name, item_type, item_description, is_active } = req.body;

    if (!title || !description || target_value === undefined || !milestone_type) {
      return res.status(400).json({ success: false, message: "Missing required milestone fields" });
    }

    // If reward_item_id is provided, check if it exists
    if (reward_item_id) {
      const reward = await prisma.rewardItem.findUnique({ where: { id: reward_item_id } });
      if (!reward) {
        return res.status(404).json({ success: false, message: "Reward item not found" });
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

    const milestone = await prisma.milestone.create({
      data: {
        title,
        description,
        target_value: parseInt(target_value, 10),
        milestone_type,
        reward_item_id: reward_item_id || null,
      },
    });

    res.status(201).json({ success: true, message: "Milestone created successfully", data: milestone });
  } catch (error) {
    console.error("Create milestone error:", error);
    res.status(500).json({ success: false, message: "Failed to create milestone" });
  }
};

// PUT /api/v1/admin/milestones/:id
export const updateMilestone = async (req, res) => {
  try {
    const { id } = req.params;
    // Basic milestone fields
    const { title, description, target_value, milestone_type } = req.body;
    // Reward fields (optional)
    let { reward_item_id } = req.body;
    const { item_name, item_type, item_description, is_active } = req.body;

    const existingMilestone = await prisma.milestone.findUnique({ where: { id } });
    if (!existingMilestone) {
      return res.status(404).json({ success: false, message: "Milestone not found" });
    }

    // If an existing reward_item_id is provided directly
    if (reward_item_id) {
      const reward = await prisma.rewardItem.findUnique({ where: { id: reward_item_id } });
      if (!reward) {
        return res.status(404).json({ success: false, message: "Reward item not found" });
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
    if (milestone_type) updateData.milestone_type = milestone_type;

    // Explicitly check for null vs undefined to allow unsetting reward
    if (reward_item_id !== undefined) {
      updateData.reward_item_id = reward_item_id;
    }

    const updatedMilestone = await prisma.milestone.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({ success: true, message: "Milestone updated successfully", data: updatedMilestone });
  } catch (error) {
    console.error("Update milestone error:", error);
    res.status(500).json({ success: false, message: "Failed to update milestone" });
  }
};

// DELETE /api/v1/admin/milestones/:id
export const deleteMilestone = async (req, res) => {
  try {
    const { id } = req.params;

    const existingMilestone = await prisma.milestone.findUnique({ where: { id } });
    if (!existingMilestone) {
      return res.status(404).json({ success: false, message: "Milestone not found" });
    }

    // Check if there are user milestones associated
    const userMilestonesCount = await prisma.userMilestone.count({
      where: { milestone_id: id }
    });

    if (userMilestonesCount > 0) {
      return res.status(400).json({ success: false, message: "Cannot delete milestone, users have progress on it" });
    }

    await prisma.milestone.delete({
      where: { id },
    });

    res.status(200).json({ success: true, message: "Milestone deleted successfully" });
  } catch (error) {
    console.error("Delete milestone error:", error);
    res.status(500).json({ success: false, message: "Failed to delete milestone" });
  }
};
