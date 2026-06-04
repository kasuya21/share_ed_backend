import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.config.js";

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, bio, education_level } = req.body;

    if (username) {
      const existingUser = await prisma.user.findFirst({
        where: {
          username: username,
          id: { not: userId }
        }
      });

      if (existingUser) {
        return res.status(400).json({ success: false, message: "Username is already taken" });
      }
    }

    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (bio !== undefined) {
      if (bio.length > 500) {
        return res.status(400).json({ success: false, message: "Bio is too long" });
      }
      updateData.bio = bio;
    }
    if (education_level !== undefined) updateData.education_level = education_level;

    // ถ้ามีไฟล์รูปภาพส่งมา → อัปโหลด Cloudinary
    if (req.file) {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "share-ed/profiles",
            transformation: [
              { width: 400, height: 400, crop: "fill", gravity: "face" },
              { quality: "auto", fetch_format: "auto" }
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      updateData.profile_image = uploadResult.secure_url;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        profile_image: true,
        bio: true,
        education_level: true,
        role: true
      }
    });

    res.status(200).json({ success: true, message: "Profile updated successfully", data: updatedUser });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
};


export const equipItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId, type } = req.body; // 'THEME' or 'FRAME'

    if (!['THEME', 'FRAME'].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid item type. Must be THEME or FRAME" });
    }

    if (itemId) {
      const purchase = await prisma.purchase.findFirst({
        where: {
          user_id: userId,
          item_id: itemId
        },
        include: { item: true }
      });

      if (!purchase) {
        return res.status(403).json({ success: false, message: "You don't own this item" });
      }

      if (purchase.item.item_type !== type) {
         return res.status(400).json({ success: false, message: "Item type mismatch" });
      }
    }

    const updateData = type === 'THEME' 
      ? { current_theme_id: itemId || null }
      : { current_frame_id: itemId || null };

    await prisma.user.update({
      where: { id: userId },
      data: updateData
    });

    res.status(200).json({ success: true, message: `${type} updated successfully` });
  } catch (error) {
    console.error("Equip item error:", error);
    res.status(500).json({ success: false, message: "Failed to equip item" });
  }
};

// ============================================================
// GET /api/v1/users/:id  — ดูโปรไฟล์สาธารณะของผู้ใช้คนอื่น
// ============================================================
export const getPublicProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        profile_image: true,
        bio: true,
        education_level: true,
        role: true,
        created_at: true,
        current_theme_id: true,
        current_frame_id: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error("Get public profile error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
};
