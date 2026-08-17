import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";
import { updateAchievementProgress } from "../utils/achievement.helper.js";

// ============================================================
// POST /api/v1/follow/:userId
// กดติดตาม user คนอื่น
// ============================================================
export const followUser = async (req, res) => {
  try {
    const follower_id = req.user.id;        // ผู้กดติดตาม (ตัวเอง)
    const following_id = req.params.userId; // เป้าหมายที่จะติดตาม

    if (follower_id === following_id) {
      return res.status(400).json({
        success: false,
        message: "You cannot follow yourself"
      });
    }

    // ตรวจสอบว่า target user มีอยู่จริง
    const targetUser = await prisma.user.findUnique({
      where: { id: following_id },
      select: { id: true, username: true }
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // ตรวจสอบว่าติดตามอยู่แล้วหรือไม่
    const existing = await prisma.follow.findFirst({
      where: {
        follower_id: follower_id,
        following_id: following_id
      }
    });

    if (existing) {
      return res.status(200).json({
        success: true,
        message: "You are already following this user"
      });
    }

    const follow = await prisma.follow.create({
      data: { follower_id, following_id }
    });

    // 🔔 แจ้งเตือน: มีคนติดตามเรา (NEW_FOLLOWER)
    const followerUser = await prisma.user.findUnique({
      where: { id: follower_id },
      select: { username: true }
    });
    await createNotification(
      following_id,
      "NEW_FOLLOWER",
      `${followerUser.username} started following you`
    );

    // 🏆 อัปเดต Achievement: FOLLOWERS_COUNT
    const totalFollowers = await prisma.follow.count({ where: { following_id } });
    await updateAchievementProgress(following_id, "FOLLOWERS_COUNT", totalFollowers);

    res.status(201).json({
      success: true,
      message: `You are now following ${targetUser.username}`,
      data: follow
    });
  } catch (error) {
    console.error("Follow user error:", error);
    res.status(500).json({ success: false, message: "Failed to follow user" });
  }
};

// ============================================================
// DELETE /api/v1/follow/:userId
// ยกเลิกติดตาม user คนอื่น
// ============================================================
export const unfollowUser = async (req, res) => {
  try {
    const follower_id = req.user.id;
    const following_id = req.params.userId;

    if (follower_id === following_id) {
      return res.status(400).json({
        success: false,
        message: "You cannot unfollow yourself"
      });
    }

    const existing = await prisma.follow.findFirst({
      where: {
        follower_id: follower_id,
        following_id: following_id
      }
    });

    if (!existing) {
      return res.status(200).json({
        success: true,
        message: "You are not following this user"
      });
    }

    await prisma.follow.deleteMany({
      where: {
        follower_id: follower_id,
        following_id: following_id
      }
    });

    res.status(200).json({
      success: true,
      message: "Unfollowed successfully"
    });
  } catch (error) {
    console.error("Unfollow user error:", error);
    res.status(500).json({ success: false, message: "Failed to unfollow user" });
  }
};

// ============================================================
// GET /api/v1/follow/:userId/followers
// ดึงรายชื่อคนที่ติดตาม userId
// ============================================================
export const getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;

    const follows = await prisma.follow.findMany({
      where: { following_id: userId },
      include: {
        follower: {
          select: { id: true, username: true, profile_image: true }
        }
      },
      orderBy: { created_at: "desc" }
    });

    res.status(200).json({
      success: true,
      count: follows.length,
      data: follows.map(f => f.follower)
    });
  } catch (error) {
    console.error("Get followers error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch followers" });
  }
};

// ============================================================
// GET /api/v1/follow/:userId/following
// ดึงรายชื่อที่ userId กำลังติดตาม
// ============================================================
export const getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;

    const follows = await prisma.follow.findMany({
      where: { follower_id: userId },
      include: {
        following: {
          select: { id: true, username: true, profile_image: true }
        }
      },
      orderBy: { created_at: "desc" }
    });

    res.status(200).json({
      success: true,
      count: follows.length,
      data: follows.map(f => f.following)
    });
  } catch (error) {
    console.error("Get following error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch following list" });
  }
};
