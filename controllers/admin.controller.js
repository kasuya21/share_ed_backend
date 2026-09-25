import { logError } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";
import { createNotification } from "../utils/notification.helper.js";
import { userStatusCache } from "../middlewares/auth.middleware.js";

const auditContext = (req, targetUserId, action, oldValue, newValue) => ({
  actor_id: req.user.id,
  target_user_id: targetUserId,
  action,
  old_value: oldValue,
  new_value: newValue,
  request_id: req.requestId || null,
  ip_address: req.ip || req.socket?.remoteAddress || null,
});

// ดึงรายชื่อผู้ใช้ทั้งหมดในระบบ
export const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        profile_image: true,
        role: true,
        status: true,
        created_at: true,
        _count: {
          select: {
            posts: true,
            comments: true,
            reports: true
          }
        }
      },
      orderBy: {
        created_at: "desc"
      }
    });

    res.status(200).json({
      success: true,
      data: users
    });
  } catch (error) {
    logError("controllers.getAllUsers", error, req);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users"
    });
  }
};

// เปลี่ยนบทบาท (Role) ของผู้ใช้
export const changeUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body; // MEMBER, ADMIN

    if (!role || !["MEMBER", "ADMIN"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified"
      });
    }

    if (id === req.user.id) {
      return res.status(403).json({
        success: false,
        code: "SELF_ROLE_CHANGE_FORBIDDEN",
        message: "ไม่สามารถเปลี่ยนบทบาทของบัญชีตนเองได้"
      });
    }

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Prevent changing the last admin's role
    if (user.role === "ADMIN" && role !== "ADMIN") {
      const adminCount = await prisma.user.count({
        where: { role: "ADMIN" }
      });

      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: "Cannot change the role of the last admin"
        });
      }
    }

    if (user.role === role) {
      return res.status(200).json({
        success: true,
        message: "User already has this role",
        data: { id: user.id, username: user.username, email: user.email, role: user.role }
      });
    }

    const updatedUser = await prisma.$transaction(async tx => {
      const updated = await tx.user.update({
        where: { id },
        data: { role },
        select: {
          id: true,
          username: true,
          email: true,
          role: true
        }
      });
      await tx.adminSecurityAudit.create({
        data: auditContext(req, id, "ROLE_CHANGED", user.role, role)
      });
      return updated;
    });

    userStatusCache.delete(id);

    res.status(200).json({
      success: true,
      message: "User role updated successfully",
      data: updatedUser
    });
  } catch (error) {
    logError("controllers.changeUserRole", error, req);
    res.status(500).json({
      success: false,
      message: "Failed to update user role"
    });
  }
};

// แบนผู้ใช้ (เปลี่ยน status เป็น BANNED)
export const banUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.role === "ADMIN") {
      return res.status(400).json({ success: false, message: "Cannot ban an admin account" });
    }

    if (user.status === "BANNED") {
      return res.status(400).json({ success: false, message: "User is already banned" });
    }

    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { status: "BANNED" } });
      await tx.adminSecurityAudit.create({
        data: auditContext(req, id, "STATUS_CHANGED", user.status, "BANNED")
      });
    });

    userStatusCache.delete(id);

    await createNotification(
      id,
      "ACCOUNT_BANNED",
      reason || "Your account has been banned for violating community guidelines"
    );

    res.status(200).json({ success: true, message: "User banned successfully" });
  } catch (error) {
    logError("controllers.banUser", error, req);
    res.status(500).json({ success: false, message: "Failed to ban user" });
  }
};

// ยกเลิกการแบนผู้ใช้ (เปลี่ยน status กลับเป็น ACTIVE)
export const unbanUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.status !== "BANNED") {
      return res.status(400).json({ success: false, message: "User is not currently banned" });
    }

    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { status: "ACTIVE" } });
      await tx.adminSecurityAudit.create({
        data: auditContext(req, id, "STATUS_CHANGED", user.status, "ACTIVE")
      });
    });

    userStatusCache.delete(id);

    await createNotification(
      id,
      "ACCOUNT_UNBANNED",
      "Your account ban has been lifted. Welcome back!"
    );

    res.status(200).json({ success: true, message: "User unbanned successfully" });
  } catch (error) {
    logError("controllers.unbanUser", error, req);
    res.status(500).json({ success: false, message: "Failed to unban user" });
  }
};

// ระงับบัญชีผู้ใช้ (เปลี่ยน status เป็น SUSPENDED)
export const suspendUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.role === "ADMIN") {
      return res.status(400).json({ success: false, message: "Cannot suspend an admin account" });
    }

    if (user.status === "SUSPENDED") {
      return res.status(400).json({ success: false, message: "User is already suspended" });
    }

    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { status: "SUSPENDED" } });
      await tx.adminSecurityAudit.create({
        data: auditContext(req, id, "STATUS_CHANGED", user.status, "SUSPENDED")
      });
    });

    userStatusCache.delete(id);

    res.status(200).json({ success: true, message: "User suspended successfully" });
  } catch (error) {
    logError("controllers.suspendUser", error, req);
    res.status(500).json({ success: false, message: "Failed to suspend user" });
  }
};

// เปิดใช้งานบัญชีผู้ใช้ (เปลี่ยน status เป็น ACTIVE)
export const activateUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.status === "ACTIVE") {
      return res.status(400).json({ success: false, message: "User is already active" });
    }

    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { status: "ACTIVE" } });
      await tx.adminSecurityAudit.create({
        data: auditContext(req, id, "STATUS_CHANGED", user.status, "ACTIVE")
      });
    });

    userStatusCache.delete(id);

    res.status(200).json({ success: true, message: "User activated successfully" });
  } catch (error) {
    logError("controllers.activateUser", error, req);
    res.status(500).json({ success: false, message: "Failed to activate user" });
  }
};
