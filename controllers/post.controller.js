import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";
import cloudinary from "../configs/cloudinary.config.js";
import { supabase } from "../configs/supabase.config.js";

// Allowed MIME types: PNG, JPG, JPEG, PDF
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

// ─── Helper: Upload a single buffer to Cloudinary ───
async function uploadToCloudinary(fileBuffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(fileBuffer);
  });
}

// ─── Helper: Upload media files & create PostMedia records ───
async function handleMediaFiles(files, postId) {
  if (!files || files.length === 0) return;

  for (const file of files) {
    const isPdf = file.mimetype === "application/pdf";

    const uploadOptions = isPdf
      ? { 
          folder: `share-ed/posts/${postId}/pdfs`, 
          resource_type: "auto"
        }
      : {
          folder: `share-ed/posts/${postId}/media`,
          transformation: [
            { width: 1200, crop: "limit" },
            { quality: "auto", fetch_format: "auto" },
          ],
        };

    const result = await uploadToCloudinary(file.buffer, uploadOptions);

    await prisma.postMedia.create({
      data: {
        media_url: result.secure_url,
        media_type: isPdf ? "PDF" : "IMAGE",
        post_id: postId,
      },
    });
  }
}

// ============================================================
// GET /api/v1/posts
// ดึงโพสต์ทั้งหมด (รองรับ ค้นหา คัดกรอง คัดกรองด้วยแท็ก และจัดเรียง)
// ============================================================
export const getAllPosts = async (req, res) => {
  try {
    const { search, level, sort, tag } = req.query;

    const where = { post_status: "ACTIVE" };

    // 4.1.4.1 ค้นหาคำสำคัญจาก Title, Content, Author name และ Hashtag
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        {
          author: {
            username: { contains: search, mode: "insensitive" }
          }
        },
        {
          tags: {
            some: {
              tag: {
                tag_name: { contains: search, mode: "insensitive" }
              }
            }
          }
        }
      ];
    }

    // กรองตามระดับชั้นการศึกษา
    if (level) {
      where.education_level = level;
    }

    // กรองตามแท็กที่เลือก
    if (tag) {
      where.tags = {
        some: {
          tag: {
            tag_name: { equals: tag, mode: "insensitive" }
          }
        }
      };
    }

    // การจัดเรียงลำดับผลลัพธ์
    let orderBy;
    if (sort === "popular" || sort === "view") {
      orderBy = { view_count: "desc" };
    } else if (sort === "likes" || sort === "liked") {
      orderBy = { likes: { _count: "desc" } };
    } else {
      orderBy = { created_at: "desc" }; // default: latest
    }

    const posts = await prisma.post.findMany({
      where,
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        category: true,
        media: true,
        tags: {
          include: { tag: true }
        },
        _count: {
          select: { comments: true, likes: true, bookmarks: true }
        }
      },
      orderBy
    });

    res.status(200).json({ success: true, data: posts });
  } catch (error) {
    console.error("Get all posts error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch posts" });
  }
};

// ============================================================
// GET /api/v1/posts/:id
// ดึงข้อมูลโพสต์ตาม ID (ควบคุมสิทธิ์ และ ป้องกันสแปมวิว)
// ============================================================
export const getPostById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // ดึงบทบาทผู้ใช้ด้วย
    const userRole = req.user.role || (await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    }))?.role;

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
        tags: {
          include: { tag: true }
        },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profile_image: true
              }
            }
          },
          orderBy: { created_at: "desc" }
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
        message: "ไม่พบโพสต์"
      });
    }

    // 4.1.2.2 & 4.1.9.1 ควบคุมสิทธิ์การเข้าถึงข้อมูลสถานะต่างๆ
    if (post.post_status === "DRAFT" && post.author_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "คุณไม่มีสิทธิ์เข้าถึงโพสต์ฉบับร่างนี้"
      });
    }

    if (post.post_status === "DELETED" && post.author_id !== userId && !["MODERATOR", "ADMIN"].includes(userRole)) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบโพสต์ (โพสต์ถูกลบแล้ว)"
      });
    }

    if (post.post_status === "UNACTIVED" && post.author_id !== userId && !["MODERATOR", "ADMIN"].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "โพสต์นี้ถูกซ่อนหรือระงับการเข้าใช้งานเนื่องจากขัดต่อกฎของระบบ"
      });
    }

    // 4.1.3.3 นับจำนวนครั้งเข้าชม (เฉพาะกรณีที่เป็นผู้ใช้คนละคนกันในเซสชัน เพื่อป้องกันการปั๊มยอด)
    try {
      const existingView = await prisma.postView.findUnique({
        where: {
          user_id_post_id: { user_id: userId, post_id: id }
        }
      });
      if (!existingView) {
        await prisma.$transaction([
          prisma.postView.create({ data: { user_id: userId, post_id: id } }),
          prisma.post.update({
            where: { id },
            data: { view_count: { increment: 1 } }
          })
        ]);
        post.view_count += 1;
      }
    } catch (e) {
      // Ignore view tracking errors
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

// ============================================================
// POST /api/v1/posts
// สร้างและเผยแพร่โพสต์ใหม่ (หรือเซฟดราฟท์)
// ============================================================
export const createPost = async (req, res) => {
  try {
    const { title, summary, content, education_level, category_id, post_status, tags } = req.body;
    const author_id = req.user.id;

    if (!title || !content || !education_level) {
      return res.status(400).json({
        success: false,
        message: "หัวข้อ, เนื้อหา และระดับชั้นการศึกษา จำเป็นต้องระบุ"
      });
    }

    // 1. ตรวจสอบชนิดไฟล์หน้าปกและไฟล์แนบ
    const coverFiles = req.files?.cover_image;
    if (coverFiles && coverFiles.length > 0) {
      if (coverFiles[0].mimetype === "application/pdf" || !ALLOWED_MIME_TYPES.includes(coverFiles[0].mimetype)) {
        return res.status(400).json({
          success: false,
          message: "ประเภทไฟล์รูปภาพหน้าปกไม่ถูกต้อง (รองรับเฉพาะ PNG, JPG, JPEG)"
        });
      }
    }

    const mediaFiles = req.files?.media_files;
    if (mediaFiles && mediaFiles.length > 0) {
      for (const file of mediaFiles) {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return res.status(400).json({
            success: false,
            message: "ประเภทไฟล์แนบประกอบไม่ถูกต้อง (รองรับเฉพาะ PNG, JPG, JPEG, PDF)"
          });
        }
      }
    }

    // 2. มาตรการป้องกันสแปม (สร้างโพสต์ไม่เกิน 3 โพสต์ใน 24 ชั่วโมง)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPostCount = await prisma.post.count({
      where: {
        author_id,
        created_at: { gte: since24h },
        post_status: { in: ["ACTIVE", "DRAFT"] } // นับโพสต์ปกติและแบบร่าง
      }
    });

    if (recentPostCount >= 3) {
      const oldestRecentPost = await prisma.post.findFirst({
        where: {
          author_id,
          created_at: { gte: since24h },
          post_status: { in: ["ACTIVE", "DRAFT"] }
        },
        orderBy: { created_at: "asc" }
      });
      const resetTime = oldestRecentPost 
        ? (oldestRecentPost.created_at.getTime() + 24 * 60 * 60 * 1000 - Date.now()) 
        : 0;

      return res.status(429).json({
        success: false,
        message: "คุณสร้างโพสต์ครบขีดจำกัด 3 โพสต์ในรอบ 24 ชั่วโมงแล้ว",
        countdown: Math.max(0, resetTime)
      });
    }

    // 3. จัดการ Tag
    let parsedTags = tags;
    if (typeof tags === 'string') {
      try {
        parsedTags = JSON.parse(tags);
      } catch (e) {
        parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const postTagConnects = [];
    if (parsedTags && Array.isArray(parsedTags)) {
      for (const tagName of parsedTags) {
        const cleanedTag = tagName.startsWith("#") ? tagName : `#${tagName}`;
        const tag = await prisma.tag.upsert({
          where: { tag_name: cleanedTag },
          update: {},
          create: { tag_name: cleanedTag },
        });
        postTagConnects.push({ tag_id: tag.id });
      }
    }

    // 4. อัปโหลดรูปหน้าปกขึ้น Cloudinary
    let cover_image = null;
    if (coverFiles && coverFiles.length > 0) {
      const uploadResult = await uploadToCloudinary(coverFiles[0].buffer, {
        folder: "share-ed/posts/covers",
        transformation: [
          { width: 800, height: 600, crop: "fill" },
          { quality: "auto", fetch_format: "auto" }
        ]
      });
      cover_image = uploadResult.secure_url;
    }

    // 5. บันทึกโพสต์
    const finalStatus = post_status === "ACTIVE" ? "ACTIVE" : "DRAFT";

    const post = await prisma.post.create({
      data: {
        title,
        summary: summary || "",
        content,
        education_level,
        author_id,
        category_id: category_id || null,
        post_status: finalStatus,
        cover_image,
        tags: {
          create: postTagConnects
        }
      },
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        tags: {
          include: { tag: true }
        }
      }
    });

    // 6. อัปโหลดไฟล์แนบเพิ่มเติม
    if (mediaFiles && mediaFiles.length > 0) {
      await handleMediaFiles(mediaFiles, post.id);
    }

    // 🔔 แจ้งเตือน Followers เมื่อโพสต์ถูก ACTIVE ทันที
    if (post.post_status === "ACTIVE") {
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
            `${authorUser.username} ได้เผยแพร่ผลงานใหม่: "${post.title}"`
          )
        )
      );
    }

    res.status(201).json({
      success: true,
      message: "สร้างโพสต์สำเร็จ",
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

// ============================================================
// PUT /api/v1/posts/:id
// แก้ไขและปรับปรุงข้อมูลโพสต์ (รวมการเพิ่ม/ลดไฟล์แนบ)
// ============================================================
export const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, summary, content, education_level, category_id, post_status, tags, remove_media_ids } = req.body;
    const user_id = req.user.id;

    // ตรวจสอบโพสต์และความเป็นเจ้าของ
    const post = await prisma.post.findUnique({
      where: { id }
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบโพสต์"
      });
    }

    if (post.author_id !== user_id) {
      return res.status(403).json({
        success: false,
        message: "คุณไม่มีสิทธิ์แก้ไขโพสต์ของผู้อื่น"
      });
    }

    // 1. ตรวจสอบไฟล์มัลติมีเดียชนิดต่างๆ
    const coverFiles = req.files?.cover_image;
    if (coverFiles && coverFiles.length > 0) {
      if (coverFiles[0].mimetype === "application/pdf" || !ALLOWED_MIME_TYPES.includes(coverFiles[0].mimetype)) {
        return res.status(400).json({
          success: false,
          message: "ประเภทไฟล์รูปภาพหน้าปกไม่ถูกต้อง (รองรับเฉพาะ PNG, JPG, JPEG)"
        });
      }
    }

    const mediaFiles = req.files?.media_files;
    if (mediaFiles && mediaFiles.length > 0) {
      for (const file of mediaFiles) {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return res.status(400).json({
            success: false,
            message: "ประเภทไฟล์แนบประกอบไม่ถูกต้อง (รองรับเฉพาะ PNG, JPG, JPEG, PDF)"
          });
        }
      }
    }

    // 2. จัดเตรียมข้อมูลสำหรับอัปเดต
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (summary !== undefined) updateData.summary = summary;
    if (content !== undefined) updateData.content = content;
    if (education_level !== undefined) updateData.education_level = education_level;
    if (category_id !== undefined) updateData.category_id = category_id;
    if (post_status !== undefined) updateData.post_status = post_status;

    // อัปโหลดไฟล์รูปหน้าปกใหม่
    if (coverFiles && coverFiles.length > 0) {
      const uploadResult = await uploadToCloudinary(coverFiles[0].buffer, {
        folder: "share-ed/posts/covers",
        transformation: [
          { width: 800, height: 600, crop: "fill" },
          { quality: "auto", fetch_format: "auto" }
        ]
      });
      updateData.cover_image = uploadResult.secure_url;
    }

    // 3. จัดการแท็ก
    let parsedTags = tags;
    if (typeof tags === 'string' && tags.trim()) {
      try {
        parsedTags = JSON.parse(tags);
      } catch (e) {
        parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    if (parsedTags !== undefined && Array.isArray(parsedTags)) {
      // ลบแท็กเก่าของโพสต์ออกก่อน
      await prisma.postTag.deleteMany({
        where: { post_id: id }
      });

      const postTagConnects = [];
      for (const tagName of parsedTags) {
        const cleanedTag = tagName.startsWith("#") ? tagName : `#${tagName}`;
        const tag = await prisma.tag.upsert({
          where: { tag_name: cleanedTag },
          update: {},
          create: { tag_name: cleanedTag },
        });
        postTagConnects.push({ tag_id: tag.id });
      }

      updateData.tags = {
        create: postTagConnects
      };
    }

    // 4. ลดไฟล์แนบ: ลบไฟล์แนบตาม ID ที่ได้รับ
    if (remove_media_ids) {
      let parsedRemoveIds = remove_media_ids;
      if (typeof remove_media_ids === 'string') {
        try {
          parsedRemoveIds = JSON.parse(remove_media_ids);
        } catch (e) {
          parsedRemoveIds = remove_media_ids.split(',').map(x => x.trim()).filter(Boolean);
        }
      }
      if (Array.isArray(parsedRemoveIds) && parsedRemoveIds.length > 0) {
        await prisma.postMedia.deleteMany({
          where: {
            id: { in: parsedRemoveIds },
            post_id: id
          }
        });
      }
    }

    const wasActive = post.post_status === "ACTIVE";

    const updatedPost = await prisma.post.update({
      where: { id },
      data: updateData,
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        category: true,
        media: true,
        tags: {
          include: { tag: true }
        },
        _count: {
          select: { comments: true, likes: true, bookmarks: true }
        }
      }
    });

    // เพิ่มไฟล์แนบใหม่
    if (mediaFiles && mediaFiles.length > 0) {
      await handleMediaFiles(mediaFiles, id);
    }

    // 🔔 แจ้งเตือน Followers เมื่อเปลี่ยนเป็น ACTIVE (จากที่เคยเป็นแบบร่างมาก่อน)
    if (updatedPost.post_status === "ACTIVE" && !wasActive) {
      const authorUser = await prisma.user.findUnique({
        where: { id: user_id },
        select: { username: true }
      });
      const followers = await prisma.follow.findMany({
        where: { following_id: user_id },
        select: { follower_id: true }
      });
      await Promise.all(
        followers.map(f =>
          createNotification(
            f.follower_id,
            "NEW_POST",
            `${authorUser.username} ได้เผยแพร่ผลงานใหม่: "${updatedPost.title}"`
          )
        )
      );
    }

    res.status(200).json({
      success: true,
      message: "อัปเดตโพสต์สำเร็จ",
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

// ============================================================
// DELETE /api/v1/posts/:id
// ลบโพสต์ (Soft Delete: เปลี่ยนสถานะเป็น DELETED)
// ============================================================
export const deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const post = await prisma.post.findUnique({ where: { id } });

    if (!post) {
      return res.status(404).json({ success: false, message: "ไม่พบโพสต์" });
    }

    if (post.author_id !== user_id) {
      return res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ลบโพสต์ของผู้อื่น" });
    }

    // Soft Delete: เปลี่ยนสถานะเป็น DELETED
    await prisma.post.update({
      where: { id },
      data: { post_status: "DELETED" }
    });

    res.status(200).json({ success: true, message: "ลบโพสต์สำเร็จ" });
  } catch (error) {
    console.error("Delete post error:", error);
    res.status(500).json({ success: false, message: "Failed to delete post" });
  }
};

// ============================================================
// GET /api/v1/posts/user/my-posts
// ดึงโพสต์ทั้งหมดที่เป็นของตัวเอง (รวม Draft)
// ============================================================
export const getUserPosts = async (req, res) => {
  try {
    const user_id = req.user.id;

    const posts = await prisma.post.findMany({
      where: {
        author_id: user_id,
        post_status: { not: "DELETED" } // ไม่แสดงโพสต์ที่โดนลบ
      },
      include: {
        category: true,
        media: true,
        tags: {
          include: { tag: true }
        },
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

// ============================================================
// GET /api/v1/posts/trending
// ดึงโพสต์ยอดนิยมประจำสัปดาห์ (Trending Now) 3 อันดับแรก (รองรับการกรองตามชั้นเรียน)
// ============================================================
export const getTrendingPosts = async (req, res) => {
  try {
    const { level } = req.query; // MIDDLE_SCHOOL, HIGH_SCHOOL, UNIVERSITY
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    // ดึงโพสต์ที่มีคนเข้าชมมากที่สุด 3 อันดับแรกใน 7 วันที่ผ่านมา
    const trendingViews = await prisma.postView.groupBy({
      by: ['post_id'],
      where: {
        viewed_at: { gte: lastWeek },
        post: {
          post_status: "ACTIVE",
          ...(level && { education_level: level })
        }
      },
      _count: { post_id: true },
      orderBy: {
        _count: { post_id: 'desc' }
      },
      take: 3
    });

    if (trendingViews.length === 0) {
      // Fallback: ดึงโพสต์ยอดนิยมตลอดกาล
      const fallbackPosts = await prisma.post.findMany({
        where: {
          post_status: "ACTIVE",
          ...(level && { education_level: level })
        },
        include: {
          author: { select: { id: true, username: true, profile_image: true } },
          category: true,
          media: true,
          tags: { include: { tag: true } },
          _count: { select: { comments: true, likes: true, bookmarks: true } }
        },
        orderBy: { view_count: "desc" },
        take: 3
      });
      return res.status(200).json({ success: true, data: fallbackPosts });
    }

    const postIds = trendingViews.map(tv => tv.post_id);

    const posts = await prisma.post.findMany({
      where: {
        id: { in: postIds },
        post_status: "ACTIVE"
      },
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        category: true,
        media: true,
        tags: { include: { tag: true } },
        _count: {
          select: { comments: true, likes: true, bookmarks: true }
        }
      }
    });

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

// ============================================================
// GET /api/v1/posts/most-liked
// ดึงโพสต์ที่มีการกดไลก์รวมสูงสุด (Most Liked)
// ============================================================
export const getMostLikedPosts = async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: {
        post_status: "ACTIVE"
      },
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        category: true,
        media: true,
        tags: { include: { tag: true } },
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

// ============================================================
// GET /api/v1/posts/stats
// สถิติต่างๆ ในระบบ
// ============================================================
export const getPlatformStats = async (req, res) => {
  try {
    const totalPosts = await prisma.post.count({
      where: { post_status: 'ACTIVE' }
    });
    const totalSharers = await prisma.user.count();

    res.status(200).json({
      success: true,
      data: {
        totalPosts,
        totalSharers
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
