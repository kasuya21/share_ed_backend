import { prisma } from '../configs/prisma.js';

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
    });

    const formatted = notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: labelFromType(n.type),
      message: n.message,
      isRead: n.is_read,
      link: n.post_id ? `/post/${n.post_id}` : null,
      createdAt: n.created_at,
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Get notifications error:', error);
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
    console.error('Mark as read error:', error);
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
    console.error('Mark all as read error:', error);
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
    console.error('Delete notification error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
};

// Helper: แปลง type → ชื่อภาษาไทย
function labelFromType(type) {
  const map = {
    LIKE:     'มีคนถูกใจโพสต์ของคุณ',
    COMMENT:  'ความคิดเห็นใหม่',
    FOLLOW:   'มีคนติดตามคุณ',
    NEW_POST: 'โพสต์ใหม่จากคนที่คุณติดตาม',
    BOOKMARK: 'มีคนบุ๊กมาร์กโพสต์ของคุณ',
    SYSTEM:   'การแจ้งเตือนจากระบบ',
  };
  return map[type] || 'การแจ้งเตือน';
}
