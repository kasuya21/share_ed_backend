import { logError } from "../utils/logger.js";
import { prisma } from '../configs/prisma.js';
import { formatNotification } from '../utils/notification.helper.js';

// ============================================================
// GET /api/v1/notifications — ดึงการแจ้งเตือนของ user ที่ login อยู่
// ============================================================
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const notifications = await prisma.notification.findMany({
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

    // Notifications created before post_id was stored still contain the post
    // title in their message. Resolve only unambiguous posts owned by the
    // recipient so older suspension notices can open the correct post.
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

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    logError("controllers.getNotifications", error, req);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
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
