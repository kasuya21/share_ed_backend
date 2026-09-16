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
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
      include: {
        actor: { select: { id: true, username: true, profile_image: true } },
      },
    });

    const formatted = notifications.map(formatNotification);

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
