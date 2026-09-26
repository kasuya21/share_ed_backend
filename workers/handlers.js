import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.config.js";
import { deleteSupabasePdfObject, cleanupSupabaseUploadSession } from "../utils/supabase-storage.js";
import { createNotification } from "../utils/notification.helper.js";
import { updateAchievementProgress } from "../utils/achievement.helper.js";
import { getIO } from "../configs/socket.js";
import { logError, logWarn, logInfo } from "../utils/logger.js";
import { completeAndVerifyAssetCore } from "../utils/upload-workspace.service.js";

/**
 * Handle CLEANUP_UPLOAD_ASSET
 * Idempotently cleans up an individual asset from storage provider.
 */
export async function handleCleanupUploadAsset(payload) {
  const { assetId, uploadSessionId } = payload || {};
  if (!assetId) return;

  const asset = await prisma.uploadAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) return;

  // Never delete attached assets!
  if (asset.status === "ATTACHED") {
    logWarn("worker.cleanup_asset_aborted_attached", undefined, undefined, { assetId });
    return;
  }

  if (asset.status === "DELETED") {
    return;
  }

  // Delete from provider
  if (asset.provider === "CLOUDINARY" && asset.public_id) {
    const resourceType = asset.asset_type === "PDF" ? "raw" : "image";
    const result = await cloudinary.uploader.destroy(asset.public_id, {
      resource_type: resourceType,
      type: "upload",
    });
    if (!result || !["ok", "not found"].includes(result.result)) {
      throw new Error(`Cloudinary cleanup failed for asset ${assetId}`);
    }
  } else if (asset.provider === "SUPABASE" && asset.storage_path) {
    await deleteSupabasePdfObject(asset.bucket, asset.storage_path, { throwOnError: true });
  }

  await prisma.uploadAsset.update({
    where: { id: assetId },
    data: {
      status: "DELETED",
      updated_at: new Date(),
    },
  });
}

/**
 * Handle CLEANUP_UPLOAD_SESSION
 * Cleans up an entire expired or abandoned upload session.
 */
export async function handleCleanupUploadSession(payload) {
  const { uploadSessionId, force = false } = payload || {};
  if (!uploadSessionId) return;

  const session = await prisma.uploadSession.findUnique({
    where: { id: uploadSessionId },
    include: {
      assets: true,
    },
  });

  if (!session) return;

  // Safety checks: Never delete COMMITTED sessions or sessions with post_id
  if (session.status === "COMMITTED" || session.post_id) {
    logWarn("worker.cleanup_session_aborted_committed", undefined, undefined, { uploadSessionId });
    return;
  }

  // If not force, verify 24h grace period has elapsed
  if (!force) {
    const gracePeriodMs = 24 * 60 * 60 * 1000;
    const expiryThreshold = new Date(Date.now() - gracePeriodMs);
    if (session.expires_at > expiryThreshold && session.last_activity_at > expiryThreshold) {
      logInfo("worker.cleanup_session_within_grace_period", undefined, { uploadSessionId });
      return;
    }
  }

  // Check if any asset is attached
  const hasAttached = session.assets.some(a => a.status === "ATTACHED");
  if (hasAttached) {
    logWarn("worker.cleanup_session_aborted_has_attached_assets", undefined, undefined, { uploadSessionId });
    return;
  }

  // Mark status as CLEANING
  await prisma.uploadSession.update({
    where: { id: uploadSessionId },
    data: { status: "CLEANING" },
  });

  // 1. Delete each asset
  for (const asset of session.assets) {
    await handleCleanupUploadAsset({ assetId: asset.id, uploadSessionId });
  }

  // 2. Clean Cloudinary session folder
  const cloudinaryPrefix = `share-ed/users/${session.user_id}/upload-sessions/${session.id}`;
  await Promise.all([
    cloudinary.api.delete_resources_by_prefix(cloudinaryPrefix, { resource_type: "image", type: "upload" }),
    cloudinary.api.delete_resources_by_prefix(cloudinaryPrefix, { resource_type: "raw", type: "upload" }),
  ]);

  for (const folder of ["covers", "media", "content", "pdfs"]) {
    await cloudinary.api.delete_folder(`${cloudinaryPrefix}/${folder}`).catch(() => {});
  }
  await cloudinary.api.delete_folder(cloudinaryPrefix).catch(() => {});

  // 3. Clean Supabase session folder
  await cleanupSupabaseUploadSession(session.user_id, session.id);

  // 4. Mark session CLEANED
  await prisma.uploadSession.update({
    where: { id: uploadSessionId },
    data: {
      status: "CLEANED",
      updated_at: new Date(),
    },
  });
}

/**
 * Handle POST_PUBLISHED_NOTIFICATION
 * Broadcasts notifications to followers asynchronously
 */
export async function handlePostPublishedNotification(payload) {
  const { postId, authorId, title } = payload || {};
  if (!postId || !authorId) return;

  try {
    const followers = await prisma.follow.findMany({
      where: { following_id: authorId },
      select: { follower_id: true },
    });

    if (followers.length === 0) return;

    const io = getIO();
    const notifications = followers.map(f => ({
      user_id: f.follower_id,
      actor_id: authorId,
      type: "NEW_POST",
      message: `ได้เผยแพร่โพสต์ใหม่: ${title || ""}`,
      post_id: postId,
    }));

    // Batch create notifications
    await prisma.notification.createMany({
      data: notifications,
    });

    // Realtime broadcast via Socket
    if (io) {
      for (const f of followers) {
        io.to(`user:${f.follower_id}`).emit("notification", {
          type: "NEW_POST",
          message: `ได้เผยแพร่โพสต์ใหม่: ${title || ""}`,
          postId,
          actorId: authorId,
        });
      }
    }
  } catch (err) {
    logError("worker.post_published_notification_error", err, undefined, { postId, authorId });
    throw err;
  }
}

/**
 * Handle POST_ACHIEVEMENT_UPDATE
 * Updates author achievement progress asynchronously
 */
export async function handlePostAchievementUpdate(payload) {
  const { authorId, postId } = payload || {};
  if (!authorId) return;

  try {
    const postCount = await prisma.post.count({
      where: { author_id: authorId, post_status: "ACTIVE" },
    });
    await updateAchievementProgress(authorId, "POSTS_CREATED", postCount);
  } catch (err) {
    logError("worker.post_achievement_update_error", err, undefined, { authorId, postId });
    throw err;
  }
}

/**
 * Handle VERIFY_UPLOAD_ASSET
 */
export async function handleVerifyUploadAsset(payload) {
  const { userId, sessionId, assetId, clientPayload } = payload || {};
  if (!assetId || !sessionId) return;
  await completeAndVerifyAssetCore({ userId, sessionId, assetId, clientPayload });
}
