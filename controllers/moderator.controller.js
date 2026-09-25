import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";
import { getIO } from "../configs/socket.js";
import { deletePostPermanently } from "../utils/post-deletion.js";

const emitReportReviewed = (postId, action, extra = {}) => {
  getIO()?.to("role:admin").emit("report_reviewed", { postId, action, ...extra });
};

export const getReportedPosts = async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: {
        OR: [
          { post_status: "UNACTIVED" },
          {
            post_status: "ACTIVE",
            reports: {
              some: {}
            }
          }
        ]
      },
      include: {
        reports: {
          orderBy: { created_at: "desc" },
          include: {
            user: { select: { username: true, email: true } }
          }
        },
        author: { select: { username: true, email: true } },
        _count: { select: { reports: true } }
      },
      orderBy: [
        { reports: { _count: "desc" } },
        { updated_at: "desc" }
      ]
    });

    return res.status(200).json({ posts: posts.filter((post) => post._count.reports > 0) });
  } catch (error) {
    logError("controllers.getReportedPosts", error, req);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const actionOnPost = async (req, res) => {
  try {
    const { post_id } = req.params;
    const { action } = req.body;

    if (!action || !["APPROVE", "DELETE", "SUSPEND"].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Use APPROVE, DELETE, or SUSPEND" });
    }

    const post = await prisma.post.findUnique({ where: { id: post_id } });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (action === "APPROVE") {
      await prisma.$transaction([
        prisma.report.deleteMany({ where: { post_id } }),
        prisma.post.update({ where: { id: post_id }, data: { post_status: "ACTIVE" } })
      ]);
      emitReportReviewed(post_id, action);
      return res.status(200).json({ message: "Post approved successfully" });
    } else if (action === "DELETE") {
      await deletePostPermanently(post_id);
      await createNotification(
        post.author_id,
        "POST_REMOVED",
        `โพสต์ “${post.title}” ของคุณถูกลบหลังการตรวจสอบรายงาน`,
        null
      );
      emitReportReviewed(post_id, action);
      return res.status(200).json({ message: "Post permanently deleted successfully" });
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
