/**
 * Lightweight in-memory cache with TTL (Time-To-Live).
 * In test mode (NODE_ENV === "test" or node --test runner), caching is bypassed to ensure test isolation.
 */
const isTestEnv = () =>
  process.env.NODE_ENV === "test" ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.some((arg) => arg.includes("test")) ||
  process.execArgv.some((arg) => arg.includes("test")) ||
  process.env.npm_lifecycle_event === "test";

export class MemoryCache {
  constructor(defaultTtlMs = 60000) {
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  get(key) {
    if (isTestEnv()) return null;
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.timestamp > item.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  set(key, data, ttlMs = this.defaultTtlMs) {
    if (isTestEnv()) return;
    this.cache.set(key, { data, timestamp: Date.now(), ttlMs });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}
