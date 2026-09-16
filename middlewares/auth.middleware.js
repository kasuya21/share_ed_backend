import { logError, logWarn } from "../utils/logger.js";
import { bearerToken } from "../utils/security.js";
import { supabase } from "../configs/supabase.config.js";
import { prisma } from "../configs/prisma.js";
import { verifyAccessToken } from "../utils/auth-token.js";
import { MemoryCache } from "../utils/cache.helper.js";

// Cache user status & role for 30s to avoid repeated DB hits on every request
export const userStatusCache = new MemoryCache(30 * 1000);

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

    const { user, error } = await verifyAccessToken(supabase, token);

    if (error || !user) {
      logWarn("auth.token.provider_rejected", error, req);
      return res.status(401).json({
        message: "Invalid or expired token"
      });
    }

    // Check if user is BANNED or SUSPENDED in database (using fast memory cache)
    let dbUser = userStatusCache.get(user.id);
    if (!dbUser) {
      dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { status: true, role: true }
      });
      if (dbUser) {
        userStatusCache.set(user.id, dbUser);
      }
    }

    if (!dbUser && !allowProvisioning) {
      return res.status(403).json({ message: "Complete account registration first" });
    }

    if (dbUser && (dbUser.status === "BANNED" || dbUser.status === "SUSPENDED")) {
      return res.status(403).json({
        message: "บัญชีของคุณถูกระงับการใช้งาน"
      });
    }

    req.userRole = dbUser?.role;
    req.user = user;

    next();

  } catch (error) {
    logError("middlewares.createAuthMiddleware", error, req);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const authMiddleware = createAuthMiddleware();
export const provisioningAuthMiddleware = createAuthMiddleware({ allowProvisioning: true });
