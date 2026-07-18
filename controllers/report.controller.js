import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";

const REPORT_THRESHOLD = 10;

export const reportPost = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { post_id, reason } = req.body;

    if (!post_id || !reason) {
      return res.status(400).json({ message: "post_id and reason are required" });
    }

    const validReasons = ["เนื้อหาไม่เหมาะสม", "สแปม", "คัดลอกผลงานผู้อื่น", "เนื้อหามีความหยาบคาย"];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ success: false, message: "เหตุผลการรายงานไม่ถูกต้อง" });
    }

    const post = await prisma.post.findUnique({
      where: { id: post_id },
      include: { _count: { select: { reports: true } } }
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const existingReport = await prisma.report.findUnique({
      where: { user_id_post_id: { user_id, post_id } }
    });

    if (existingReport) {
      return res.status(400).json({ message: "You have already reported this post" });
    }

    await prisma.report.create({ data: { user_id, post_id, reason } });

    const reportCount = post._count.reports + 1;

    if (reportCount >= REPORT_THRESHOLD && post.post_status !== "UNACTIVED") {
      await prisma.post.update({
        where: { id: post_id },
        data: { post_status: "UNACTIVED" }
      });

      // 🔔 แจ้งเจ้าของโพสต์
      await createNotification(
        post.author_id,
        "POST_SUSPENDED",
        `Your post "${post.title}" has been suspended due to ${reportCount} reports`
      );

      // 🔔 แจ้ง Moderator/Admin ทุกคน
      const moderators = await prisma.user.findMany({
        where: { role: { in: ["MODERATOR", "ADMIN"] } },
        select: { id: true }
      });
      await Promise.all(
        moderators.map(m =>
          createNotification(
            m.id,
            "POST_REPORTED",
            `Post "${post.title}" has been auto-suspended after ${reportCount} reports`
          )
        )
      );
    }

    return res.status(201).json({ message: "Post reported successfully", reportCount });
  } catch (error) {
    console.error("Error reporting post:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getMyReports = async (req, res) => {
  try {
    const user_id = req.user.id;
    const reports = await prisma.report.findMany({
      where: { user_id },
      include: { post: { select: { id: true, title: true, post_status: true } } },
      orderBy: { created_at: "desc" }
    });
    res.status(200).json({ success: true, data: reports });
  } catch (error) {
    console.error("Get my reports error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch reports" });
  }
};
