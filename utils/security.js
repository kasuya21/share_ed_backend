export function bearerToken(header) {
  if (typeof header !== "string" || header.length > 8192) return null;
  return /^Bearer ([^\s]+)$/i.exec(header)?.[1] || null;
}

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.headers.authorization) res.setHeader("Cache-Control", "no-store");
  next();
}

// Per-process protection. Multi-instance deployments need a shared gateway/store.
export function rateLimit({ limit = 20, windowMs = 60000, maxKeys = 10000, now = Date.now } = {}) {
  const clients = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [key, entry] of clients) {
      if (entry.reset <= time) clients.delete(key);
    }
    const key = req.ip || req.socket.remoteAddress;
    let entry = clients.get(key);
    if (!entry) {
      if (clients.size >= maxKeys) return res.status(429).json({ message: "Too many requests" });
      entry = { count: 0, reset: time + windowMs };
      clients.set(key, entry);
    }
    if (++entry.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((entry.reset - time) / 1000)));
      return res.status(429).json({ message: "Too many requests" });
    }
    next();
  };
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.type === "entity.too.large" || error.code === "LIMIT_FILE_SIZE" ? 413
    : error.type === "entity.parse.failed" || error.name === "MulterError" || error.code === "INVALID_UPLOAD" ? 400 : 500;
  res.status(status).json({ message: status === 413 ? "Request too large" : status === 400 ? "Invalid request" : "Internal server error" });
}
