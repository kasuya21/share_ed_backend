import crypto from "node:crypto";
import { logError, logWarn } from "../utils/logger.js";
import { validatePostFields, validateNewPost, POST_MEDIA_TYPES } from "../utils/post-validation.js";
import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";
import { updateAchievementProgress } from "../utils/achievement.helper.js";
import cloudinary from "../configs/cloudinary.config.js";
import { deleteFromCloudinary } from "../utils/cloudinary.helper.js";
import { supabase } from "../configs/supabase.config.js";
import { MemoryCache } from "../utils/cache.helper.js";

// In-Memory Caches for heavy home page queries
export const trendingPostsCache = new MemoryCache(45 * 1000);
export const mostLikedPostsCache = new MemoryCache(45 * 1000);
export const platformStatsCache = new MemoryCache(60 * 1000);

// Allowed MIME types: PNG, JPG, JPEG, PDF
const ALLOWED_MIME_TYPES = POST_MEDIA_TYPES;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function preparePostTags(values) {
  if (!Array.isArray(values)) return [];
  const names = [...new Set(values
    .filter(value => typeof value === "string" && value.trim())
    .map(value => value.trim())
    .map(value => value.startsWith("#") ? value : `#${value}`))];
  if (names.length === 0) return [];

  const existingTags = await prisma.tag.findMany({
    where: { tag_name: { in: names } }
  });
  const existingMap = new Map(existingTags.map(t => [t.tag_name, t]));
  const missingNames = names.filter(name => !existingMap.has(name));

  let createdTags = [];
  if (missingNames.length > 0) {
    createdTags = await Promise.all(
      missingNames.map(tag_name =>
        prisma.tag.upsert({
          where: { tag_name },
          update: {},
          create: { tag_name }
        })
      )
    );
  }

  const allTags = [...existingTags, ...createdTags];
  return allTags.map(tag => ({ tag_id: tag.id }));
}

export const POST_CARD_SELECT = {
  id: true,
  title: true,
  summary: true,
  education_level: true,
  view_count: true,
  author_id: true,
  category_id: true,
  cover_image: true,
  created_at: true,
  post_status: true,
  author: {
    select: { id: true, username: true, profile_image: true }
  },
  category: true,
  tags: {
    select: { tag: { select: { id: true, tag_name: true } } }
  },
  _count: {
    select: { comments: true, likes: true, bookmarks: true }
  }
};

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

  await mapWithConcurrency(files, 3, async file => {
    const isPdf = file.mimetype === "application/pdf";

    // file.originalname ถูก decode เป็น UTF-8 แล้วโดย upload.middleware.js
    const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, "").trim();

    const uploadOptions = isPdf
      ? {
        folder: `share-ed/posts/${postId}/pdfs`,
        resource_type: "raw",
        use_filename: true,
        unique_filename: false,
        filename_override: file.originalname,  // บอก Cloudinary ว่าชื่อไฟล์ต้นฉบับคืออะไร
        public_id: nameWithoutExt + ".pdf"
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
  });
}

// ============================================================
// GET /api/v1/posts
// ดึงโพสต์ทั้งหมด (รองรับ ค้นหา คัดกรอง คัดกรองด้วยแท็ก และจัดเรียง)
// ============================================================
export const getAllPosts = async (req, res) => {
  try {
    const { search, level, sort, tag, category_id } = req.query;
    const page = positiveInteger(req.query.page, 1);
    const limit = positiveInteger(req.query.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

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

    // กรองตามหมวดหมู่
    if (category_id) {
      where.category_id = category_id;
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

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        select: POST_CARD_SELECT,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    logError("controllers.getAllPosts", error, req);
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
    const userRole = req.userRole || (await prisma.user.findUnique({
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

    res.status(200).json({
      success: true,
      data: post
    });

    // 4.1.3.3 นับจำนวนครั้งเข้าชม (Async non-blocking ใน background)
    (async () => {
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
        }
      } catch (e) {
        logWarn("post.view_tracking_failed", e, req, { postId: id });
      }
    })();
  } catch (error) {
    logError("controllers.getPostById", error, req);
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
  let stage = "validate";
  try {
    const { content = "", post_status, tags } = req.body || {};
    const validation = validateNewPost(req.body, req.files);
    const { title, summary, education_level, category_id } = validation.values;
    const author_id = req.user.id;

    if (!validation.valid) {
      logWarn("post.create.rejected", undefined, req, {
        stage,
        invalidFields: Object.keys(validation.errors).join(","),
      });
      return res.status(400).json({
        success: false,
        code: "POST_VALIDATION_FAILED",
        message: "กรุณาตรวจสอบข้อมูลโพสต์",
        errors: validation.errors,
      });
    }

    stage = "category_lookup";
    const category = await prisma.category.findUnique({ where: { id: category_id }, select: { id: true } });
    if (!category) {
      logWarn("post.create.rejected", undefined, req, { stage, invalidFields: "category_id" });
      return res.status(400).json({
        success: false, code: "POST_CATEGORY_NOT_FOUND", message: "กรุณาตรวจสอบข้อมูลโพสต์", errors: {
          category_id: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่วิชาที่เลือก" }
        }
      });
    }
    const coverFiles = req.files.cover_image;
    const mediaFiles = req.files.media_files;

    // 3. จัดการ Tag
    stage = "tags_prepare";
    let parsedTags = tags;
    if (typeof tags === 'string') {
      try {
        parsedTags = JSON.parse(tags);
      } catch (e) {
        parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const postId = crypto.randomUUID();
    const finalStatus = post_status === "ACTIVE" ? "ACTIVE" : "DRAFT";

    // 4. ขนานการอัปโหลดไฟล์ (หน้าปก + เอกสาร/รูปภาพ Cloudinary) และเตรียมแท็กไปพร้อมกัน
    stage = "parallel_upload_and_prepare";
    const coverPromise = (async () => {
      if (!coverFiles || coverFiles.length === 0) return null;
      const uploadResult = await uploadToCloudinary(coverFiles[0].buffer, {
        folder: "share-ed/posts/covers",
        transformation: [
          { width: 800, height: 600, crop: "fill" },
          { quality: "auto", fetch_format: "auto" }
        ]
      });
      return uploadResult.secure_url;
    })();

    const mediaPromise = (async () => {
      if (!mediaFiles || mediaFiles.length === 0) return [];
      return mapWithConcurrency(mediaFiles, 4, async file => {
        const isPdf = file.mimetype === "application/pdf";
        const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, "").trim();

        const uploadOptions = isPdf
          ? {
            folder: `share-ed/posts/${postId}/pdfs`,
            resource_type: "raw",
            use_filename: true,
            unique_filename: false,
            filename_override: file.originalname,
            public_id: nameWithoutExt + ".pdf"
          }
          : {
            folder: `share-ed/posts/${postId}/media`,
            transformation: [
              { width: 1200, crop: "limit" },
              { quality: "auto", fetch_format: "auto" },
            ],
          };

        const result = await uploadToCloudinary(file.buffer, uploadOptions);
        return {
          media_url: result.secure_url,
          media_type: isPdf ? "PDF" : "IMAGE",
        };
      });
    })();

    const tagsPromise = preparePostTags(parsedTags);

    const [cover_image, mediaData, postTagConnects] = await Promise.all([
      coverPromise,
      mediaPromise,
      tagsPromise
    ]);

    // 5. บันทึกโพสต์ แท็ก และไฟล์แนบในคำสั่งเดียว (Single atomic query)
    stage = "database_create";
    const post = await prisma.post.create({
      data: {
        id: postId,
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
        },
        media: {
          create: mediaData
        }
      },
      include: {
        author: {
          select: { id: true, username: true, profile_image: true }
        },
        tags: {
          include: { tag: true }
        },
        media: true
      }
    });

    // 🔔 แจ้งเตือน Followers และคำนวณ Achievement แบบ Background (Non-blocking)
    if (post.post_status === "ACTIVE") {
      platformStatsCache.clear();
      trendingPostsCache.clear();
      mostLikedPostsCache.clear();

      (async () => {
        try {
          const authorUsername = post.author?.username;
          const followers = await prisma.follow.findMany({
            where: { following_id: author_id },
            select: { follower_id: true }
          });
          await Promise.all(
            followers.map(f =>
              createNotification(
                f.follower_id,
                "NEW_POST",
                `${authorUsername} ได้เผยแพร่ผลงานใหม่: "${post.title}"`,
                post.id
              )
            )
          );

          // 🏆 อัปเดต Achievement: POSTS_CREATED
          const totalActivePosts = await prisma.post.count({
            where: { author_id, post_status: "ACTIVE" }
          });
          await updateAchievementProgress(author_id, "POSTS_CREATED", totalActivePosts);
        } catch (err) {
          logWarn("post.publish_side_effects_failed", err, req, { postId: post.id });
        }
      })();
    }

    stage = "respond";
    res.status(201).json({
      success: true,
      message: "สร้างโพสต์สำเร็จ",
      data: post
    });

  } catch (error) {
    logError("post.create.failed", error, req, {
      stage,
      coverFileCount: req.files?.cover_image?.length || 0,
      mediaFileCount: req.files?.media_files?.length || 0,
      categoryId: req.body?.category_id,
    });
    res.status(500).json({
      success: false,
      code: "POST_CREATE_FAILED",
      message: "สร้างโพสต์ไม่สำเร็จ กรุณาใช้ requestId เพื่อตรวจสอบ log"
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
    const { content, category_id, post_status, tags, remove_media_ids } = req.body || {};
    const validation = validatePostFields(req.body, { partial: true });
    const { title, summary, education_level } = validation.values;
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

    if (!["ACTIVE", "DRAFT"].includes(post.post_status)) {
      return res.status(403).json({ message: "Removed or moderated posts cannot be edited" });
    }
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: "กรุณาตรวจสอบข้อมูลโพสต์",
        errors: validation.errors,
      });
    }
    if (post_status !== undefined && !["ACTIVE", "DRAFT"].includes(post_status)) {
      return res.status(400).json({ message: "Invalid post status" });
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
      if (post.cover_image) {
        await deleteFromCloudinary(post.cover_image);
      }
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

      const postTagConnects = await preparePostTags(parsedTags);

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
        const mediaToDelete = await prisma.postMedia.findMany({
          where: {
            id: { in: parsedRemoveIds },
            post_id: id
          }
        });

        await mapWithConcurrency(mediaToDelete, 3, async m => {
          const resourceType = m.media_type === 'PDF' ? 'raw' : (m.media_type === 'VIDEO' ? 'video' : 'image');
          await deleteFromCloudinary(m.media_url, resourceType);
        });

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
            `${authorUser.username} ได้เผยแพร่ผลงานใหม่: "${updatedPost.title}"`,
            updatedPost.id
          )
        )
      );

      // 🏆 อัปเดต Achievement: POSTS_CREATED
      const totalActivePosts = await prisma.post.count({
        where: { author_id: user_id, post_status: "ACTIVE" }
      });
      await updateAchievementProgress(user_id, "POSTS_CREATED", totalActivePosts);
    }

    if (updatedPost.post_status === "ACTIVE" || wasActive) {
      platformStatsCache.clear();
      trendingPostsCache.clear();
      mostLikedPostsCache.clear();
    }

    res.status(200).json({
      success: true,
      message: "อัปเดตโพสต์สำเร็จ",
      data: updatedPost
    });

  } catch (error) {
    logError("controllers.updatePost", error, req);
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

    platformStatsCache.clear();
    trendingPostsCache.clear();
    mostLikedPostsCache.clear();

    res.status(200).json({ success: true, message: "ลบโพสต์สำเร็จ" });
  } catch (error) {
    logError("controllers.deletePost", error, req);
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
    logError("controllers.getUserPosts", error, req);
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
    const cacheKey = level || "ALL";
    const cached = trendingPostsCache.get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached });
    }

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
        select: POST_CARD_SELECT,
        orderBy: { view_count: "desc" },
        take: 3
      });
      trendingPostsCache.set(cacheKey, fallbackPosts);
      return res.status(200).json({ success: true, data: fallbackPosts });
    }

    const postIds = trendingViews.map(tv => tv.post_id);

    const posts = await prisma.post.findMany({
      where: {
        id: { in: postIds },
        post_status: "ACTIVE"
      },
      select: POST_CARD_SELECT,
    });

    const sortedPosts = posts.sort((a, b) => postIds.indexOf(a.id) - postIds.indexOf(b.id));

    trendingPostsCache.set(cacheKey, sortedPosts);
    res.status(200).json({
      success: true,
      data: sortedPosts
    });
  } catch (error) {
    logError("controllers.getTrendingPosts", error, req);
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
    const cached = mostLikedPostsCache.get("most_liked");
    if (cached) {
      return res.status(200).json({ success: true, data: cached });
    }

    const posts = await prisma.post.findMany({
      where: {
        post_status: "ACTIVE"
      },
      select: POST_CARD_SELECT,
      orderBy: {
        likes: {
          _count: "desc"
        }
      },
      take: 10
    });

    mostLikedPostsCache.set("most_liked", posts);

    res.status(200).json({
      success: true,
      data: posts
    });
  } catch (error) {
    logError("controllers.getMostLikedPosts", error, req);
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
    const cached = platformStatsCache.get("stats");
    if (cached) {
      return res.status(200).json({ success: true, data: cached });
    }

    const [totalPosts, totalSharers] = await Promise.all([
      prisma.post.count({ where: { post_status: 'ACTIVE' } }),
      prisma.user.count(),
    ]);

    const data = {
      totalPosts,
      totalSharers
    };

    platformStatsCache.set("stats", data);

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    logError("controllers.getPlatformStats", error, req);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
