import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";

// ============================================================
// GET /api/v1/notifications
// ดึงการแจ้งเตือนทั้งหมดของ user ที่ login อยู่
// ============================================================
export const getMyNotifications = async (req, res) => {
  try {
    const user_id = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { user_id },
      include: {
        type: {
          select: {
            type_code: true,
            description: true
          }
        }
      },
      orderBy: { created_at: "desc" }
    });

    res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

// ============================================================
// PATCH /api/v1/notifications/:id/read
// ทำเครื่องหมายว่าอ่านแล้ว (single)
// ============================================================
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    if (notification.user_id !== user_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { is_read: true }
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("Mark as read error:", error);
    res.status(500).json({ success: false, message: "Failed to update notification" });
  }
};

// ============================================================
// PATCH /api/v1/notifications/read-all
// ทำเครื่องหมายว่าอ่านแจ้งเตือนทั้งหมดแล้ว
// ============================================================
export const markAllAsRead = async (req, res) => {
  try {
    const user_id = req.user.id;

    await prisma.notification.updateMany({
      where: { user_id, is_read: false },
      data: { is_read: true }
    });

    res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all as read error:", error);
    res.status(500).json({ success: false, message: "Failed to update notifications" });
  }
};

// ============================================================
// DELETE /api/v1/notifications/:id
// ลบการแจ้งเตือน (ของตัวเอง)
// ============================================================
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    if (notification.user_id !== user_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await prisma.notification.delete({ where: { id } });

    res.status(200).json({ success: true, message: "Notification deleted" });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};
