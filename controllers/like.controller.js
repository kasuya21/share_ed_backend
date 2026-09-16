import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import { createLikeNotification, removeLikeNotification } from "../utils/notification.helper.js";
import { incrementAchievementProgress } from "../utils/achievement.helper.js";

export const toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.post_status !== "ACTIVE") {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const existingLike = await prisma.like.findUnique({
      where: {
        user_id_post_id: {
          user_id: userId,
          post_id: postId
        }
      }
    });

    if (existingLike) {
      // Unlike
      await prisma.like.deleteMany({
        where: {
          user_id: userId,
          post_id: postId
        }
      });
      await removeLikeNotification({
        recipientId: post.author_id,
        actorId: userId,
        postId,
      });
      return res.status(200).json({ success: true, message: "ยกเลิกการถูกใจแล้ว", isLiked: false });
    } else {
      // Like
      try {
        await prisma.like.create({
          data: {
            user_id: userId,
            post_id: postId
          }
        });
      } catch (error) {
        if (error.code === 'P2002') {
          return res.status(200).json({ success: true, message: "Liked post successfully", isLiked: true });
        }
        throw error;
      }

      // 🔔 แจ้งเจ้าของโพสต์ และ อัปเดต Achievement พร้อมกันแบบ Concurrent เพื่อความเร็วสูงสุด
      if (post.author_id !== userId) {
        await Promise.all([
          createLikeNotification({
            recipientId: post.author_id,
            actorId: userId,
            postId,
          }),
          incrementAchievementProgress(post.author_id, "POST_LIKES", 1),
        ]);
      }

      return res.status(200).json({ success: true, message: "Liked post successfully", isLiked: true });
    }
  } catch (error) {
    logError("controllers.toggleLike", error, req);
    res.status(500).json({ success: false, message: "Failed to toggle like" });
  }
};

export const getLikeStatus = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const existingLike = await prisma.like.findUnique({
      where: {
        user_id_post_id: {
          user_id: userId,
          post_id: postId
        }
      }
    });

    return res.status(200).json({
      success: true,
      isLiked: !!existingLike
    });
  } catch (error) {
    logError("controllers.getLikeStatus", error, req);
    res.status(500).json({ success: false, message: "Failed to get like status" });
  }
};

