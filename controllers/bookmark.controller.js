import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";

export const toggleBookmark = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const existingBookmark = await prisma.bookmark.findUnique({
      where: {
        user_id_post_id: {
          user_id: userId,
          post_id: postId
        }
      }
    });

    if (existingBookmark) {
      // Remove bookmark
      await prisma.bookmark.delete({ where: { id: existingBookmark.id } });

      // 🔔 แจ้งเจ้าของตัวเองว่าเอา Bookmark ออกแล้ว (per Requirement)
      const post = await prisma.post.findUnique({ where: { id: postId }, select: { title: true } });
      await createNotification(userId, "BOOKMARK_REMOVED", `You removed "${post?.title}" from your bookmarks`);

      return res.status(200).json({ success: true, message: "การยกเลิกสำเร็จ", isBookmarked: false });
    } else {
      // Add bookmark
      await prisma.bookmark.create({
        data: {
          user_id: userId,
          post_id: postId
        }
      });
      return res.status(200).json({ success: true, message: "Bookmarked post successfully", isBookmarked: true });
    }
  } catch (error) {
    console.error("Toggle bookmark error:", error);
    res.status(500).json({ success: false, message: "Failed to toggle bookmark" });
  }
};

export const getBookmarks = async (req, res) => {
  try {
    const userId = req.user.id;

    const bookmarks = await prisma.bookmark.findMany({
      where: { user_id: userId },
      include: {
        post: {
          include: {
            author: { select: { id: true, username: true, profile_image: true } },
            category: true,
            _count: { select: { comments: true, likes: true } }
          }
        }
      },
      orderBy: { created_at: "desc" }
    });

    res.status(200).json({ success: true, data: bookmarks });
  } catch (error) {
    console.error("Get bookmarks error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch bookmarks" });
  }
};
