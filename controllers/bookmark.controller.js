import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";

export const toggleBookmark = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.post_status !== "ACTIVE") {
      return res.status(404).json({ success: false, message: "Post not found" });
    }
    //เช็คว่าเคยกดbookmarkไว้รึยัง
    const existingBookmark = await prisma.bookmark.findUnique({
      where: {
        user_id_post_id: {
          user_id: userId,
          post_id: postId
        }
      }
    });

    if (existingBookmark) {
      // Remove bookmark (no notification created)
      await prisma.bookmark.delete({ where: { id: existingBookmark.id } });

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
    logError("controllers.toggleBookmark", error, req);
    res.status(500).json({ success: false, message: "Failed to toggle bookmark" });
  }
};

export const getBookmarks = async (req, res) => {
  try {
    const userId = req.user.id;
    const idsOnly = req.query.idsOnly === "true";

    if (idsOnly) {
      const bookmarks = await prisma.bookmark.findMany({
        where: { user_id: userId, post: { post_status: "ACTIVE" } },
        select: { post_id: true },
        orderBy: { created_at: "desc" }
      });

      return res.status(200).json({ success: true, data: bookmarks });
    }

    // get all bookmark by user id
    const bookmarks = await prisma.bookmark.findMany({
      where: { user_id: userId, post: { post_status: "ACTIVE" } },
      include: {
        post: {
          include: {
            author: {
              select: {
                id: true,
                username: true,
                profile_image: true,
                current_frame_id: true,
                current_frame: {
                  select: { id: true, item_name: true, image_url: true, metadata: true }
                }
              }
            },
            category: true,
            _count: { select: { comments: true, likes: true } }
          }
        }
      },
      orderBy: { created_at: "desc" }
    });

    res.status(200).json({ success: true, data: bookmarks });
  } catch (error) {
    logError("controllers.getBookmarks", error, req);
    res.status(500).json({ success: false, message: "Failed to fetch bookmarks" });
  }
};
