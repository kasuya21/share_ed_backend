import { prisma } from "../configs/prisma.js";
import { logWarn } from "./logger.js";
import { UPLOAD_RATE_LIMITS, UPLOAD_ERROR_CODES } from "../configs/upload-workspace.constants.js";

/**
 * Base Store Interface
 */
export class RateLimitStore {
  async consume(key, options) {
    throw new Error("consume() not implemented");
  }
  async refund(key) {}
}

/**
 * In-Memory Token Bucket Store
 */
export class MemoryTokenBucketStore extends RateLimitStore {
  constructor() {
    super();
    this.buckets = new Map();
  }

  async consume(key, { limit, burst, windowMs, now = Date.now() }) {
    const refillRatePerMs = limit / windowMs; // tokens per ms
    const capacity = burst || limit;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.lastRefill);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRatePerMs);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterSeconds: 0,
      };
    }

    const missingTokens = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(missingTokens / refillRatePerMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  async refund(key) {
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.tokens = Math.min(100, bucket.tokens + 1);
    }
  }

  clear() {
    this.buckets.clear();
  }
}

let redisWarningLogged = false;

/**
 * Database Safety Fallback Store
 * Used when Redis is not configured in production/multi-instance setups.
 */
export class DatabaseSafetyFallbackStore extends RateLimitStore {
  constructor(memoryFallback = new MemoryTokenBucketStore()) {
    super();
    this.memoryFallback = memoryFallback;
  }

  async consume(key, options) {
    if (!redisWarningLogged && process.env.NODE_ENV === "production") {
      logWarn("rate_limit.redis_not_configured_database_fallback", undefined, undefined, {
        message: "Redis is not configured. Falling back to database count and in-memory token bucket.",
      });
      redisWarningLogged = true;
    }

    // First check memory bucket for burst protection
    const memResult = await this.memoryFallback.consume(key, options);
    if (!memResult.allowed) return memResult;

    // Next perform safety verification against database counts if user key
    if (key.startsWith("user:session:")) {
      const userId = key.replace("user:session:", "");
      const oneHourAgo = new Date(Date.now() - options.windowMs);
      try {
        const count = await prisma.uploadSession.count({
          where: {
            user_id: userId,
            created_at: { gte: oneHourAgo },
          },
        });
        if (count >= options.limit + (options.burst || 0)) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: 60,
          };
        }
      } catch (err) {
        // Fail-open on DB error so transient DB issue doesn't lock users out
      }
    }

    return memResult;
  }

  async refund(key) {
    return this.memoryFallback.refund(key);
  }
}

// Global default store instance
export const defaultRateLimitStore = new DatabaseSafetyFallbackStore();

/**
 * Express middleware for upload workspace rate limiting
 */
export function uploadRateLimit({
  type = "SESSION", // 'SESSION' | 'FILE_SIGN'
  store = defaultRateLimitStore,
} = {}) {
  const config = type === "SESSION" ? UPLOAD_RATE_LIMITS.SESSION : UPLOAD_RATE_LIMITS.FILE_SIGN;

  return async (req, res, next) => {
    const userId = req.user?.id;
    const ip = req.ip || req.socket?.remoteAddress || "unknown_ip";

    // Check idempotent retry to avoid consuming quota
    if (type === "SESSION") {
      const draftId = req.body?.draft_id || req.headers["idempotency-key"];
      if (userId && draftId) {
        try {
          const existing = await prisma.uploadSession.findFirst({
            where: {
              user_id: userId,
              draft_id: String(draftId),
              status: "OPEN",
              expires_at: { gt: new Date() },
            },
            select: { id: true },
          });
          if (existing) {
            // Idempotent retry: do not consume rate limit quota!
            return next();
          }
        } catch {
          // If query fails, continue to rate limit check
        }
      }
    } else if (type === "FILE_SIGN") {
      const sessionId = req.params?.sessionId;
      const clientFileId = req.body?.client_file_id;
      if (sessionId && clientFileId) {
        try {
          const existing = await prisma.uploadAsset.findFirst({
            where: {
              upload_session_id: sessionId,
              client_file_id: String(clientFileId),
            },
            select: { id: true },
          });
          if (existing) {
            // Idempotent retry: do not consume rate limit quota!
            return next();
          }
        } catch {
          // If query fails, continue to rate limit check
        }
      }
    }

    const userKey = userId ? `user:${type.toLowerCase()}:${userId}` : `ip:${type.toLowerCase()}:${ip}`;
    const ipKey = `ip:${type.toLowerCase()}:${ip}`;

    // Account limit check
    const userResult = await store.consume(userKey, {
      limit: config.MAX_REQUESTS,
      burst: config.BURST,
      windowMs: config.WINDOW_MS,
    });

    if (!userResult.allowed) {
      res.setHeader("Retry-After", String(userResult.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: UPLOAD_ERROR_CODES.RATE_LIMITED,
        message: "คำขอเกินขีดจำกัด กรุณารอสักครู่แล้วลองใหม่อีกครั้ง",
      });
    }

    // IP limit is 10x higher to protect against distributed abusive accounts from single IP
    const ipResult = await store.consume(ipKey, {
      limit: config.MAX_REQUESTS * 10,
      burst: config.BURST * 10,
      windowMs: config.WINDOW_MS,
    });

    if (!ipResult.allowed) {
      res.setHeader("Retry-After", String(ipResult.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: UPLOAD_ERROR_CODES.RATE_LIMITED,
        message: "การใช้งานจาก IP นี้เกินขีดจำกัด กรุณารอสักครู่แล้วลองใหม่",
      });
    }

    // Refund token if response ends in a 5xx server error
    res.on("finish", () => {
      if (res.statusCode >= 500) {
        store.refund(userKey).catch(() => {});
        store.refund(ipKey).catch(() => {});
      }
    });

    next();
  };
}
