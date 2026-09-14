import { prisma } from "../configs/prisma.js";

// Social endpoints expose only published posts, even when their IDs are known.
export const requirePublishedPost = (getId) => async (req, res, next) => {
  try {
    const id = getId(req);
    if (typeof id !== "string" || !id.trim() || id.length > 128) {
      return res.status(400).json({ message: "Invalid post ID" });
    }
    const post = await prisma.post.findFirst({
      where: { id, post_status: "ACTIVE" },
      select: { id: true },
    });
    if (!post) return res.status(404).json({ message: "Post not found" });
    next();
  } catch (error) {
    next(error);
  }
};
