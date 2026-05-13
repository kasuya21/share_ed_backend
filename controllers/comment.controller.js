import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const createComment = async (req, res) => {
  try {
    const { content, post_id } = req.body;
    const user_id = req.user.id;

    if (!content || !post_id) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        post_id,
        user_id,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profile_image: true,
          },
        },
      },
    });

    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const getCommentsByPost = async (req, res) => {
  try {
    const { postId } = req.params;

    const comments = await prisma.comment.findMany({
      where: {
        post_id: postId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profile_image: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteComment = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const comment = await prisma.comment.findUnique({
      where: { id },
    });

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment.user_id !== user_id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await prisma.comment.delete({
      where: { id },
    });

    res.json({ message: "Comment deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const user_id = req.user.id;

    if (!content) {
      return res.status(400).json({ message: "Content is required" });
    }

    const comment = await prisma.comment.findUnique({
      where: { id },
    });

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    // 🔒 กันแก้ของคนอื่น
    if (comment.user_id !== user_id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updatedComment = await prisma.comment.update({
      where: { id },
      data: {
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profile_image: true,
          },
        },
      },
    });

    res.json(updatedComment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
