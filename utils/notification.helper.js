import { prisma } from "../configs/prisma.js";

// ============================================================
// NOTIFICATION HELPER — ใช้ร่วมกันได้ทุก controller
// ============================================================

/**
 * สร้าง notification record
 * @param {string} userId    - ผู้รับการแจ้งเตือน
 * @param {string} typeCode  - enum NotificationTypeCode (NEW_FOLLOWER | NEW_LIKE | NEW_COMMENT | QUEST_COMPLETED)
 * @param {string} message   - ข้อความแจ้งเตือน
 */
export const createNotification = async (userId, typeCode, message) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        user_id: userId,
        type: typeCode,
        message
      }
    });

    // 🚀 ส่ง Notification ผ่าน WebSocket แบบ Real-time
    import("../index.js").then(({ io }) => {
      if (io) {
        io.to(userId).emit("new_notification", notification);
      }
    }).catch(err => console.error("[Socket] Failed to emit notification:", err));

  } catch (error) {
    // Fire-and-forget: ไม่ throw เพื่อไม่กระทบ main flow
    console.error("[Notification] Failed to create notification:", error);
  }
};
