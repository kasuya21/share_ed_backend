import { prisma } from "../configs/prisma.js";

export const toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const existingLike = await prisma.like.findUnique({
      where: {
        user_id_post_id: {
          user_id: userId,
          post_id: postId
        }
      }
    });

    if (existingLike) {
      // Unlike
      await prisma.like.delete({
        where: { id: existingLike.id }
      });
      return res.status(200).json({ success: true, message: "Unliked post successfully", isLiked: false });
    } else {
      // Like
      await prisma.like.create({
        data: {
          user_id: userId,
          post_id: postId
        }
      });
      return res.status(200).json({ success: true, message: "Liked post successfully", isLiked: true });
    }
  } catch (error) {
    console.error("Toggle like error:", error);
    res.status(500).json({ success: false, message: "Failed to toggle like" });
  }
};
