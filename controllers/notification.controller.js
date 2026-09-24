import { logError, logWarn } from "../utils/logger.js";
import { prisma } from '../configs/prisma.js';
import { formatNotification } from '../utils/notification.helper.js';

// ============================================================
// GET /api/v1/notifications — ดึงการแจ้งเตือนของ user ที่ login อยู่
// ============================================================
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    let notifications = [];
    try {
      notifications = await prisma.notification.findMany({
        where: {
          user_id: userId,
          type: { not: "BOOKMARK_REMOVED" }
        },
        orderBy: { created_at: 'desc' },
        take: 50,
        include: {
          actor: { select: { id: true, username: true, profile_image: true } },
        },
      });
    } catch (dbError) {
      logWarn("controllers.getNotifications.prisma_find_failed", dbError, req);
      // Fallback: Query raw SQL to safely bypass any Prisma enum deserialization failures
      try {
        const rawNotifications = await prisma.$queryRawUnsafe(`
          SELECT 
            n.notification_id AS id,
            n.user_id,
            n.type::text AS type,
            n.message,
            n.post_id,
            n.actor_id,
            n.is_read,
            n.created_at,
            u.user_id AS actor_user_id,
            u.username AS actor_username,
            u.profile_image AS actor_profile_image
          FROM notifications n
          LEFT JOIN users u ON n.actor_id = u.user_id
          WHERE n.user_id = $1 AND n.type::text != 'BOOKMARK_REMOVED'
          ORDER BY n.created_at DESC
          LIMIT 50
        `, userId);

        notifications = (rawNotifications || []).map((row) => ({
          id: row.id,
          user_id: row.user_id,
          type: row.type,
          message: row.message,
          post_id: row.post_id,
          actor_id: row.actor_id,
          is_read: row.is_read,
          created_at: row.created_at,
          actor: row.actor_user_id ? {
            id: row.actor_user_id,
            username: row.actor_username,
            profile_image: row.actor_profile_image,
          } : null,
        }));
      } catch (rawError) {
        logError("controllers.getNotifications.raw_query_failed", rawError, req);
        return res.status(200).json({ success: true, data: [] });
      }
    }

    // Notifications created before post_id was stored still contain the post
    // title in their message. Resolve only unambiguous posts owned by the
    // recipient so older suspension notices can open the correct post.
    try {
      const missingPostIds = notifications.filter((notification) =>
        notification.type === "POST_SUSPENDED" && !notification.post_id
      );
      const titleByNotification = new Map(missingPostIds.map((notification) => [
        notification.id,
        notification.message?.match(/โพสต์\s*[“"](.+?)[”"]/)?.[1] || null,
      ]));
      const titles = [...new Set([...titleByNotification.values()].filter(Boolean))];
      const matchingPosts = titles.length > 0
        ? await prisma.post.findMany({
          where: { author_id: userId, title: { in: titles }, post_status: "UNACTIVED" },
          select: { id: true, title: true },
        })
        : [];
      const postsByTitle = new Map();
      for (const post of matchingPosts) {
        const matches = postsByTitle.get(post.title) || [];
        matches.push(post.id);
        postsByTitle.set(post.title, matches);
      }
      const formatted = notifications.map((notification) => {
        const title = titleByNotification.get(notification.id);
        const postIds = title ? postsByTitle.get(title) : null;
        return formatNotification(postIds?.length === 1
          ? { ...notification, post_id: postIds[0] }
          : notification);
      });

      return res.status(200).json({ success: true, data: formatted });
    } catch (formatError) {
      logWarn("controllers.getNotifications.format_failed", formatError, req);
      const simpleFormatted = notifications.map((n) => {
        try {
          return formatNotification(n);
        } catch {
          return {
            id: n?.id || "unknown",
            type: n?.type || "SYSTEM",
            title: "การแจ้งเตือน",
            message: n?.message || "",
            isRead: Boolean(n?.is_read),
            createdAt: n?.created_at || new Date().toISOString(),
            link: n?.post_id ? `/post/${n.post_id}` : null,
          };
        }
      });
      return res.status(200).json({ success: true, data: simpleFormatted });
    }
  } catch (error) {
    logError("controllers.getNotifications", error, req);
    res.status(200).json({ success: true, data: [] });
  }
};

// ============================================================
// PATCH /api/v1/notifications/:id/read — อ่านรายการเดียว
// ============================================================
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { id, user_id: userId },
      data: { is_read: true },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logError("controllers.markAsRead", error, req);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
  }
};

// ============================================================
// PATCH /api/v1/notifications/read-all — อ่านทั้งหมด
// ============================================================
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    await prisma.notification.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
    res.status(200).json({ success: true });
  } catch (error) {
    logError("controllers.markAllAsRead", error, req);
    res.status(500).json({ success: false, message: 'Failed to mark all as read' });
  }
};

// ============================================================
// DELETE /api/v1/notifications/:id — ลบรายการเดียว
// ============================================================
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await prisma.notification.deleteMany({
      where: { id, user_id: userId },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logError("controllers.deleteNotification", error, req);
    res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
};
