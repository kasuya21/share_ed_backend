import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";

export const getAllPosts = async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: {
        post_status: "PUBLISHED"
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            profile_image: true
          }
        },
        category: true,
        media: true,
        tags: true,
        _count: {
          select: {
            comments: true,
            likes: true,
            bookmarks: true
          }
        }
      },
      orderBy: {
        created_at: "desc"
      }
    });

    res.status(200).json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error("Get all posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch posts"
    });
  }
};


export const getPostById = async (req, res) => {
  try {
    const { id } = req.params;

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            profile_image: true,
            bio: true
          }
        },
        category: true,
        media: true,
        comments: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profile_image: true
              }
            }
          }
        },
        likes: {
          select: {
            user_id: true
          }
        },
        _count: {
          select: {
            comments: true,
            likes: true,
            bookmarks: true
          }
        }
      }
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    res.status(200).json({
      success: true,
      data: post
    });
  } catch (error) {
    console.error("Get post by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch post"
    });
  }
};


export const createPost = async (req, res) => {
  try {
    const { title, summary, content, education_level, category_id, post_status } = req.body;
    const author_id = req.user.id;

    if (!title || !content || !education_level) {
      return res.status(400).json({
        success: false,
        message: "Title, content, and education_level are required"
      });
    }

    const post = await prisma.post.create({
      data: {
        title,
        summary: summary || "",
        content,
        education_level,
        author_id,
        category_id: category_id || null,
        post_status: post_status || "DRAFT"
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            profile_image: true
          }
        }
      }
    });

    // 🔔 แจ้งเตือน Followers เมื่อโพสต์ถูก PUBLISHED
    if (post.post_status === "PUBLISHED") {
      const authorUser = await prisma.user.findUnique({
        where: { id: author_id },
        select: { username: true }
      });
      const followers = await prisma.follow.findMany({
        where: { following_id: author_id },
        select: { follower_id: true }
      });
      await Promise.all(
        followers.map(f =>
          createNotification(
            f.follower_id,
            "NEW_POST",
            `${authorUser.username} just published a new post: "${post.title}"`
          )
        )
      );
    }

    res.status(201).json({
      success: true,
      message: "Post created successfully",
      data: post
    });
  } catch (error) {
    console.error("Create post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create post"
    });
  }
};


export const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, summary, content, education_level, category_id, post_status } = req.body;
    const user_id = req.user.id;

    // Check if post exists and user is the author
    const post = await prisma.post.findUnique({
      where: { id }
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    if (post.author_id !== user_id) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to update this post"
      });
    }

    // Prepare update data (only include fields that are provided)
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (summary !== undefined) updateData.summary = summary;
    if (content !== undefined) updateData.content = content;
    if (education_level !== undefined) updateData.education_level = education_level;
    if (category_id !== undefined) updateData.category_id = category_id;
    if (post_status !== undefined) updateData.post_status = post_status;

    const updatedPost = await prisma.post.update({
      where: { id },
      data: updateData,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            profile_image: true
          }
        },
        category: true,
        media: true,
        _count: {
          select: {
            comments: true,
            likes: true,
            bookmarks: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      message: "Post updated successfully",
      data: updatedPost
    });
  } catch (error) {
    console.error("Update post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update post"
    });
  }
};


export const deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;


    const post = await prisma.post.findUnique({
      where: { id }
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    if (post.author_id !== user_id) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to delete this post"
      });
    }

    await prisma.post.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: "Post deleted successfully"
    });
  } catch (error) {
    console.error("Delete post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete post"
    });
  }
};


export const getUserPosts = async (req, res) => {
  try {
    const user_id = req.user.id;

    const posts = await prisma.post.findMany({
      where: {
        author_id: user_id
      },
      include: {
        category: true,
        media: true,
        _count: {
          select: {
            comments: true,
            likes: true,
            bookmarks: true
          }
        }
      },
      orderBy: {
        created_at: "desc"
      }
    });

    res.status(200).json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error("Get user posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user posts"
    });
  }
};

export const getTrendingPosts = async (req, res) => {
  try {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get post IDs with most views in the last 7 days
    const trendingViews = await prisma.postView.groupBy({
      by: ['post_id'],
      where: {
        viewed_at: { gte: lastWeek },
        post: { post_status: "PUBLISHED" }
      },
      _count: { post_id: true },
      orderBy: {
        _count: { post_id: 'desc' }
      },
      take: 10
    });

    if (trendingViews.length === 0) {
      // Fallback: get posts with highest all-time views if no recent views
      const fallbackPosts = await prisma.post.findMany({
        where: { post_status: "PUBLISHED" },
        include: {
          author: { select: { id: true, username: true, profile_image: true } },
          category: true,
          media: true,
          _count: { select: { comments: true, likes: true, bookmarks: true } }
        },
        orderBy: { view_count: "desc" },
        take: 10
      });
      return res.status(200).json({ success: true, data: fallbackPosts });
    }

    const postIds = trendingViews.map(tv => tv.post_id);

    const posts = await prisma.post.findMany({
      where: {
        id: { in: postIds },
        post_status: "PUBLISHED"
      },
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        category: true,
        media: true,
        _count: {
          select: { comments: true, likes: true, bookmarks: true }
        }
      }
    });

    // Sort posts based on the order of postIds (highest views first)
    const sortedPosts = posts.sort((a, b) => postIds.indexOf(a.id) - postIds.indexOf(b.id));

    res.status(200).json({
      success: true,
      data: sortedPosts
    });
  } catch (error) {
    console.error("Get trending posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch trending posts"
    });
  }
};

export const getMostLikedPosts = async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: {
        post_status: "PUBLISHED"
      },
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        category: true,
        media: true,
        _count: {
          select: { comments: true, likes: true, bookmarks: true }
        }
      },
      orderBy: {
        likes: {
          _count: "desc"
        }
      },
      take: 10
    });

    res.status(200).json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error("Get most liked posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch most liked posts"
    });
  }
};

