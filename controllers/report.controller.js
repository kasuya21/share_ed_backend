import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import { getIO } from "../configs/socket.js";

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

    if (!post || post.post_status !== "ACTIVE") {
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
    const reportedPost = await prisma.post.findUnique({
      where: { id: post_id },
      include: {
        reports: {
          orderBy: { created_at: "desc" },
          include: {
            user: { select: { username: true, email: true } }
          }
        },
        author: { select: { username: true, email: true } },
        _count: { select: { reports: true } }
      }
    });
    getIO()?.to("role:admin").emit("report_created", {
      postId: post_id,
      reportCount,
      post: reportedPost,
    });

    return res.status(201).json({ message: "Post reported successfully", reportCount });
  } catch (error) {
    logError("controllers.reportPost", error, req);
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
    logError("controllers.getMyReports", error, req);
    res.status(500).json({ success: false, message: "Failed to fetch reports" });
  }
};
