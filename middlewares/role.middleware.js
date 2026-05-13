import { prisma } from "../configs/prisma.js";

export const isModeratorOrAdmin = async (req, res, next) => {
  try {
    const user_id = req.user.id;
    const dbUser = await prisma.user.findUnique({
      where: { id: user_id },
      select: { role: true }
    });

    if (!dbUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (dbUser.role !== "MODERATOR" && dbUser.role !== "ADMIN") {
      return res.status(403).json({ message: "Forbidden: Requires Moderator or Admin role" });
    }

    req.userRole = dbUser.role;
    next();
  } catch (error) {
    console.error("Role middleware error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
