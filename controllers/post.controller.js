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
  createSignedPdfUpload,
  verifyUploadedPdf,
  createSignedPdfDownloadUrl,
  deleteSupabasePdfObject,
  SupabasePdfError,
  getSupabasePdfBucket,
  getPostPdfMaxBytes,
} from "../utils/supabase-storage.js";
import {
  DIRECT_UPLOAD_POLICIES,
  DirectUploadValidationError,
  directUploadParams,
  verifyStoredDirectUpload,
  validateDirectUploadList,
} from "../utils/direct-upload.js";
import {
  UPLOAD_WORKSPACE_LIMITS,
  UPLOAD_ERROR_CODES,
  UPLOAD_WORKSPACE_V2_ENABLED,
} from "../configs/upload-workspace.constants.js";
import { UploadWorkspaceError } from "../utils/upload-workspace.service.js";
import { enqueueJob, JOB_TYPES } from "../utils/job-queue.js";


// In-Memory Caches for heavy home page queries
export const trendingPostsCache = new MemoryCache(2 * 60 * 1000);
export const mostLikedPostsCache = new MemoryCache(60 * 1000);
export const platformStatsCache = new MemoryCache(5 * 60 * 1000);

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
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const POST_VIEW_RECENCY_REFRESH_MS = 15 * 60 * 1000;
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
    select: { id: true, viewed_at: true },
  });
  if (existingView) {
    const lastViewedAt = existingView.viewed_at?.getTime?.();
    if (Number.isFinite(lastViewedAt)
      && viewedAt.getTime() - lastViewedAt < POST_VIEW_RECENCY_REFRESH_MS) {
      return { created: false };
    }
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
    media => media.media_type === "PDF" && !media.original_name && media.storage_provider !== "SUPABASE"
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

async function cleanupUnattachedSupabasePaths(paths) {
  await Promise.all(paths.map(async ({ bucket, path }) => {
    let attached;
    try {
      attached = await prisma.postMedia.findFirst({
        where: {
          storage_provider: "SUPABASE",
          storage_bucket: bucket,
          storage_path: path,
        },
        select: { id: true },
      });
    } catch (error) {
      // Fail closed: when the database cannot confirm ownership, leave the
      // object for the expired-session cron instead of deleting a possibly
      // committed post asset.
      logWarn("supabase_storage.cleanup_attachment_check_failed", error, undefined, { bucket, path });
      return;
    }
    if (!attached) await deleteSupabasePdfObject(bucket, path);
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
          orderBy: { created_at: "desc" },
          take: 50,
        },
        likes: {
          where: { user_id: userId },
          select: {
            user_id: true
          },
          take: 1,
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

    if (post.post_status === "UNACTIVED" && post.author_id !== userId && userRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "โพสต์นี้ถูกซ่อนหรือระงับการเข้าใช้งานเนื่องจากขัดต่อกฎของระบบ"
      });
    }

    await restoreMissingPdfNames(post, req);

    if (Array.isArray(post.media)) {
      for (const m of post.media) {
        m.download_url = `/api/v1/posts/${post.id}/media/${m.id}/download`;
        if (!m.media_url && m.storage_provider === "SUPABASE") {
          m.media_url = m.download_url;
        }
      }
    }

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
  const startedCreatePost = performance.now();
  let stage = "validate";
  const uploadedSupabasePaths = [];
  try {
    const {
      content = "",
      post_status,
      tags,
      upload_session_id: uploadSessionId,
      idempotency_key: idempotencyKey,
      cover_asset_id: coverAssetId,
      media_asset_ids: rawMediaAssetIds,
    } = req.body || {};
    const parsedMediaAssetIds = parseJsonValue(rawMediaAssetIds);
    const mediaAssetIds = Array.isArray(parsedMediaAssetIds)
      ? parsedMediaAssetIds
      : Array.isArray(rawMediaAssetIds) ? rawMediaAssetIds : [];
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

    // ─── Upload Workspace V2 Flow ───
    const isWorkspaceV2 = Boolean(
      uploadSessionId &&
      (coverAssetId || (Array.isArray(mediaAssetIds) && mediaAssetIds.length > 0)) &&
      UPLOAD_WORKSPACE_V2_ENABLED()
    );

    if (isWorkspaceV2) {
      stage = "workspace_v2_post_create";
      const startedTx = performance.now();

      let parsedTags = tags;
      if (typeof tags === "string") {
        try {
          parsedTags = JSON.parse(tags);
        } catch {
          parsedTags = tags.split(",").map(t => t.trim()).filter(Boolean);
        }
      }
      const postTagConnects = await preparePostTags(parsedTags);

      const post = await prisma.$transaction(async transaction => {
        // 1. Lock and verify session
        const session = await transaction.uploadSession.findUnique({
          where: { id: uploadSessionId },
        });
        if (!session || session.user_id !== author_id) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
            "upload session ไม่ใช่ของผู้ใช้งาน",
            403
          );
        }
        if (session.status !== "OPEN" || session.expires_at <= new Date()) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_SESSION_EXPIRED,
            "upload session หมดอายุหรือถูกใช้แล้ว",
            410
          );
        }

        // 2. Validate assets
        const allAssetIds = [];
        if (coverAssetId) allAssetIds.push(coverAssetId);
        if (Array.isArray(mediaAssetIds)) allAssetIds.push(...mediaAssetIds);

        const uniqueSet = new Set(allAssetIds);
        if (uniqueSet.size !== allAssetIds.length) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
            "ห้ามระบุ asset ID ซ้ำกัน",
            400
          );
        }

        if (Array.isArray(mediaAssetIds) && mediaAssetIds.length > UPLOAD_WORKSPACE_LIMITS.MAX_FILES) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.TOTAL_UPLOAD_TOO_LARGE,
            `แนบไฟล์ได้สูงสุด ${UPLOAD_WORKSPACE_LIMITS.MAX_FILES} ไฟล์`,
            400
          );
        }

        const dbAssets = await transaction.uploadAsset.findMany({
          where: { id: { in: allAssetIds } },
        });

        if (dbAssets.length !== allAssetIds.length) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_ASSET_NOT_FOUND,
            "ไม่พบ asset ที่ระบุใน upload session",
            404
          );
        }

        for (const asset of dbAssets) {
          if (asset.upload_session_id !== uploadSessionId) {
            throw new UploadWorkspaceError(
              UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN,
              "Asset ไม่ได้อยู่ใน upload session เดียวกัน",
              403
            );
          }
          if (asset.status !== "VERIFIED") {
            throw new UploadWorkspaceError(
              UPLOAD_ERROR_CODES.UPLOAD_VERIFICATION_FAILED,
              `ไฟล์ ${asset.original_name || asset.id} ยังไม่ได้รับการตรวจสอบ (สถานะ: ${asset.status})`,
              400
            );
          }
        }

        const totalBytes = dbAssets.reduce((sum, a) => sum + (Number(a.file_size) || 0), 0);
        if (totalBytes > UPLOAD_WORKSPACE_LIMITS.MAX_TOTAL_BYTES) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.TOTAL_UPLOAD_TOO_LARGE,
            `ขนาดไฟล์รวมเกิน ${Math.round(UPLOAD_WORKSPACE_LIMITS.MAX_TOTAL_BYTES / (1024 * 1024))} MB`,
            400
          );
        }

        let verifiedCoverUrl = null;
        if (coverAssetId) {
          const coverAsset = dbAssets.find(a => a.id === coverAssetId);
          if (!coverAsset || coverAsset.asset_type !== "COVER" || coverAsset.provider !== "CLOUDINARY" || !coverAsset.secure_url) {
            throw new UploadWorkspaceError(
              UPLOAD_ERROR_CODES.INVALID_IMAGE,
              "ไฟล์หน้าปกไม่ถูกต้อง",
              400
            );
          }
          verifiedCoverUrl = coverAsset.secure_url;
        }

        const mediaList = (mediaAssetIds || []).map(id => dbAssets.find(a => a.id === id));
        const mediaData = mediaList.map(asset => {
          if (!asset || !["IMAGE", "PDF"].includes(asset.asset_type)) {
            throw new UploadWorkspaceError(
              UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
              "ประเภทไฟล์ประกอบไม่ถูกต้อง",
              400
            );
          }
          if (asset.provider === "SUPABASE") {
            if (asset.asset_type !== "PDF" || !asset.storage_path) {
              throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.INVALID_PDF, "ไฟล์ PDF ไม่ถูกต้อง", 400);
            }
            return {
              storage_provider: "SUPABASE",
              storage_bucket: asset.bucket || getSupabasePdfBucket(),
              storage_path: asset.storage_path,
              file_size: asset.file_size,
              original_name: asset.original_name,
              media_type: "PDF",
              media_url: null,
            };
          } else {
            if (asset.asset_type !== "IMAGE" || !asset.secure_url) {
              throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.INVALID_IMAGE, "ไฟล์รูปภาพไม่ถูกต้อง", 400);
            }
            return {
              storage_provider: "CLOUDINARY",
              media_url: asset.secure_url,
              media_type: asset.asset_type === "PDF" ? "PDF" : "IMAGE",
              original_name: asset.original_name,
              file_size: asset.file_size,
            };
          }
        });

        const finalStatus = post_status === "ACTIVE" ? "ACTIVE" : "DRAFT";
        const postId = crypto.randomUUID();

        const createdPost = await transaction.post.create({
          data: {
            id: postId,
            title,
            summary: summary || "",
            content,
            education_level,
            author_id,
            category_id: category_id || null,
            post_status: finalStatus,
            cover_image: verifiedCoverUrl,
            idempotency_key: idempotencyKey || null,
            tags: {
              create: postTagConnects,
            },
            media: {
              create: mediaData,
            },
          },
          include: POST_CREATE_INCLUDE,
        });

        if (allAssetIds.length > 0) {
          const attached = await transaction.uploadAsset.updateMany({
            where: { id: { in: allAssetIds }, status: "VERIFIED" },
            data: {
              status: "ATTACHED",
              attached_at: new Date(),
            },
          });
          if (attached.count !== allAssetIds.length) {
            throw new UploadWorkspaceError(
              UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
              "สถานะไฟล์เปลี่ยนแปลงระหว่างบันทึกโพสต์",
              409
            );
          }
        }

        const leftoverRows = await transaction.uploadAsset.findMany({
          where: {
            upload_session_id: uploadSessionId,
            id: { notIn: allAssetIds },
            status: { notIn: ["ATTACHED", "DELETED", "DELETE_PENDING"] },
          },
          select: { id: true },
        });
        const leftovers = leftoverRows.filter(asset => !allAssetIds.includes(asset.id));
        if (leftovers.length > 0) {
          await transaction.uploadAsset.updateMany({
            where: { id: { in: leftovers.map(asset => asset.id) } },
            data: { status: "DELETE_PENDING" },
          });
          for (const leftover of leftovers) {
            await enqueueJob(JOB_TYPES.CLEANUP_UPLOAD_ASSET, {
              assetId: leftover.id,
              uploadSessionId,
            }, {
              client: transaction,
              availableAt: new Date(Date.now() + 60_000),
            });
          }
        }

        const committed = await transaction.uploadSession.updateMany({
          where: {
            id: uploadSessionId,
            user_id: author_id,
            status: "OPEN",
          },
          data: {
            status: "COMMITTED",
            post_id: createdPost.id,
          },
        });

        if (committed.count !== 1) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_SESSION_EXPIRED,
            "upload session ถูกใช้แล้วหรือหมดอายุ",
            410
          );
        }

        return createdPost;
      });

      const txDuration = Math.round(performance.now() - startedTx);
      const totalDuration = Math.round(performance.now() - startedCreatePost);
      res.setHeader(
        "Server-Timing",
        `create_post_transaction;dur=${txDuration}, create_post_total;dur=${totalDuration}`
      );

      if (post.post_status === "ACTIVE") {
        platformStatsCache.clear();
        trendingPostsCache.clear();
        mostLikedPostsCache.clear();

        enqueueJob(JOB_TYPES.POST_PUBLISHED_NOTIFICATION, {
          postId: post.id,
          authorId: author_id,
          title: post.title,
        }).catch(() => {});

        enqueueJob(JOB_TYPES.POST_ACHIEVEMENT_UPDATE, {
          authorId: author_id,
          postId: post.id,
        }).catch(() => {});
      }

      return res.status(201).json({
        success: true,
        message: "โพสต์ถูกสร้างสำเร็จแล้ว",
        data: post,
      });
    }

    const coverFiles = req.files?.cover_image;
    const mediaFiles = req.files?.media_files;

    const directCover = parseJsonValue(req.body?.cover_upload);
    const directMedia = parseJsonValue(req.body?.media_uploads);
    const directPdf = parseJsonValue(req.body?.pdf_uploads || req.body?.pdf_upload);

    let allDirectMedia = [];
    if (Array.isArray(directMedia)) allDirectMedia.push(...directMedia);
    else if (directMedia) allDirectMedia.push(directMedia);
    if (Array.isArray(directPdf)) allDirectMedia.push(...directPdf);
    else if (directPdf) allDirectMedia.push(directPdf);

    let verifiedCoverUrl = null;
    let verifiedDirectMedia = [];
    let verifiedSessionAssets = null;

    if (directCover || allDirectMedia.length > 0) {
      stage = "direct_upload_verify";
      try {
        if (!idempotencyKey) {
          throw new DirectUploadValidationError("ไม่พบรหัสป้องกันการสร้างโพสต์ซ้ำ", "idempotency_key");
        }
        if (typeof uploadSessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(uploadSessionId)) {
          throw new DirectUploadValidationError("ไม่พบ upload session ที่ถูกต้อง", "upload_session_id");
        }
        const sessionAnyUser = await prisma.uploadSession.findUnique({
          where: { id: uploadSessionId },
        });
        if (!sessionAnyUser || sessionAnyUser.user_id !== author_id) {
          throw new SupabasePdfError("UPLOAD_SESSION_FORBIDDEN", "upload session ไม่ใช่ของผู้ใช้งาน", 403);
        }
        if (sessionAnyUser.status !== "PENDING" || sessionAnyUser.expires_at <= new Date()) {
          throw new SupabasePdfError("UPLOAD_SESSION_EXPIRED", "upload session หมดอายุหรือถูกใช้แล้ว", 410);
        }

        const cloudinaryMedia = [];
        const supabasePdfs = [];
        for (const asset of allDirectMedia) {
          if (String(asset?.provider || "").toUpperCase() === "SUPABASE") {
            supabasePdfs.push(asset);
          } else {
            cloudinaryMedia.push(asset);
          }
        }

        validateDirectUploadList(directCover, cloudinaryMedia);
        if (allDirectMedia.length > 15) {
          throw new DirectUploadValidationError("แนบไฟล์ได้สูงสุด 15 ไฟล์");
        }

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
        const cloudinaryAssets = [
          ...(directCover ? [{ asset: directCover, type: "cover", field: "cover_upload", isCover: true }] : []),
          ...cloudinaryMedia.map((asset, index) => ({
            asset,
            type: asset?.resource_type === "raw" || asset?.format === "pdf" ? "pdf" : "media",
            field: `media_uploads.${index}`,
            isCover: false,
          })),
        ];
        const verifiedCloudinaryAssets = await mapWithConcurrency(cloudinaryAssets, 4, async entry => {
          const verified = await verifyStoredDirectUpload(entry.asset, {
            ...verification,
            type: entry.type,
            field: entry.field,
          }, lookup);
          return { ...entry, verified };
        });
        for (const { asset, type, isCover, verified } of verifiedCloudinaryAssets) {
          totalBytes += verified.bytes;
          sessionAssets.push({ public_id: asset.public_id, type, bytes: verified.bytes });
          if (isCover) {
            verifiedCoverUrl = verified.media_url;
          } else {
            verifiedDirectMedia.push({
              storage_provider: "CLOUDINARY",
              media_url: verified.media_url,
              media_type: verified.media_type,
              original_name: normalizeOriginalFileName(asset.original_name),
            });
          }
        }
        if (supabasePdfs.length > 0) {
          const verifiedSupabase = await mapWithConcurrency(supabasePdfs, 3, async (asset) => {
            const verified = await verifyUploadedPdf(asset, {
              userId: author_id,
              sessionId: uploadSessionId,
            });
            totalBytes += verified.file_size;
            sessionAssets.push({
              provider: "SUPABASE",
              path: verified.storage_path,
              bytes: verified.file_size,
            });
            uploadedSupabasePaths.push({
              bucket: verified.storage_bucket,
              path: verified.storage_path,
            });
            return {
              storage_provider: "SUPABASE",
              storage_bucket: verified.storage_bucket,
              storage_path: verified.storage_path,
              file_size: verified.file_size,
              original_name: verified.original_name,
              media_type: "PDF",
              media_url: null,
            };
          });
          verifiedDirectMedia.push(...verifiedSupabase);
        }
        if (totalBytes > 50 * 1024 * 1024) throw new DirectUploadValidationError("ขนาดไฟล์รวมเกิน 50 MB");
        verifiedSessionAssets = sessionAssets;
      } catch (error) {
        if (uploadedSupabasePaths.length > 0) {
          await cleanupUnattachedSupabasePaths(uploadedSupabasePaths);
        }
        if (error instanceof SupabasePdfError) {
          logWarn("post.create.supabase_pdf_rejected", error, req, { stage, code: error.code });
          return res.status(error.status).json({
            success: false,
            code: error.code,
            message: error.message,
          });
        }
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
          storage_provider: "CLOUDINARY",
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

    if (Array.isArray(post.media)) {
      for (const m of post.media) {
        m.download_url = `/api/v1/posts/${post.id}/media/${m.id}/download`;
        if (!m.media_url && m.storage_provider === "SUPABASE") {
          m.media_url = m.download_url;
        }
      }
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
    if (uploadedSupabasePaths.length > 0) {
      await cleanupUnattachedSupabasePaths(uploadedSupabasePaths);
    }
    if (error instanceof UploadWorkspaceError) {
      logWarn("post.create.upload_workspace_rejected", error, req, { stage, code: error.code });
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    if (error instanceof SupabasePdfError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
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
  const uploadedSupabasePaths = [];
  try {
    const { id } = req.params;
    const {
      content,
      category_id,
      post_status,
      tags,
      remove_media_ids,
      upload_session_id: workspaceSessionId,
      cover_asset_id: workspaceCoverAssetId,
      media_asset_ids: rawWorkspaceMediaAssetIds,
    } = req.body || {};
    const parsedWorkspaceMediaAssetIds = parseJsonValue(rawWorkspaceMediaAssetIds);
    const workspaceMediaAssetIds = Array.isArray(parsedWorkspaceMediaAssetIds)
      ? parsedWorkspaceMediaAssetIds
      : Array.isArray(rawWorkspaceMediaAssetIds) ? rawWorkspaceMediaAssetIds : [];
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

    const isWorkspaceV2 = Boolean(
      UPLOAD_WORKSPACE_V2_ENABLED() &&
      workspaceSessionId &&
      (workspaceCoverAssetId || workspaceMediaAssetIds.length > 0)
    );
    let workspaceAssetIds = [];
    let workspaceMediaData = [];

    if (isWorkspaceV2) {
      if ((req.files?.cover_image?.length || 0) > 0 || (req.files?.media_files?.length || 0) > 0) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
          "ห้ามส่งไฟล์แบบเดิมพร้อมกับ upload workspace",
          400
        );
      }

      workspaceAssetIds = [
        ...(workspaceCoverAssetId ? [workspaceCoverAssetId] : []),
        ...workspaceMediaAssetIds,
      ];
      if (new Set(workspaceAssetIds).size !== workspaceAssetIds.length) {
        throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT, "ห้ามระบุ asset ID ซ้ำกัน", 400);
      }
      if (workspaceMediaAssetIds.length > UPLOAD_WORKSPACE_LIMITS.MAX_FILES) {
        throw new UploadWorkspaceError(
          UPLOAD_ERROR_CODES.TOTAL_UPLOAD_TOO_LARGE,
          `แนบไฟล์ได้สูงสุด ${UPLOAD_WORKSPACE_LIMITS.MAX_FILES} ไฟล์`,
          400
        );
      }

      const session = await prisma.uploadSession.findUnique({ where: { id: workspaceSessionId } });
      if (!session || session.user_id !== user_id) {
        throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.UPLOAD_SESSION_FORBIDDEN, "upload session ไม่ใช่ของผู้ใช้งาน", 403);
      }
      if (session.status !== "OPEN" || session.expires_at <= new Date()) {
        throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.UPLOAD_SESSION_EXPIRED, "upload session หมดอายุหรือถูกใช้แล้ว", 410);
      }

      const workspaceAssets = await prisma.uploadAsset.findMany({
        where: { id: { in: workspaceAssetIds } },
      });
      if (workspaceAssets.length !== workspaceAssetIds.length) {
        throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.UPLOAD_ASSET_NOT_FOUND, "ไม่พบ asset ที่ระบุ", 404);
      }
      for (const asset of workspaceAssets) {
        if (asset.upload_session_id !== workspaceSessionId || asset.status !== "VERIFIED") {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_VERIFICATION_FAILED,
            `ไฟล์ ${asset.original_name || asset.id} ยังไม่พร้อมใช้งาน`,
            400
          );
        }
      }
      const totalBytes = workspaceAssets.reduce((sum, asset) => sum + (Number(asset.file_size) || 0), 0);
      if (totalBytes > UPLOAD_WORKSPACE_LIMITS.MAX_TOTAL_BYTES) {
        throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.TOTAL_UPLOAD_TOO_LARGE, "ขนาดไฟล์รวมเกินกำหนด", 400);
      }

      if (workspaceCoverAssetId) {
        const coverAsset = workspaceAssets.find(asset => asset.id === workspaceCoverAssetId);
        if (!coverAsset || coverAsset.asset_type !== "COVER" || coverAsset.provider !== "CLOUDINARY" || !coverAsset.secure_url) {
          throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.INVALID_IMAGE, "ไฟล์หน้าปกไม่ถูกต้อง", 400);
        }
      }

      workspaceMediaData = workspaceMediaAssetIds.map(assetId => {
        const asset = workspaceAssets.find(candidate => candidate.id === assetId);
        if (!asset || !["IMAGE", "PDF"].includes(asset.asset_type)) {
          throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT, "ประเภทไฟล์ประกอบไม่ถูกต้อง", 400);
        }
        if (asset.provider === "SUPABASE") {
          if (asset.asset_type !== "PDF" || !asset.storage_path) {
            throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.INVALID_PDF, "ไฟล์ PDF ไม่ถูกต้อง", 400);
          }
          return {
            storage_provider: "SUPABASE",
            storage_bucket: asset.bucket || getSupabasePdfBucket(),
            storage_path: asset.storage_path,
            file_size: asset.file_size,
            original_name: asset.original_name,
            media_type: "PDF",
            media_url: null,
          };
        }
        if (asset.asset_type !== "IMAGE" || !asset.secure_url) {
          throw new UploadWorkspaceError(UPLOAD_ERROR_CODES.INVALID_IMAGE, "ไฟล์รูปภาพไม่ถูกต้อง", 400);
        }
        return {
          storage_provider: "CLOUDINARY",
          media_url: asset.secure_url,
          media_type: "IMAGE",
          original_name: asset.original_name,
          file_size: asset.file_size,
        };
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
    if (isWorkspaceV2 && workspaceCoverAssetId) {
      const coverAsset = await prisma.uploadAsset.findUnique({ where: { id: workspaceCoverAssetId } });
      updateData.cover_image = coverAsset.secure_url;
    }

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
          if (m.storage_provider === "SUPABASE" && m.storage_path) {
            await deleteSupabasePdfObject(m.storage_bucket, m.storage_path, { throwOnError: true });
          } else if (m.media_url) {
            const resourceType = m.media_type === 'PDF' ? 'raw' : (m.media_type === 'VIDEO' ? 'video' : 'image');
            await deleteFromCloudinary(m.media_url, resourceType);
          }
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

    const updateInclude = {
      author: { select: AUTHOR_FRAME_SELECT },
      category: true,
      media: true,
      tags: { include: { tag: true } },
      _count: { select: { comments: true, likes: true, bookmarks: true } },
    };

    let updatedPost;
    if (isWorkspaceV2) {
      updatedPost = await prisma.$transaction(async transaction => {
        await transaction.post.update({ where: { id }, data: updateData });

        for (const media of workspaceMediaData) {
          await transaction.postMedia.create({ data: { post_id: id, ...media } });
        }

        const attached = await transaction.uploadAsset.updateMany({
          where: { id: { in: workspaceAssetIds }, status: "VERIFIED" },
          data: { status: "ATTACHED", attached_at: new Date() },
        });
        if (attached.count !== workspaceAssetIds.length) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_ASSET_CONFLICT,
            "สถานะไฟล์เปลี่ยนแปลงระหว่างบันทึกโพสต์",
            409
          );
        }

        const leftoverRows = await transaction.uploadAsset.findMany({
          where: {
            upload_session_id: workspaceSessionId,
            id: { notIn: workspaceAssetIds },
            status: { notIn: ["ATTACHED", "DELETED", "DELETE_PENDING"] },
          },
          select: { id: true },
        });
        const leftovers = leftoverRows.filter(asset => !workspaceAssetIds.includes(asset.id));
        if (leftovers.length > 0) {
          await transaction.uploadAsset.updateMany({
            where: { id: { in: leftovers.map(asset => asset.id) } },
            data: { status: "DELETE_PENDING" },
          });
          for (const leftover of leftovers) {
            await enqueueJob(JOB_TYPES.CLEANUP_UPLOAD_ASSET, {
              assetId: leftover.id,
              uploadSessionId: workspaceSessionId,
            }, {
              client: transaction,
              availableAt: new Date(Date.now() + 60_000),
            });
          }
        }

        const committed = await transaction.uploadSession.updateMany({
          where: {
            id: workspaceSessionId,
            user_id,
            status: "OPEN",
            expires_at: { gt: new Date() },
          },
          data: { status: "COMMITTED", post_id: id },
        });
        if (committed.count !== 1) {
          throw new UploadWorkspaceError(
            UPLOAD_ERROR_CODES.UPLOAD_SESSION_EXPIRED,
            "upload session ถูกใช้แล้วหรือหมดอายุ",
            410
          );
        }

        return transaction.post.findUnique({ where: { id }, include: updateInclude });
      });

      if (workspaceCoverAssetId && post.cover_image && post.cover_image !== updatedPost.cover_image) {
        deleteFromCloudinary(post.cover_image).catch(error => {
          logWarn("post.update.old_cover_cleanup_failed", error, req, { postId: id });
        });
      }
    } else {
      updatedPost = await prisma.post.update({
        where: { id },
        data: updateData,
        include: updateInclude,
      });
    }

    // เพิ่มไฟล์แนบใหม่ (Multipart files)
    if (!isWorkspaceV2 && mediaFiles && mediaFiles.length > 0) {
      await handleMediaFiles(mediaFiles, id);
    }

    // เพิ่มไฟล์แนบใหม่ (Direct Supabase PDF uploads)
    const directMedia = parseJsonValue(req.body?.media_uploads);
    const directPdf = parseJsonValue(req.body?.pdf_uploads || req.body?.pdf_upload);
    const updateUploadedPdfs = [];
    const verifiedPdfUploads = [];
    if (Array.isArray(directMedia)) updateUploadedPdfs.push(...directMedia.filter(m => String(m?.provider || "").toUpperCase() === "SUPABASE"));
    else if (String(directMedia?.provider || "").toUpperCase() === "SUPABASE") updateUploadedPdfs.push(directMedia);
    if (Array.isArray(directPdf)) updateUploadedPdfs.push(...directPdf.filter(m => String(m?.provider || "").toUpperCase() === "SUPABASE"));
    else if (String(directPdf?.provider || "").toUpperCase() === "SUPABASE") updateUploadedPdfs.push(directPdf);

    if (!isWorkspaceV2 && updateUploadedPdfs.length > 0) {
      for (const asset of updateUploadedPdfs) {
        const sessionId = asset.upload_session_id || asset.sessionId || req.body?.upload_session_id;
        if (!sessionId) {
          throw new SupabasePdfError("UPLOAD_SESSION_FORBIDDEN", "ไม่พบ upload session สำหรับไฟล์ PDF", 403);
        }
        const session = await prisma.uploadSession.findFirst({
          where: {
            id: sessionId,
            user_id: user_id,
            status: "PENDING",
            expires_at: { gt: new Date() },
          },
        });
        if (!session) {
          const sessionAny = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
          if (!sessionAny || sessionAny.user_id !== user_id) {
            throw new SupabasePdfError("UPLOAD_SESSION_FORBIDDEN", "Upload session ไม่ใช่ของผู้ใช้งาน", 403);
          }
          throw new SupabasePdfError("UPLOAD_SESSION_EXPIRED", "Upload session หมดอายุหรือถูกใช้แล้ว", 410);
        }
        const verified = await verifyUploadedPdf(asset, {
          userId: user_id,
          sessionId,
        });
        uploadedSupabasePaths.push({
          bucket: verified.storage_bucket,
          path: verified.storage_path,
        });
        verifiedPdfUploads.push({ sessionId, verified });
      }

      const createdMedia = await prisma.$transaction(async transaction => {
        const rows = [];
        for (const { verified } of verifiedPdfUploads) {
          rows.push(await transaction.postMedia.create({
            data: {
              post_id: id,
              storage_provider: "SUPABASE",
              storage_bucket: verified.storage_bucket,
              storage_path: verified.storage_path,
              file_size: verified.file_size,
              original_name: verified.original_name,
              media_type: "PDF",
              media_url: null,
            },
          }));
        }

        for (const sessionId of new Set(verifiedPdfUploads.map(item => item.sessionId))) {
          const sessionAssets = verifiedPdfUploads
            .filter(item => item.sessionId === sessionId)
            .map(item => ({
              provider: "SUPABASE",
              path: item.verified.storage_path,
              bytes: item.verified.file_size,
            }));
          const committed = await transaction.uploadSession.updateMany({
            where: {
              id: sessionId,
              user_id,
              status: "PENDING",
              expires_at: { gt: new Date() },
            },
            data: {
              status: "COMMITTED",
              post_id: id,
              verified_assets: sessionAssets,
            },
          });
          if (committed.count !== 1) {
            throw new SupabasePdfError("UPLOAD_SESSION_EXPIRED", "Upload session หมดอายุหรือถูกใช้แล้ว", 410);
          }
        }
        return rows;
      });

      if (Array.isArray(updatedPost.media)) {
        updatedPost.media.push(...createdMedia);
      }
    }

    if (Array.isArray(updatedPost.media)) {
      for (const m of updatedPost.media) {
        m.download_url = `/api/v1/posts/${updatedPost.id}/media/${m.id}/download`;
        if (!m.media_url && m.storage_provider === "SUPABASE") {
          m.media_url = m.download_url;
        }
      }
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

    }

    // Keep post-count achievements exact when publishing or returning a post to draft.
    if ((updatedPost.post_status === "ACTIVE") !== wasActive) {
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
    if (uploadedSupabasePaths?.length > 0) {
      await cleanupUnattachedSupabasePaths(uploadedSupabasePaths);
    }
    if (error instanceof SupabasePdfError || error instanceof UploadWorkspaceError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
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
    getIO()?.to("role:admin").emit("report_reviewed", { postId: id, action: "DELETE" });

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

// ============================================================
// POST /api/v1/posts/upload-signatures/pdf
// ขอ signed upload สำหรับ Supabase Storage (Private Bucket: post-pdfs)
// ============================================================
export const getPdfUploadSignature = async (req, res) => {
  try {
    const userId = req.user.id;
    let sessionId = req.body?.upload_session_id || req.body?.sessionId || req.query?.upload_session_id;
    let sessionExpiresAt;

    if (sessionId) {
      if (typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(sessionId)) {
        return res.status(400).json({
          success: false,
          code: "INVALID_UPLOAD_SESSION",
          message: "รูปแบบ upload_session_id ไม่ถูกต้อง",
        });
      }
      const existingSession = await prisma.uploadSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
          status: "PENDING",
          expires_at: { gt: new Date() },
        },
      });
      if (!existingSession) {
        const sessionAny = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
        if (!sessionAny || sessionAny.user_id !== userId) {
          return res.status(403).json({
            success: false,
            code: "UPLOAD_SESSION_FORBIDDEN",
            message: "Upload session ไม่ใช่ของผู้ใช้งาน",
          });
        }
        return res.status(410).json({
          success: false,
          code: "UPLOAD_SESSION_EXPIRED",
          message: "Upload session หมดอายุหรือถูกใช้แล้ว",
        });
      }
      sessionExpiresAt = existingSession.expires_at;
    } else {
      sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.uploadSession.create({
        data: {
          id: sessionId,
          user_id: userId,
          requested_types: ["pdf"],
          expires_at: expiresAt,
        },
      });
      sessionExpiresAt = expiresAt;
    }

    const signedUploadData = await createSignedPdfUpload({
      userId,
      sessionId,
    });

    return res.status(200).json({
      success: true,
      data: {
        ...signedUploadData,
        expiresAt: sessionExpiresAt.toISOString(),
        sessionExpiresAt: sessionExpiresAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof SupabasePdfError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logError("controllers.getPdfUploadSignature", error, req);
    return res.status(500).json({
      success: false,
      code: "PDF_STORAGE_ERROR",
      message: "ไม่สามารถสร้าง URL สำหรับอัปโหลด PDF ได้",
    });
  }
};

// ============================================================
// GET /api/v1/posts/:postId/media/:mediaId/download
// ดาวน์โหลด PDF ด้วย signed URL อายุสั้น หรือ redirect สำหรับ Cloudinary เก่า
// ============================================================
export const downloadPostMedia = async (req, res) => {
  try {
    const postId = req.params.postId || req.params.id;
    const mediaId = req.params.mediaId;
    const userId = req.user?.id;
    let userRole = req.userRole;
    if (userId && !userRole) {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      userRole = dbUser?.role;
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        author_id: true,
        post_status: true,
      },
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        code: "POST_NOT_FOUND",
        message: "ไม่พบโพสต์",
      });
    }

    if (post.post_status === "DRAFT" && post.author_id !== userId) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "คุณไม่มีสิทธิ์เข้าถึงโพสต์ฉบับร่างนี้",
      });
    }

    if (post.post_status === "UNACTIVED" && post.author_id !== userId && userRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "โพสต์นี้ถูกระงับการใช้งาน",
      });
    }

    const media = await prisma.postMedia.findFirst({
      where: {
        id: mediaId,
        post_id: postId,
      },
    });

    if (!media) {
      return res.status(404).json({
        success: false,
        code: "MEDIA_NOT_FOUND",
        message: "ไม่พบไฟล์แนบของโพสต์นี้",
      });
    }

    let downloadUrl;
    if (media.storage_provider === "SUPABASE") {
      if (!media.storage_path) {
        return res.status(404).json({
          success: false,
          code: "PDF_OBJECT_NOT_FOUND",
          message: "ไม่พบเส้นทางไฟล์ในพื้นที่จัดเก็บ",
        });
      }
      downloadUrl = await createSignedPdfDownloadUrl(
        media.storage_bucket || getSupabasePdfBucket(),
        media.storage_path,
        300
      );
    } else {
      downloadUrl = media.media_url;
      if (!downloadUrl) {
        return res.status(404).json({
          success: false,
          code: "MEDIA_NOT_FOUND",
          message: "ไม่พบ URL ของไฟล์",
        });
      }
    }

    if (req.query?.redirect === "false" || req.headers?.accept?.includes("application/json")) {
      return res.status(200).json({
        success: true,
        data: {
          downloadUrl,
          url: downloadUrl,
          provider: media.storage_provider,
          original_name: media.original_name,
        },
      });
    }

    return res.redirect(downloadUrl);
  } catch (error) {
    if (error instanceof SupabasePdfError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logError("post.media.download_failed", error, req, { postId: req.params?.postId, mediaId: req.params?.mediaId });
    return res.status(500).json({
      success: false,
      code: "DOWNLOAD_FAILED",
      message: "ไม่สามารถดาวน์โหลดไฟล์ได้",
    });
  }
};

