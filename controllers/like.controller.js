import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";
import { updateMilestoneProgress } from "../utils/milestone.helper.js";

export const toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
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

      // 🔔 แจ้งเจ้าของโพสต์ (ไม่แจ้งตัวเอง)
      if (post.author_id !== userId) {
        const liker = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true }
        });
        await createNotification(
          post.author_id,
          "NEW_LIKE",
          `${liker.username} liked your post "${post.title}"`
        );
      }

      // 🏆 อัปเดต Milestone: POST_LIKES (สำหรับเจ้าของโพสต์)
      const userPosts = await prisma.post.findMany({
        where: { author_id: post.author_id },
        select: { id: true }
      });
      const postIds = userPosts.map(p => p.id);
      const totalLikesReceived = await prisma.like.count({
        where: { post_id: { in: postIds } }
      });
      await updateMilestoneProgress(post.author_id, "POST_LIKES", totalLikesReceived);

      return res.status(200).json({ success: true, message: "Liked post successfully", isLiked: true });
    }
  } catch (error) {
    console.error("Toggle like error:", error);
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
    console.error("Get like status error:", error);
    res.status(500).json({ success: false, message: "Failed to get like status" });
  }
};

