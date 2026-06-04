import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";

export const getReportedPosts = async (req, res) => {
  try {
    // Get posts that are either UNACTIVED or have at least 1 report
    const posts = await prisma.post.findMany({
      where: {
        OR: [
          { post_status: "UNACTIVED" },
          {
            reports: {
              some: {}
            }
          }
        ]
      },
      include: {
        reports: {
          include: {
            user: { select: { username: true, email: true } }
          }
        },
        author: { select: { username: true, email: true } },
        _count: { select: { reports: true } }
      },
      orderBy: {
        created_at: "desc"
      }
    });

    return res.status(200).json({ posts });
  } catch (error) {
    console.error("Error getting reported posts:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const actionOnPost = async (req, res) => {
  try {
    const { post_id } = req.params;
    const { action } = req.body;

    if (!action || !["RESTORE", "SOFT_DELETE"].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Use RESTORE or SOFT_DELETE" });
    }

    const post = await prisma.post.findUnique({ where: { id: post_id } });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (action === "RESTORE") {
      await prisma.$transaction([
        prisma.report.deleteMany({ where: { post_id } }),
        prisma.post.update({ where: { id: post_id }, data: { post_status: "PUBLISHED" } })
      ]);

      // 🔔 แจ้งเจ้าของโพสต์ว่าได้รับการคืนสถานะ
      await createNotification(
        post.author_id,
        "POST_RESTORED",
        `Your post "${post.title}" has been reviewed and restored by a moderator`
      );

      return res.status(200).json({ message: "Post restored successfully" });
    } else if (action === "SOFT_DELETE") {
      await prisma.post.update({ where: { id: post_id }, data: { post_status: "ARCHIVED" } });

      // 🔔 แจ้งเจ้าของโพสต์ว่าถูกลบออก
      await createNotification(
        post.author_id,
        "POST_REMOVED",
        `Your post "${post.title}" has been removed after review by a moderator`
      );

      return res.status(200).json({ message: "Post soft deleted successfully" });
    }

  } catch (error) {
    console.error("Error taking action on post:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
