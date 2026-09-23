import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";
import { getIO } from "../configs/socket.js";

const DELETED_POST_RECOVERY_MS = 5 * 60 * 1000;

const emitReportReviewed = (postId, action, extra = {}) => {
  getIO()?.to("role:moderation").emit("report_reviewed", { postId, action, ...extra });
};

export const getReportedPosts = async (req, res) => {
  try {
    const deletedAfter = new Date(Date.now() - DELETED_POST_RECOVERY_MS);
    const posts = await prisma.post.findMany({
      where: {
        OR: [
          { post_status: "UNACTIVED" },
          {
            post_status: "ACTIVE",
            reports: {
              some: {}
            }
          },
          {
            post_status: "DELETED",
            updated_at: { gte: deletedAfter }
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

    const consolePosts = posts.filter((post) =>
      post.post_status === "DELETED" || post._count.reports >= 10
    );

    return res.status(200).json({
      posts: consolePosts.map((post) => ({
        ...post,
        recoverable_until: post.post_status === "DELETED"
          ? new Date(post.updated_at.getTime() + DELETED_POST_RECOVERY_MS)
          : null,
      })),
    });
  } catch (error) {
    logError("controllers.getReportedPosts", error, req);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const actionOnPost = async (req, res) => {
  try {
    const { post_id } = req.params;
    const { action } = req.body;

    if (!action || !["RESTORE", "SOFT_DELETE", "SUSPEND"].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Use RESTORE, SOFT_DELETE, or SUSPEND" });
    }

    const post = await prisma.post.findUnique({ where: { id: post_id } });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (action === "RESTORE") {
      if (
        post.post_status === "DELETED"
        && Date.now() - post.updated_at.getTime() > DELETED_POST_RECOVERY_MS
      ) {
        return res.status(410).json({ message: "หมดเวลาเรียกคืนโพสต์แล้ว (กำหนดภายใน 5 นาที)" });
      }

      await prisma.$transaction([
        prisma.report.deleteMany({ where: { post_id } }),
        prisma.post.update({ where: { id: post_id }, data: { post_status: "ACTIVE" } })
      ]);

      // 🔔 แจ้งเจ้าของโพสต์ว่าได้รับการคืนสถานะ
      await createNotification(
        post.author_id,
        "POST_RESTORED",
        `โพสต์ “${post.title}” ของคุณได้รับการคืนสถานะและเผยแพร่อีกครั้งแล้ว`,
        post.id
      );

      emitReportReviewed(post_id, action);

      return res.status(200).json({ message: "Post restored successfully" });
    } else if (action === "SOFT_DELETE") {
      if (post.post_status === "DELETED") {
        return res.status(409).json({ message: "โพสต์นี้ถูกลบไปแล้ว" });
      }

      const deletedPost = await prisma.post.update({
        where: { id: post_id },
        data: { post_status: "DELETED" },
      });
      const recoverableUntil = new Date(deletedPost.updated_at.getTime() + DELETED_POST_RECOVERY_MS);

      // 🔔 แจ้งเจ้าของโพสต์ว่าถูกลบออก
      await createNotification(
        post.author_id,
        "POST_REMOVED",
        `โพสต์ “${post.title}” ของคุณถูกลบหลังการตรวจสอบรายงาน`,
        post.id
      );

      emitReportReviewed(post_id, action, { recoverableUntil });

      return res.status(200).json({
        message: "Post soft deleted successfully",
        recoverableUntil,
      });
    } else if (action === "SUSPEND") {
      await prisma.post.update({ where: { id: post_id }, data: { post_status: "UNACTIVED" } });

      // 🔔 แจ้งเจ้าของโพสต์ว่าถูกระงับ
      await createNotification(
        post.author_id,
        "POST_SUSPENDED",
        `โพสต์ “${post.title}” ของคุณถูกระงับหลังการตรวจสอบรายงาน`,
        post.id
      );

      emitReportReviewed(post_id, action);

      return res.status(200).json({ message: "Post suspended successfully" });
    }

  } catch (error) {
    logError("controllers.actionOnPost", error, req);
    return res.status(500).json({ message: "Internal server error" });
  }
};
