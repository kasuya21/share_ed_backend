import { bearerToken } from "../utils/security.js";
import { supabase } from "../configs/supabase.config.js";
import { prisma } from "../configs/prisma.js";

export const createAuthMiddleware = ({ allowProvisioning = false } = {}) => async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Authorization header missing"
      });
    }

    const token = bearerToken(authHeader);

    if (!token) return res.status(401).json({ message: "Invalid authorization header" });

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        message: "Invalid or expired token"
      });
    }

    // Check if user is BANNED or SUSPENDED in database
    const dbUser = await prisma.user.findUnique({
      where: { id: data.user.id },
      select: { status: true, role: true }
    });

    if (!dbUser && !allowProvisioning) {
      return res.status(403).json({ message: "Complete account registration first" });
    }

    if (dbUser && (dbUser.status === "BANNED" || dbUser.status === "SUSPENDED")) {
      return res.status(403).json({
        message: "บัญชีของคุณถูกระงับการใช้งาน"
      });
    }

    req.userRole = dbUser?.role;
    req.user = data.user; // attach user

    next();

  } catch (error) {
    console.error("Auth middleware error:", error);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const authMiddleware = createAuthMiddleware();
export const provisioningAuthMiddleware = createAuthMiddleware({ allowProvisioning: true });
