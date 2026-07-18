import { prisma } from "../configs/prisma.js";
import { uploadToCloudinary } from "../middlewares/upload.middleware.js";

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, profile_image, bio, education_level } = req.body;

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
    if (profile_image !== undefined) updateData.profile_image = profile_image;
    if (bio !== undefined) {
      if (bio.length > 500) {
        return res.status(400).json({ success: false, message: "Bio is too long" });
      }
      updateData.bio = bio;
    }
    if (education_level !== undefined) updateData.education_level = education_level;

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

export const updateProfileWithMedia = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      username,
      nickname,
      bio,
      education_level,
      location,
      occupation,
      facebook_url,
      instagram_url,
      discord_url,
    } = req.body;

    if (username) {
      const existingUser = await prisma.user.findFirst({
        where: {
          username: username,
          id: { not: userId },
        },
      });

      if (existingUser) {
        return res
          .status(400)
          .json({ success: false, message: "Username is already taken" });
      }
    }

    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (nickname !== undefined) updateData.nickname = nickname;
    if (location !== undefined) updateData.location = location;
    if (occupation !== undefined) updateData.occupation = occupation;
    
    if (facebook_url !== undefined || instagram_url !== undefined || discord_url !== undefined) {
      updateData.social_links = {
        facebook: facebook_url,
        instagram: instagram_url,
        discord: discord_url,
      };
    }

    if (bio !== undefined) {
      if (bio.length > 500) {
        return res
          .status(400)
          .json({ success: false, message: "Bio is too long" });
      }
      updateData.bio = bio;
    }
    if (education_level !== undefined) updateData.education_level = education_level;

    // Handle file uploads
    if (req.files) {
      if (req.files.avatar && req.files.avatar[0]) {
        const result = await uploadToCloudinary(req.files.avatar[0].buffer, "share-ed/avatars");
        updateData.profile_image = result.secure_url;
      }
      if (req.files.banner && req.files.banner[0]) {
        const result = await uploadToCloudinary(req.files.banner[0].buffer, "share-ed/banners");
        updateData.profile_banner = result.secure_url;
      }
      if (req.files.wallpaper && req.files.wallpaper[0]) {
        const result = await uploadToCloudinary(req.files.wallpaper[0].buffer, "share-ed/wallpapers");
        updateData.wallpaper = result.secure_url;
      }
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
        role: true,
        nickname: true,
        location: true,
        occupation: true,
        social_links: true,
        profile_banner: true,
        wallpaper: true,
      },
    });

    // Format response to match frontend expectations
    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        ...updatedUser,
        avatar_url: updatedUser.profile_image,
        user_metadata: {
          banner_url: updatedUser.profile_banner,
          wallpaper_url: updatedUser.wallpaper,
          facebook_url: updatedUser.social_links?.facebook || null,
          instagram_url: updatedUser.social_links?.instagram || null,
          discord_url: updatedUser.social_links?.discord || null,
        },
      },
    });
  } catch (error) {
    console.error("Update profile with media error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update profile with media" });
  }
};

export const getUserById = async (req, res) => {
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
        nickname: true,
        location: true,
        occupation: true,
        social_links: true,
        profile_banner: true,
        wallpaper: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        ...user,
        avatar_url: user.profile_image,
        user_metadata: {
          banner_url: user.profile_banner,
          wallpaper_url: user.wallpaper,
          facebook_url: user.social_links?.facebook || null,
          instagram_url: user.social_links?.instagram || null,
          discord_url: user.social_links?.discord || null,
        },
      },
    });
  } catch (error) {
    console.error("Get user by ID error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
