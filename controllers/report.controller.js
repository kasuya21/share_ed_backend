import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import { getIO } from "../configs/socket.js";
import { createNotification } from "../utils/notification.helper.js";

const REPORT_SUSPEND_THRESHOLD = 5;

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

    const result = await prisma.$transaction(async (tx) => {
      // Serialize reports for this post, including requests from different users.
      await tx.$queryRaw`SELECT 1 FROM posts WHERE post_id = ${post_id} FOR UPDATE`;
      const post = await tx.post.findUnique({ where: { id: post_id } });
      if (!post || post.post_status !== "ACTIVE") return { kind: "missing" };

      const existingReport = await tx.report.findUnique({
        where: { user_id_post_id: { user_id, post_id } }
      });
      if (existingReport) return { kind: "duplicate" };

      await tx.report.create({ data: { user_id, post_id, reason } });
      // The database has @@unique([user_id, post_id]), so this is a unique-user count.
      const reportCount = await tx.report.count({ where: { post_id } });
      const suspended = reportCount >= REPORT_SUSPEND_THRESHOLD;
      if (suspended) {
        await tx.post.update({ where: { id: post_id }, data: { post_status: "UNACTIVED" } });
      }
      return { kind: "created", reportCount, suspended, title: post.title };
    });

    if (result.kind === "missing") return res.status(404).json({ message: "Post not found" });
    if (result.kind === "duplicate") {
      return res.status(400).json({ message: "You have already reported this post" });
    }

    const { reportCount, suspended } = result;
    if (suspended) {
      try {
        const admins = await prisma.user.findMany({
          where: { role: "ADMIN", status: "ACTIVE" },
          select: { id: true }
        });
        await Promise.all(admins.map((admin) => createNotification(
          admin.id,
          "POST_REPORTED",
          `โพสต์ “${result.title}” ได้รับรายงานจากผู้ใช้ไม่ซ้ำครบ ${REPORT_SUSPEND_THRESHOLD} คนและถูกระงับ รอตรวจสอบ`,
          post_id
        )));
      } catch (notificationError) {
        logError("controllers.reportPost.notifyAdmins", notificationError, req);
      }
    }
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

    return res.status(201).json({ message: "Post reported successfully", reportCount, postStatus: suspended ? "UNACTIVED" : "ACTIVE" });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(400).json({ message: "You have already reported this post" });
    }
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
