import { prisma } from "../configs/prisma.js";

// ============================================================
// NOTIFICATION HELPER — ใช้ร่วมกันได้ทุก controller
// ============================================================

/**
 * สร้าง notification record
 * @param {string} userId     - ผู้รับการแจ้งเตือน
 * @param {string} typeCode   - รหัส NotificationType (string ตรงกับ type_code ใน DB)
 * @param {string} message    - ข้อความ
 */
export const createNotification = async (userId, typeCode, message) => {
  try {
    // Lookup type id by type_code
    const notifType = await prisma.notificationType.findFirst({
      where: { type_code: typeCode }
    });

    if (!notifType) {
      console.warn(`[Notification] NotificationType not found for code: ${typeCode}`);
      return;
    }

    await prisma.notification.create({
      data: {
        user_id: userId,
        type_id: notifType.id,
        message
      }
    });
  } catch (error) {
    // Fire-and-forget: ไม่ throw เพื่อไม่กระทบ main flow
    console.error("[Notification] Failed to create notification:", error);
  }
};
