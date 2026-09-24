import crypto from "node:crypto";
import { logError, logWarn } from "../utils/logger.js";
import { validatePostFields, validateNewPost, POST_MEDIA_TYPES } from "../utils/post-validation.js";
import { prisma } from "../configs/prisma.js";
import { getIO } from "../configs/socket.js";
import { createNotification } from "../utils/notification.helper.js";
import { updateAchievementProgress } from "../utils/achievement.helper.js";
import cloudinary from "../configs/cloudinary.config.js";
import { deleteFromCloudinary } from "../utils/cloudinary.helper.js";
import { supabase } from "../configs/supabase.config.js";
import { MemoryCache } from "../utils/cache.helper.js";
import { deletePostPermanently } from "../utils/post-deletion.js";
import {
  DIRECT_UPLOAD_POLICIES,
  DirectUploadValidationError,
  directUploadParams,
  verifyStoredDirectUpload,
  validateDirectUploadList,
} from "../utils/direct-upload.js";

// In-Memory Caches for heavy home page queries
export const trendingPostsCache = new MemoryCache(45 * 1000);
export const mostLikedPostsCache = new MemoryCache(45 * 1000);
export const platformStatsCache = new MemoryCache(60 * 1000);

const AUTHOR_FRAME_SELECT = {
  id: true,
  username: true,
  profile_image: true,
  current_frame_id: true,
  current_frame: {
    select: { id: true, item_name: true, image_url: true, metadata: true }
  }
};

const POST_CREATE_INCLUDE = {
  author: { select: AUTHOR_FRAME_SELECT },
  tags: { include: { tag: true } },
  media: true,
};

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

async function findCreatedPost(authorId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return prisma.post.findFirst({
    where: { author_id: authorId, idempotency_key: idempotencyKey },
    include: POST_CREATE_INCLUDE,
  });
}

// Allowed MIME types: PNG, JPG, JPEG, PDF
const ALLOWED_MIME_TYPES = POST_MEDIA_TYPES;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const TRENDING_WINDOWS_MS = Object.freeze({
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
});
const TRENDING_LEVELS = new Set(["MIDDLE_SCHOOL", "HIGH_SCHOOL", "UNIVERSITY"]);

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

export async function recordPostView(userId, postId, viewedAt = new Date()) {
  const existingView = await prisma.postView.findUnique({
    where: { user_id_post_id: { user_id: userId, post_id: postId } },
    select: { id: true },
  });
  if (existingView) {
    await prisma.postView.update({
      where: { id: existingView.id },
      data: { viewed_at: viewedAt },
    });
    return { created: false };
  }

  await prisma.$transaction([
    prisma.postView.create({ data: { user_id: userId, post_id: postId, viewed_at: viewedAt } }),
    prisma.post.update({
      where: { id: postId },
      data: { view_count: { increment: 1 } },
    }),
  ]);
  return { created: true };
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

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

function normalizeOriginalFileName(value) {
  if (typeof value !== "string") return null;
  const baseName = value
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!baseName) return null;
  return baseName.slice(0, 255);
}

function cloudinaryRawPublicId(url) {
  if (typeof url !== "string") return null;
  const uploadMarker = "/raw/upload/";
  const markerIndex = url.indexOf(uploadMarker);
  if (markerIndex < 0) return null;
  const path = url.slice(markerIndex + uploadMarker.length).replace(/^v\d+\//, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

async function restoreMissingPdfNames(post, req) {
  const missingPdfs = post.media?.filter(
    media => media.media_type === "PDF" && !media.original_name
  ) || [];
  await Promise.all(missingPdfs.map(async media => {
    const publicId = cloudinaryRawPublicId(media.media_url);
    if (!publicId) return;
    try {
      const asset = await cloudinary.api.resource(publicId, {
        resource_type: "raw",
        type: "upload",
        timeout: 5000,
      });
      let originalName = normalizeOriginalFileName(asset.original_filename);
      if (originalName && !originalName.toLowerCase().endsWith(".pdf")) {
        originalName += ".pdf";
      }
      if (!originalName) return;
      media.original_name = originalName;
      await prisma.postMedia.update({
        where: { id: media.id },
        data: { original_name: originalName },
      });
    } catch (error) {
      logWarn("post.pdf_original_name_restore_failed", error, req, {
        postId: post.id,
        mediaId: media.id,
      });
    }
  }));
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
    select: AUTHOR_FRAME_SELECT
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
        original_name: normalizeOriginalFileName(file.originalname),
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

    res.setHeader?.("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
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
            ...AUTHOR_FRAME_SELECT,
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

    if (post.post_status === "UNACTIVED" && post.author_id !== userId && !["MODERATOR", "ADMIN"].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "โพสต์นี้ถูกซ่อนหรือระงับการเข้าใช้งานเนื่องจากขัดต่อกฎของระบบ"
      });
    }

    await restoreMissingPdfNames(post, req);

    res.status(200).json({
      success: true,
      data: post
    });

    // 4.1.3.3 นับจำนวนครั้งเข้าชม (Async non-blocking ใน background)
    (async () => {
      try {
        await recordPostView(userId, id);
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
    const {
      content = "",
      post_status,
      tags,
      upload_session_id: uploadSessionId,
      idempotency_key: idempotencyKey,
    } = req.body || {};
    const validation = validateNewPost(req.body, req.files);
    const { title, summary, education_level } = validation.values;
    let { category_id } = validation.values;
    const author_id = req.user.id;

    if (idempotencyKey != null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "รหัสป้องกันการสร้างโพสต์ซ้ำไม่ถูกต้อง",
      });
    }

    const replayedPost = await findCreatedPost(author_id, idempotencyKey);
    if (replayedPost) {
      return res.status(200).json({
        success: true,
        replayed: true,
        message: "โพสต์นี้ถูกสร้างไว้แล้ว",
        data: replayedPost,
      });
    }

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
    const category = category_id
      ? await prisma.category.findUnique({ where: { id: category_id }, select: { id: true } })
      : validation.values.category
        ? await prisma.category.findUnique({ where: { name: validation.values.category }, select: { id: true } })
        : null;
    if (!category && (post_status !== "DRAFT" || category_id || validation.values.category)) {
      logWarn("post.create.rejected", undefined, req, { stage, invalidFields: "category_id" });
      return res.status(400).json({
        success: false, code: "POST_CATEGORY_NOT_FOUND", message: "กรุณาตรวจสอบข้อมูลโพสต์", errors: {
          category_id: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่วิชาที่เลือก" }
        }
      });
    }
    category_id = category?.id || null;
    const coverFiles = req.files?.cover_image;
    const mediaFiles = req.files?.media_files;

    const directCover = parseJsonValue(req.body?.cover_upload);
    const directMedia = parseJsonValue(req.body?.media_uploads);
    let verifiedCoverUrl = null;
    let verifiedDirectMedia = [];
    let verifiedSessionAssets = null;

    if (directCover || directMedia) {
      stage = "direct_upload_verify";
      try {
        if (!idempotencyKey) {
          throw new DirectUploadValidationError("ไม่พบรหัสป้องกันการสร้างโพสต์ซ้ำ", "idempotency_key");
        }
        if (typeof uploadSessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(uploadSessionId)) {
          throw new DirectUploadValidationError("ไม่พบ upload session ที่ถูกต้อง", "upload_session_id");
        }
        const uploadSession = await prisma.uploadSession.findFirst({
          where: {
            id: uploadSessionId,
            user_id: author_id,
            status: "PENDING",
            expires_at: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!uploadSession) {
          throw new DirectUploadValidationError("upload session หมดอายุ ถูกใช้แล้ว หรือไม่ใช่ของผู้ใช้งาน", "upload_session_id");
        }

        validateDirectUploadList(directCover, directMedia ?? []);
        let totalBytes = 0;
        const sessionAssets = [];
        const lookup = (id, options) => cloudinary.api.resource(id, { ...options, timeout: 15000 });
        const verification = {
          userId: author_id,
          sessionId: uploadSessionId,
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          verifySignature: (publicId, version, signature) =>
            cloudinary.utils.verify_api_response_signature(publicId, version, signature),
        };
        if (directCover) {
          const verifiedCover = await verifyStoredDirectUpload(directCover, {
            ...verification,
            type: "cover",
            field: "cover_upload",
          }, lookup);
          verifiedCoverUrl = verifiedCover.media_url;
          totalBytes += verifiedCover.bytes;
          sessionAssets.push({ public_id: directCover.public_id, type: "cover", bytes: verifiedCover.bytes });
        }
        if (Array.isArray(directMedia)) {
          verifiedDirectMedia = await mapWithConcurrency(directMedia, 4, async (asset, index) => {
            const type = asset?.resource_type === "raw" || asset?.format === "pdf" ? "pdf" : "media";
            const verified = await verifyStoredDirectUpload(asset, {
              ...verification, type, field: `media_uploads.${index}`,
            }, lookup);
            totalBytes += verified.bytes;
            sessionAssets.push({ public_id: asset.public_id, type, bytes: verified.bytes });
            return {
              media_url: verified.media_url,
              media_type: verified.media_type,
              original_name: normalizeOriginalFileName(asset.original_name),
            };
          });
        }
        if (totalBytes > 50 * 1024 * 1024) throw new DirectUploadValidationError("ขนาดไฟล์รวมเกิน 50 MB");
        verifiedSessionAssets = sessionAssets;
      } catch (error) {
        if (!(error instanceof DirectUploadValidationError)) throw error;
        logWarn("post.create.direct_upload_rejected", error, req, { stage, field: error.field });
        return res.status(400).json({
          success: false,
          code: error.code,
          message: "กรุณาตรวจสอบไฟล์ที่อัปโหลด",
          errors: {
            [error.field]: { code: error.code, message: error.message },
          },
        });
      }
    }

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

    // 4. จัดการไฟล์หน้าปกและไฟล์ประกอบ (รองรับทั้ง Direct Uploaded URLs และ Multipart Files)
    stage = "parallel_upload_and_prepare";
    const coverPromise = (async () => {
      if (verifiedCoverUrl) return verifiedCoverUrl;
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
      if (verifiedDirectMedia.length > 0) return verifiedDirectMedia;

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
          original_name: normalizeOriginalFileName(file.originalname),
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
    const createData = {
      id: postId,
      title,
      summary: summary || "",
      content,
      education_level,
      author_id,
      category_id: category_id || null,
      post_status: finalStatus,
      cover_image,
      idempotency_key: idempotencyKey || null,
      tags: {
        create: postTagConnects
      },
      media: {
        create: mediaData
      }
    };
    const createPostQuery = client => client.post.create({
      data: {
        ...createData,
      },
      include: POST_CREATE_INCLUDE,
    });
    const post = uploadSessionId
      ? await prisma.$transaction(async transaction => {
          const created = await createPostQuery(transaction);
          const committed = await transaction.uploadSession.updateMany({
            where: {
              id: uploadSessionId,
              user_id: author_id,
              status: "PENDING",
              expires_at: { gt: new Date() },
            },
            data: {
              status: "COMMITTED",
              post_id: created.id,
              verified_assets: verifiedSessionAssets,
            },
          });
          if (committed.count !== 1) {
            throw new DirectUploadValidationError("upload session ถูกใช้แล้วหรือหมดอายุ", "upload_session_id");
          }
          return created;
        })
      : await createPostQuery(prisma);

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
    if (error?.code === "P2002" && req.body?.idempotency_key) {
      const replayedPost = await findCreatedPost(req.user.id, req.body.idempotency_key);
      if (replayedPost) {
        return res.status(200).json({
          success: true,
          replayed: true,
          message: "โพสต์นี้ถูกสร้างไว้แล้ว",
          data: replayedPost,
        });
      }
    }
    if (error instanceof DirectUploadValidationError) {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: "ไม่สามารถยืนยัน upload session ได้",
        errors: { [error.field]: { code: error.code, message: error.message } },
      });
    }
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
          select: AUTHOR_FRAME_SELECT
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
// ลบโพสต์และไฟล์ที่เกี่ยวข้องอย่างถาวร
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
    await deletePostPermanently(id);
    getIO()?.to("role:moderation").emit("report_reviewed", { postId: id, action: "DELETE" });

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
      where: { author_id: user_id },
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
// จัดอันดับจากจำนวนผู้ชมล่าสุด รองรับช่วง 24 ชั่วโมง, 7 วัน และ 30 วัน
// ============================================================
export const getTrendingPosts = async (req, res) => {
  try {
    res.setHeader?.("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    const { level, window: requestedWindow = "7d", limit: requestedLimit } = req.query || {};
    if (level && !TRENDING_LEVELS.has(level)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_EDUCATION_LEVEL",
        message: "ระดับชั้นการศึกษาไม่ถูกต้อง",
      });
    }
    if (!Object.hasOwn(TRENDING_WINDOWS_MS, requestedWindow)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_TRENDING_WINDOW",
        message: "ช่วงเวลา Trending ต้องเป็น 24h, 7d หรือ 30d",
      });
    }
    if (requestedLimit !== undefined && !/^\d+$/.test(String(requestedLimit))) {
      return res.status(400).json({
        success: false,
        code: "INVALID_TRENDING_LIMIT",
        message: "จำนวนโพสต์ Trending ต้องเป็นเลขจำนวนเต็ม 1–20",
      });
    }
    const parsedLimit = requestedLimit === undefined ? 3 : Number(requestedLimit);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20) {
      return res.status(400).json({
        success: false,
        code: "INVALID_TRENDING_LIMIT",
        message: "จำนวนโพสต์ Trending ต้องอยู่ระหว่าง 1–20",
      });
    }

    const cacheKey = `${level || "ALL"}:${requestedWindow}:${parsedLimit}`;
    const cached = trendingPostsCache.get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, ...cached });
    }

    const windowStartedAt = new Date(Date.now() - TRENDING_WINDOWS_MS[requestedWindow]);

    // One PostView row per user/post means this ranks unique recent viewers.
    const trendingViews = await prisma.postView.groupBy({
      by: ['post_id'],
      where: {
        viewed_at: { gte: windowStartedAt },
        post: {
          post_status: "ACTIVE",
          ...(level && { education_level: level })
        }
      },
      _count: { post_id: true },
      orderBy: {
        _count: { post_id: 'desc' }
      },
      take: parsedLimit
    });

    if (trendingViews.length === 0) {
      // A new site may have no recent views yet; show recent active posts rather
      // than allowing old lifetime totals to dominate the trending section.
      const fallbackPosts = await prisma.post.findMany({
        where: {
          post_status: "ACTIVE",
          ...(level && { education_level: level })
        },
        select: POST_CARD_SELECT,
        orderBy: { created_at: "desc" },
        take: parsedLimit
      });
      const payload = {
        data: fallbackPosts.map(post => ({ ...post, recent_view_count: 0 })),
        meta: {
          window: requestedWindow,
          window_started_at: windowStartedAt.toISOString(),
          fallback: "latest_posts",
        },
      };
      trendingPostsCache.set(cacheKey, payload);
      return res.status(200).json({ success: true, ...payload });
    }

    const postIds = trendingViews.map(tv => tv.post_id);

    const posts = await prisma.post.findMany({
      where: {
        id: { in: postIds },
        post_status: "ACTIVE"
      },
      select: POST_CARD_SELECT,
    });

    const viewCounts = new Map(trendingViews.map(item => [item.post_id, item._count.post_id]));
    const sortedPosts = posts
      .sort((a, b) => postIds.indexOf(a.id) - postIds.indexOf(b.id))
      .map(post => ({ ...post, recent_view_count: viewCounts.get(post.id) || 0 }));

    const payload = {
      data: sortedPosts,
      meta: {
        window: requestedWindow,
        window_started_at: windowStartedAt.toISOString(),
        fallback: null,
      },
    };
    trendingPostsCache.set(cacheKey, payload);
    res.status(200).json({
      success: true,
      ...payload,
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
    res.setHeader?.("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
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
    res.setHeader?.("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
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

// ============================================================
// GET /api/v1/posts/upload-signature
// สร้าง Cloudinary Signature สำหรับ Direct Client Upload
// ============================================================
const DIRECT_UPLOAD_TYPES = new Set(Object.keys(DIRECT_UPLOAD_POLICIES));

function directUploadSignature(type, timestamp, userId, sessionId) {
  const policy = DIRECT_UPLOAD_POLICIES[type];
  const paramsToSign = directUploadParams(type, userId, timestamp, sessionId);
  return {
    type,
    signature: cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET),
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder: paramsToSign.folder,
    uploadParams: paramsToSign,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${policy.resourceType}/upload`,
  };
}

export const getUploadSignature = async (req, res) => {
  try {
    const { type } = req.query; // "cover" | "media" | "pdf"
    if (!DIRECT_UPLOAD_TYPES.has(type)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_UPLOAD_TYPE",
        message: "ประเภทการอัปโหลดไม่ถูกต้อง",
      });
    }
    const timestamp = Math.round(new Date().getTime() / 1000);

    res.status(200).json({
      success: true,
      data: directUploadSignature(type, timestamp, req.user.id),
    });
  } catch (error) {
    logError("controllers.getUploadSignature", error, req);
    res.status(500).json({
      success: false,
      message: "Failed to generate upload signature"
    });
  }
};

// POST /api/v1/posts/upload-signatures
// ขอสิทธิ์ cover/media/pdf ครั้งเดียว แล้วอัปโหลดไฟล์ทั้งหมดตรงไป Cloudinary พร้อมกัน
export const getUploadSignatures = async (req, res) => {
  try {
    const types = req.body?.types;
    if (!Array.isArray(types) || types.length === 0 || types.length > 4) {
      return res.status(400).json({
        success: false,
        code: "INVALID_UPLOAD_TYPES",
        message: "กรุณาระบุประเภทการอัปโหลด 1–4 ประเภท",
      });
    }
    const uniqueTypes = [...new Set(types)];
    if (uniqueTypes.some(type => !DIRECT_UPLOAD_TYPES.has(type))) {
      return res.status(400).json({
        success: false,
        code: "INVALID_UPLOAD_TYPE",
        message: "ประเภทการอัปโหลดไม่ถูกต้อง",
      });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.uploadSession.create({
      data: {
        id: sessionId,
        user_id: req.user.id,
        requested_types: uniqueTypes,
        expires_at: expiresAt,
      },
    });
    const uploads = Object.fromEntries(
      uniqueTypes.map(type => [type, directUploadSignature(type, timestamp, req.user.id, sessionId)])
    );
    return res.status(200).json({
      success: true,
      data: { uploads, sessionId, expiresAt: expiresAt.toISOString() },
    });
  } catch (error) {
    logError("controllers.getUploadSignatures", error, req);
    return res.status(500).json({ success: false, message: "Failed to generate upload signatures" });
  }
};

