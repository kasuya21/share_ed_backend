import cloudinary from "../configs/cloudinary.config.js";
import { prisma } from "../configs/prisma.js";
import { extractPublicId } from "./cloudinary.helper.js";
import { deleteSupabasePdfObject } from "./supabase-storage.js";
import { logWarn } from "./logger.js";
import { updateAchievementProgress } from "./achievement.helper.js";

async function destroyAsset(url, resourceType, postId) {
  const publicId = extractPublicId(url, resourceType);
  if (!publicId) return;

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
  if (!["ok", "not found"].includes(result?.result)) {
    throw new Error(`Cloudinary deletion failed for post ${postId}`);
  }
}

export async function deletePostPermanently(postId) {
  const [post, affectedLikes, affectedComments] = await Promise.all([
    prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        author_id: true,
        title: true,
        cover_image: true,
        content: true,
        media: {
          select: {
            id: true,
            media_url: true,
            media_type: true,
            storage_provider: true,
            storage_bucket: true,
            storage_path: true,
          },
        },
      },
    }),
    prisma.like.findMany({
      where: { post_id: postId },
      select: { user_id: true },
      distinct: ["user_id"],
    }),
    prisma.comment.findMany({
      where: { post_id: postId },
      select: { user_id: true },
      distinct: ["user_id"],
    }),
  ]);
  if (!post) return null;

  if (post.cover_image) await destroyAsset(post.cover_image, "image", postId);

  for (const media of post.media) {
    if (media.storage_provider === "SUPABASE" && media.storage_path) {
      await deleteSupabasePdfObject(media.storage_bucket, media.storage_path, { throwOnError: true });
    } else if (media.media_url) {
      const resourceType = media.media_type === "PDF"
        ? "raw"
        : media.media_type === "VIDEO" ? "video" : "image";
      await destroyAsset(media.media_url, resourceType, postId);
    }
  }

  const ownedContentFolder = `share-ed/users/${post.author_id}/posts/content/`;
  const inlineUrls = [...new Set(
    [...String(post.content || "").matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => match[1])
  )];
  for (const url of inlineUrls) {
    const publicId = extractPublicId(url, "image");
    if (!publicId?.startsWith(ownedContentFolder)) continue;
    const usedElsewhere = await prisma.post.count({
      where: { id: { not: postId }, content: { contains: url } },
    });
    if (!usedElsewhere) await destroyAsset(url, "image", postId);
  }

  const hasCloudinaryAssets = Boolean(
    post.cover_image ||
    inlineUrls.length > 0 ||
    post.media.some((m) => m.storage_provider === "CLOUDINARY")
  );

  if (hasCloudinaryAssets) {
    for (const folder of ["pdfs", "media"]) {
      try {
        await cloudinary.api.delete_folder(`share-ed/posts/${postId}/${folder}`);
      } catch (error) {
        logWarn("post.folder.delete_failed", error, undefined, { postId, folder });
      }
    }
    try {
      await cloudinary.api.delete_folder(`share-ed/posts/${postId}`);
    } catch (error) {
      logWarn("post.folder.delete_failed", error, undefined, { postId, folder: "post" });
    }
  }

  await prisma.post.delete({ where: { id: postId } });

  const [totalActivePosts, totalPostLikes] = await Promise.all([
    prisma.post.count({ where: { author_id: post.author_id, post_status: "ACTIVE" } }),
    prisma.like.count({ where: { post: { author_id: post.author_id } } }),
  ]);
  await Promise.all([
    updateAchievementProgress(post.author_id, "POSTS_CREATED", totalActivePosts),
    updateAchievementProgress(post.author_id, "POST_LIKES", totalPostLikes),
    ...affectedLikes.map(async ({ user_id }) => {
      const totalLikesGiven = await prisma.like.count({ where: { user_id } });
      await updateAchievementProgress(user_id, "LIKES_GIVEN", totalLikesGiven);
    }),
    ...affectedComments.map(async ({ user_id }) => {
      const totalComments = await prisma.comment.count({ where: { user_id } });
      await updateAchievementProgress(user_id, "COMMENTS_CREATED", totalComments);
    }),
  ]);

  return post;
}
