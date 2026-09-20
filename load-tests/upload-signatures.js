import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const baseUrl = (process.env.LOAD_BASE_URL || "http://localhost:5000/api/v1").replace(/\/$/, "");
const virtualUsers = positiveInteger(process.env.LOAD_VUS, 20, 100);
const requests = positiveInteger(process.env.LOAD_REQUESTS, 100, 10000);

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

async function loadTokens() {
  if (process.env.LOAD_AUTH_TOKENS_FILE) {
    const content = await readFile(process.env.LOAD_AUTH_TOKENS_FILE, "utf8");
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      return content.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    }
  }
  return process.env.LOAD_AUTH_TOKEN ? [process.env.LOAD_AUTH_TOKEN] : [];
}

function percentile(sorted, percentage) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)];
}

const tokens = await loadTokens();
if (tokens.length === 0) {
  throw new Error("Set LOAD_AUTH_TOKEN or LOAD_AUTH_TOKENS_FILE before running the load test");
}

let nextRequest = 0;
const durations = [];
const statuses = new Map();
const startedAt = performance.now();

async function worker(workerIndex) {
  while (true) {
    const requestIndex = nextRequest++;
    if (requestIndex >= requests) return;
    const token = tokens[(requestIndex + workerIndex) % tokens.length];
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/posts/upload-signatures`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ types: ["cover", "media", "pdf"] }),
        signal: AbortSignal.timeout(15000),
      });
      await response.arrayBuffer();
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
    } catch {
      statuses.set("network_error", (statuses.get("network_error") || 0) + 1);
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: virtualUsers }, (_, index) => worker(index)));

durations.sort((a, b) => a - b);
const elapsedSeconds = (performance.now() - startedAt) / 1000;
const succeeded = statuses.get(200) || 0;
console.log(JSON.stringify({
  target: `${baseUrl}/posts/upload-signatures`,
  virtualUsers,
  requests,
  distinctTokens: tokens.length,
  succeeded,
  failed: requests - succeeded,
  requestsPerSecond: Number((requests / elapsedSeconds).toFixed(2)),
  latencyMs: {
    p50: Number(percentile(durations, 0.5).toFixed(2)),
    p95: Number(percentile(durations, 0.95).toFixed(2)),
    p99: Number(percentile(durations, 0.99).toFixed(2)),
    max: Number((durations.at(-1) || 0).toFixed(2)),
  },
  statuses: Object.fromEntries(statuses),
}, null, 2));

if (succeeded !== requests) process.exitCode = 1;
