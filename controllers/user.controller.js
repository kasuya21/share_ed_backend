import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.config.js";
import { supabase } from "../configs/supabase.config.js";

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

// Social Links URL structure and protocol validation
const validateSocialLinks = (links) => {
  if (!links || typeof links !== "object") return null;
  const matchesDomain = (hostname, domain) =>
    hostname === domain || hostname.endsWith(`.${domain}`);

  for (const [platform, url] of Object.entries(links)) {
    if (!url || url.trim() === "") continue; // Allow empty links

    // 1. Check Protocol: http:// or https://
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return `ลิงก์ของ ${platform} ต้องเริ่มต้นด้วย http:// หรือ https://`;
    }

    // 2. Check platform domain matching
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return `ลิงก์ของ ${platform} ไม่ถูกต้อง`;
    }

    if (platform === "instagram" && !matchesDomain(hostname, "instagram.com")) {
      return "ลิงก์ Instagram ไม่ถูกต้อง (ต้องมี instagram.com)";
    }
    if (platform === "facebook" && !matchesDomain(hostname, "facebook.com")) {
      return "ลิงก์ Facebook ไม่ถูกต้อง (ต้องมี facebook.com)";
    }
    if (platform === "youtube" && !matchesDomain(hostname, "youtube.com")) {
      return "ลิงก์ Youtube ไม่ถูกต้อง (ต้องมี youtube.com)";
    }
  }
  return null;
};

// ============================================================
// PUT /api/v1/users/profile
// แก้ไขข้อมูลโปรไฟล์ (เจ้าของบัญชีเท่านั้น)
// ============================================================
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, bio, education_level, social_links } = req.body;

    // 1. ตรวจสอบชื่อเล่น (username) ซ้ำ
    if (username) {
      const existingUser = await prisma.user.findFirst({
        where: {
          username: username,
          id: { not: userId }
        }
      });

      if (existingUser) {
        return res.status(400).json({ success: false, message: "ชื่อเล่นนี้ถูกใช้งานแล้ว" });
      }
    }

    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (bio !== undefined) {
      if (bio.length > 500) {
        return res.status(400).json({ success: false, message: "คำอธิบายยาวเกิน 500 ตัวอักษร" });
      }
      updateData.bio = bio;
    }
    if (education_level !== undefined) updateData.education_level = education_level;


    // 2. จัดการและตรวจสอบ URL Social Links
    if (social_links !== undefined) {
      let parsedLinks = social_links;
      if (typeof social_links === 'string') {
        try {
          parsedLinks = JSON.parse(social_links);
        } catch (e) {
          return res.status(400).json({ success: false, message: "รูปแบบ Social Links ไม่ถูกต้อง" });
        }
      }

      const validationError = validateSocialLinks(parsedLinks);
      if (validationError) {
        return res.status(400).json({ success: false, message: validationError });
      }

      updateData.social_links = parsedLinks;
    }

    // 3. ตรวจสอบและอัปโหลดไฟล์รูปภาพ (profile_image, wallpaper, profile_banner)
    if (req.files) {
      // อัปโหลดรูปโปรไฟล์
      if (req.files.profile_image && req.files.profile_image.length > 0) {
        const result = await uploadToCloudinary(
          req.files.profile_image[0].buffer,
          "share-ed/profiles",
          [
            { width: 400, height: 400, crop: "fill", gravity: "face" }
          ]
        );
        updateData.profile_image = result.secure_url;
      }

      // อัปโหลดภาพวอลเปเปอร์
      if (req.files.wallpaper && req.files.wallpaper.length > 0) {
        const result = await uploadToCloudinary(
          req.files.wallpaper[0].buffer,
          "share-ed/wallpapers"
        );
        updateData.wallpaper = result.secure_url;
      }

      // อัปโหลดภาพแบนเนอร์
      if (req.files.profile_banner && req.files.profile_banner.length > 0) {
        const result = await uploadToCloudinary(
          req.files.profile_banner[0].buffer,
          "share-ed/banners"
        );
        updateData.profile_banner = result.secure_url;
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
        wallpaper: true,
        profile_banner: true,
        bio: true,
        education_level: true,
        role: true,
        social_links: true,
        current_theme_id: true,
        current_frame_id: true
      }
    });

    res.status(200).json({ 
      success: true, 
      message: "อัปเดตโปรไฟล์สำเร็จ", 
      data: updatedUser 
    });

  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "อัปเดตโปรไฟล์ล้มเหลว" });
  }
};

// ============================================================
// PUT /api/v1/users/onboard
// กรอกข้อมูลโปรไฟล์ครั้งแรก
// ============================================================
export const onboardUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, bio, education_level } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: "ต้องระบุชื่อเล่นสำหรับการตั้งค่าครั้งแรก" });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        username: username,
        id: { not: userId }
      }
    });

    if (existingUser) {
      return res.status(400).json({ success: false, message: "ชื่อเล่นนี้ถูกใช้งานแล้ว" });
    }

    const updateData = {
      username,
      is_onboarded: true
    };

    if (bio) updateData.bio = bio;
    if (education_level) updateData.education_level = education_level;


    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData
    });

    res.status(200).json({ success: true, message: "ตั้งค่าโปรไฟล์ครั้งแรกสำเร็จ", data: updatedUser });
  } catch (error) {
    console.error("Onboarding error:", error);
    res.status(500).json({ success: false, message: "ตั้งค่าโปรไฟล์ครั้งแรกไม่สำเร็จ" });
  }
};

// ============================================================
// PUT /api/v1/users/equip
// สวมใส่ Theme/Frame
// ============================================================
export const equipItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId, type } = req.body; // 'THEME' or 'FRAME'

    if (!['THEME', 'FRAME'].includes(type)) {
      return res.status(400).json({ success: false, message: "ประเภทไอเท็มไม่ถูกต้อง ต้องเป็น THEME หรือ FRAME" });
    }

    if (itemId) {
      const unlockedItem = await prisma.userUnlockedItem.findFirst({
        where: {
          user_id: userId,
          item_id: itemId
        },
        include: { item: true }
      });

      if (!unlockedItem) {
        return res.status(403).json({ success: false, message: "คุณยังไม่ได้ครอบครองไอเท็มนี้" });
      }

      if (unlockedItem.item.item_type !== type) {
         return res.status(400).json({ success: false, message: "ประเภทไอเท็มไม่ตรงกับที่ระบุ" });
      }
    }

    const updateData = type === 'THEME' 
      ? { current_theme_id: itemId || null }
      : { current_frame_id: itemId || null };

    await prisma.user.update({
      where: { id: userId },
      data: updateData
    });

    res.status(200).json({ success: true, message: `สวมใส่ ${type === 'THEME' ? 'ธีม' : 'กรอบรูป'} สำเร็จ` });
  } catch (error) {
    console.error("Equip item error:", error);
    res.status(500).json({ success: false, message: "สวมใส่ไอเท็มล้มเหลว" });
  }
};

// ============================================================
// GET /api/v1/users/:id
// เรียกดูโปรไฟล์ผู้ใช้ (รองรับข้อมูล follows, likes, และ isSelf / isFollowing)
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
        wallpaper: true,
        profile_banner: true,
        bio: true,
        education_level: true,
        role: true,
        social_links: true,
        created_at: true,
        current_theme_id: true,
        current_frame_id: true,
        current_theme: true,
        current_frame: true,
        _count: {
          select: {
            posts: {
              where: { post_status: "ACTIVE" } // Only count active posts
            },
            followers: true,
            following: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้ในระบบ" });
    }

    // คำนวณยอดไลก์สะสมทั้งหมดที่ได้รับจากทุกโพสต์ (Total Accumulated Likes)
    const userPosts = await prisma.post.findMany({
      where: { author_id: id, post_status: "ACTIVE" },
      select: { id: true }
    });
    const postIds = userPosts.map(p => p.id);
    const totalLikes = await prisma.like.count({
      where: { post_id: { in: postIds } }
    });

    // ตรวจสอบสถานะการ Follow และ การเป็นเจ้าของโปรไฟล์
    let isSelf = false;
    let isFollowing = false;

    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      try {
        const { data } = await supabase.auth.getUser(token);
        if (data?.user) {
          const visitorId = data.user.id;
          isSelf = visitorId === id;
          
          const followRecord = await prisma.follow.findUnique({
            where: {
              follower_id_following_id: {
                follower_id: visitorId,
                following_id: id
              }
            }
          });
          isFollowing = !!followRecord;
        }
      } catch (err) {
        // Skip auth error to allow guest viewing without break
      }
    }

    res.status(200).json({ 
      success: true, 
      data: {
        ...user,
        totalLikes,
        isSelf,
        isFollowing
      }
    });

  } catch (error) {
    console.error("Get public profile error:", error);
    res.status(500).json({ success: false, message: "ดึงข้อมูลโปรไฟล์ล้มเหลว" });
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
