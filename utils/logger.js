import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const requests = new AsyncLocalStorage();
const secretKey = /password|token|secret|authorization|cookie|key$|database_url|direct_url|cloudinary_url/i;

function sensitiveValues(value, values, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return;
  for (const [key, item] of Object.entries(value)) {
    if (secretKey.test(key) && typeof item === "string" && item) values.add(item);
    else if (item && typeof item === "object") sensitiveValues(item, values, depth + 1);
  }
}

function redact(value, req) {
  let text = String(value ?? "");
  const secrets = new Set();
  sensitiveValues(process.env, secrets);
  sensitiveValues(req?.body, secrets);
  sensitiveValues(req?.headers, secrets);
  const bearer = req?.headers?.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) secrets.add(bearer);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/\b(?:https?|postgres(?:ql)?|cloudinary):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]")
    .replace(/(["']?(?:password|access_token|refresh_token|secret|authorization|cookie|api_key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, "$1[REDACTED]")
    .slice(0, 2000);
}

const prismaReasons = {
  P1000: "Database authentication failed",
  P1001: "Cannot reach database server",
  P1002: "Database connection timed out",
  P2002: "Unique constraint violation",
  P2003: "Foreign key constraint violation",
  P2024: "Database connection pool timed out",
  P2025: "Required database record not found",
};

function errorDetails(error, req, depth = 0) {
  if (error == null) return undefined;
  const details = {
    name: redact(error.name || "Error", req),
    code: error.code === undefined ? undefined : redact(error.code, req),
    // Prisma/parser messages may embed whole query arguments or submitted JSON.
    message: error.type === "entity.parse.failed" ? "Malformed JSON request body"
      : String(error.name || "").startsWith("Prisma") || /^P\d{4}$/.test(error.code || "")
        ? prismaReasons[error.code] || "Database operation failed; inspect code and stack"
        : redact(error.message || (typeof error === "string" ? error : "Operation failed"), req),
    status: Number.isInteger(error.status || error.statusCode || error.http_code)
      ? (error.status || error.statusCode || error.http_code) : undefined,
    stack: typeof error.stack === "string"
      ? error.stack.split("\n").filter(line => /^\s+at\s/.test(line)).slice(0, 10).map(line => redact(line.trim(), req))
      : undefined,
  };
  if (error.cause && depth < 2) details.cause = errorDetails(error.cause, req, depth + 1);
  return details;
}

function write(level, event, error, req, context = {}) {
  const request = req || requests.getStore()?.req;
  const record = {
    timestamp: new Date().toISOString(), level, event,
    requestId: request?.requestId,
    method: request?.method,
    operation: request?.logOperation,
    route: request ? (request.logRoute || (request.route?.path ? `${request.baseUrl || ""}${request.route.path}` : "unmatched")) : undefined,
    userId: request?.user?.id,
    error: errorDetails(error, request),
  };
  // Call sites pass only identifiers and fixed operation metadata, never bodies.
  for (const [key, value] of Object.entries(context)) {
    if (secretKey.test(key)) continue;
    if (typeof value === "string") record[key] = redact(value, request);
    else if (typeof value === "number" || typeof value === "boolean") record[key] = value;
  }
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](JSON.stringify(record));
}

export const logError = (event, error, req, context) => write("error", event, error, req, context);
export const logWarn = (event, error, req, context) => write("warn", event, error, req, context);
export const logInfo = (event, context, req) => write("info", event, undefined, req, context);

export function requestLogging(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  const started = performance.now();
  let failure;
  const json = res.json;
  res.json = function (body) {
    if (req.route?.path) req.logRoute = `${req.baseUrl || ""}${req.route.path}`;
    if (res.statusCode >= 400) {
      failure = {
        message: typeof body?.message === "string" ? body.message : "Request rejected",
        fields: body?.errors && typeof body.errors === "object" ? Object.keys(body.errors).join(",") : undefined,
      };
      if (body && typeof body === "object" && !Array.isArray(body) && body.requestId === undefined) {
        body.requestId = req.requestId;
      }
    }
    return json.call(this, body);
  };
  res.once("finish", () => {
    if (res.statusCode < 400) return;
    write(res.statusCode >= 500 ? "error" : "warn", "http.request.failed", undefined, req, {
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      responseMessage: failure?.message,
      invalidFields: failure?.fields,
    });
  });
  res.once("close", () => {
    if (!res.writableFinished) logWarn("http.request.aborted", undefined, req);
  });
  requests.run({ req }, next);
}
