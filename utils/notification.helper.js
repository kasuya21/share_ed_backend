import { prisma } from '../configs/prisma.js';
import { getIO } from '../configs/socket.js';

// ============================================================
// NOTIFICATION HELPER — ใช้ร่วมกันได้ทุก controller
// ============================================================

/**
 * สร้าง notification record และส่ง real-time ผ่าน Socket.IO
 * @param {string} userId   - ผู้รับการแจ้งเตือน
 * @param {string} type     - LIKE | COMMENT | FOLLOW | NEW_POST | BOOKMARK | SYSTEM
 * @param {string} message  - ข้อความแจ้งเตือน
 * @param {string|null} postId - post ที่เกี่ยวข้อง (ถ้ามี)
 */
export const createNotification = async (userId, type, message, postId = null) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        user_id: userId,
        type,
        message,
        post_id: postId,
        is_read: false,
      },
    });

    // ส่ง real-time ให้ client ผ่าน Socket.IO
    try {
      const io = getIO();
      if (io) {
        const payload = {
          id: notification.id,
          type: notification.type,
          title: labelFromType(type),
          message: notification.message,
          isRead: false,
          link: postId ? `/post/${postId}` : null,
          createdAt: notification.created_at,
        };
        io.to(`user:${userId}`).emit('new_notification', payload);
      }
    } catch (socketErr) {
      // Socket error ไม่ควรทำให้ request หลักพัง
      console.warn('[Socket] Failed to emit notification:', socketErr.message);
    }

    return notification;
  } catch (error) {
    console.error('[Notification] Failed to create notification:', error);
  }
};

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
