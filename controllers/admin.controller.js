import { prisma } from "../configs/prisma.js";

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
        coin_balance: true,
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
    console.error("Get all users error:", error);
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
    const { role } = req.body; // MEMBER, MODERATOR, ADMIN

    if (!role || !["MEMBER", "MODERATOR", "ADMIN"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified"
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

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        username: true,
        email: true,
        role: true
      }
    });

    res.status(200).json({
      success: true,
      message: "User role updated successfully",
      data: updatedUser
    });
  } catch (error) {
    console.error("Change user role error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user role"
    });
  }
};
