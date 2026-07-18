import { prisma } from "../configs/prisma.js";

export const reportPost = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { post_id, reason } = req.body;

    if (!post_id || !reason) {
      return res.status(400).json({ message: "post_id and reason are required" });
    }

    // Check if post exists
    const post = await prisma.post.findUnique({
      where: { id: post_id },
      include: {
        _count: {
          select: { reports: true }
        }
      }
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Check if user already reported this post
    const existingReport = await prisma.report.findUnique({
      where: {
        user_id_post_id: {
          user_id,
          post_id
        }
      }
    });

    if (existingReport) {
      return res.status(400).json({ message: "You have already reported this post" });
    }

    // Create the report
    await prisma.report.create({
      data: {
        user_id,
        post_id,
        reason
      }
    });

    // Check total reports. If >= 10 (including this one), mark as UNACTIVED
    const reportCount = post._count.reports + 1; 

    if (reportCount >= 10 && post.post_status !== "UNACTIVED") {
      await prisma.post.update({
        where: { id: post_id },
        data: { post_status: "UNACTIVED" }
      });
    }

    return res.status(201).json({ message: "Post reported successfully", reportCount });

  } catch (error) {
    console.error("Error reporting post:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
