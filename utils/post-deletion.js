import cloudinary from "../configs/cloudinary.config.js";
import { prisma } from "../configs/prisma.js";
import { extractPublicId } from "./cloudinary.helper.js";
import { logWarn } from "./logger.js";

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
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      author_id: true,
      title: true,
      cover_image: true,
      content: true,
      media: { select: { media_url: true, media_type: true } },
    },
  });
  if (!post) return null;

  if (post.cover_image) await destroyAsset(post.cover_image, "image", postId);

  for (const media of post.media) {
    const resourceType = media.media_type === "PDF"
      ? "raw"
      : media.media_type === "VIDEO" ? "video" : "image";
    await destroyAsset(media.media_url, resourceType, postId);
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

  for (const folder of ["pdfs", "media"]) {
    await cloudinary.api.delete_folder(`share-ed/posts/${postId}/${folder}`).catch((error) =>
      logWarn("post.folder.delete_failed", error, undefined, { postId, folder })
    );
  }
  await cloudinary.api.delete_folder(`share-ed/posts/${postId}`).catch((error) =>
    logWarn("post.folder.delete_failed", error, undefined, { postId, folder: "post" })
  );

  await prisma.post.delete({ where: { id: postId } });
  return post;
}
