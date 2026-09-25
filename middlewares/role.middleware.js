import { logError, logWarn } from "../utils/logger.js";
import { prisma } from "../configs/prisma.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const ADMIN_SESSION_IDLE_SECONDS = 2 * 60 * 60;

async function hasFreshAdminSession(req) {
  const sessionId = req.user?.session_id;
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) return false;

  const rows = await prisma.$queryRaw`
    SELECT
      EXTRACT(EPOCH FROM "created_at")::float8 AS "created_at_epoch",
      EXTRACT(EPOCH FROM "refreshed_at" AT TIME ZONE 'UTC')::float8 AS "refreshed_at_epoch",
      EXTRACT(EPOCH FROM "not_after")::float8 AS "not_after_epoch"
    FROM auth.sessions
    WHERE "id" = CAST(${sessionId} AS uuid)
      AND "user_id" = CAST(${req.user.id} AS uuid)
    LIMIT 1
  `;
  const session = rows[0];
  if (!session) return false;

  const now = Date.now() / 1000;
  const createdAt = Number(session.created_at_epoch);
  const refreshedAt = Number(session.refreshed_at_epoch || session.created_at_epoch);
  const notAfter = session.not_after_epoch == null ? null : Number(session.not_after_epoch);
  return Number.isFinite(createdAt)
    && Number.isFinite(refreshedAt)
    && now - createdAt <= ADMIN_SESSION_MAX_AGE_SECONDS
    && now - refreshedAt <= ADMIN_SESSION_IDLE_SECONDS
    && (notAfter === null || notAfter > now);
}

export const isAdmin = async (req, res, next) => {
  try {
    const user_id = req.user.id;
    const dbUser = await prisma.user.findUnique({
      where: { id: user_id },
      select: { role: true }
    });

    if (!dbUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (dbUser.role !== "ADMIN") {
      return res.status(403).json({ message: "Forbidden: Requires Admin role" });
    }

    if (!(await hasFreshAdminSession(req))) {
      logWarn("admin.session.reauthentication_required", undefined, req);
      return res.status(401).json({
        success: false,
        code: "ADMIN_REAUTHENTICATION_REQUIRED",
        message: "เซสชันผู้ดูแลหมดอายุ กรุณาเข้าสู่ระบบและยืนยันตัวตนอีกครั้ง"
      });
    }

    req.userRole = dbUser.role;
    next();
  } catch (error) {
    logError("middlewares.isAdmin", error, req);
    return res.status(500).json({ message: "Internal server error" });
  }
};
