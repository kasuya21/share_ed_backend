import { prisma } from "../configs/prisma.js";
import { getIO } from "../configs/socket.js";
import { logError, logWarn } from "./logger.js";

const actorSelect = { id: true, username: true, profile_image: true };

export function labelFromType(type) {
  const labels = {
    LIKE: "มีคนถูกใจโพสต์ของคุณ",
    NEW_LIKE: "มีคนถูกใจโพสต์ของคุณ",
    NEW_COMMENT: "ความคิดเห็นใหม่",
    NEW_FOLLOWER: "มีคนติดตามคุณ",
    NEW_POST: "โพสต์ใหม่จากคนที่คุณติดตาม",
    BOOKMARK_REMOVED: "อัปเดตบุ๊กมาร์ก",
    ACHIEVEMENT_COMPLETED: "ความสำเร็จใหม่",
    POST_SUSPENDED: "โพสต์ถูกระงับ",
    POST_RESTORED: "โพสต์ถูกคืนสถานะ",
    POST_REMOVED: "โพสต์ถูกลบ",
    POST_REPORTED: "มีรายงานโพสต์",
    ACCOUNT_BANNED: "บัญชีถูกระงับ",
    ACCOUNT_UNBANNED: "บัญชีกลับมาใช้งานได้",
  };
  return labels[type] || "การแจ้งเตือน";
}

export function formatNotification(notification) {
  const link = notification.post_id
    ? `/post/${notification.post_id}`
    : notification.type === "NEW_FOLLOWER" && notification.actor_id
      ? `/profile/${notification.actor_id}`
      : null;
  return {
    id: notification.id,
    type: notification.type,
    recipientId: notification.user_id,
    actorId: notification.actor_id ?? null,
    postId: notification.post_id ?? null,
    title: labelFromType(notification.type),
    message: notification.message,
    isRead: notification.is_read,
    createdAt: notification.created_at,
    link,
    actor: notification.actor ? {
      id: notification.actor.id,
      username: notification.actor.username,
      avatarUrl: notification.actor.profile_image,
    } : null,
  };
}

function emitToRecipient(recipientId, event, payload) {
  try {
    const io = getIO();
    if (io) io.to(`user:${recipientId}`).emit(event, payload);
  } catch (error) {
    logWarn("notification.socket.emit_failed", error, undefined, {
      recipientId,
      actorId: payload.actorId,
      postId: payload.postId,
      notificationType: payload.type,
      socketEvent: event,
    });
  }
}

export const createNotification = async (userId, type, message, postId = null, actorId = null) => {
  try {
    const notification = await prisma.notification.create({
      data: { user_id: userId, type, message, post_id: postId, actor_id: actorId, is_read: false },
    });
    emitToRecipient(userId, "new_notification", formatNotification(notification));
    return notification;
  } catch (error) {
    logError("notification.create_failed", error, undefined, {
      recipientId: userId, actorId, notificationType: type, postId,
    });
    return null;
  }
};

export const createLikeNotification = async ({ recipientId, actorId, postId }) => {
  if (recipientId === actorId) return null;
  try {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: actorSelect });
    if (!actor) {
      logWarn("notification.like_actor_missing", undefined, undefined, { recipientId, actorId, postId });
      return null;
    }

    let notification;
    try {
      notification = await prisma.notification.create({
        data: {
          user_id: recipientId,
          actor_id: actorId,
          post_id: postId,
          type: "LIKE",
          message: `${actor.username} ถูกใจโพสต์ของคุณ`,
          is_read: false,
        },
        include: { actor: { select: actorSelect } },
      });
    } catch (error) {
      if (error?.code === "P2002") {
        return prisma.notification.findFirst({
          where: { user_id: recipientId, actor_id: actorId, post_id: postId, type: "LIKE" },
          include: { actor: { select: actorSelect } },
        });
      }
      throw error;
    }

    emitToRecipient(recipientId, "new_notification", formatNotification(notification));
    return notification;
  } catch (error) {
    logError("notification.like_create_failed", error, undefined, { recipientId, actorId, postId });
    return null;
  }
};

export const removeLikeNotification = async ({ recipientId, actorId, postId }) => {
  if (recipientId === actorId) return null;
  try {
    const notification = await prisma.notification.findFirst({
      where: { user_id: recipientId, actor_id: actorId, post_id: postId, type: "LIKE" },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });
    if (!notification) return null;

    await prisma.notification.deleteMany({
      where: { user_id: recipientId, actor_id: actorId, post_id: postId, type: "LIKE" },
    });
    const payload = {
      notificationId: notification.id,
      type: "LIKE",
      recipientId,
      actorId,
      postId,
      reason: "UNLIKE",
      occurredAt: new Date().toISOString(),
    };
    emitToRecipient(recipientId, "notification_removed", payload);
    return payload;
  } catch (error) {
    logError("notification.like_remove_failed", error, undefined, { recipientId, actorId, postId });
    return null;
  }
};
