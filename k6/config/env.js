// k6 Environment and Configuration Loader
export const CONFIG = {
  baseUrl: (__ENV.BASE_URL || "http://localhost:3000/api/v1").replace(/\/$/, ""),
  authToken: __ENV.AUTH_TOKEN || "",
  tokensFile: __ENV.USER_TOKENS_FILE || "k6/fixtures/test-tokens.json",
  targetPostId: __ENV.TARGET_POST_ID || "",
  targetUserId: __ENV.TARGET_USER_ID || "",
  targetAchievementId: __ENV.TARGET_ACHIEVEMENT_ID || "",
};

// Thresholds according to K6.md:
// - System error rate < 1%
// - API p95 < 500ms, p99 < 1000ms
export const DEFAULT_THRESHOLDS = {
  http_req_failed: ["rate<0.01"],
  http_req_duration: ["p(95)<500", "p(99)<1000"],
};

export const PROFILES = {
  smoke: {
    executor: "constant-vus",
    vus: parseInt(__ENV.SMOKE_VUS || "5", 10),
    duration: __ENV.SMOKE_DURATION || "15s",
  },
  baseline: {
    executor: "constant-vus",
    vus: 10,
    duration: "30s",
  },
  load: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "15s", target: 25 },
      { duration: "30s", target: 50 },
      { duration: "30s", target: 50 },
      { duration: "15s", target: 0 },
    ],
  },
  burst: {
    executor: "shared-iterations",
    vus: parseInt(__ENV.BURST_VUS || "50", 10),
    iterations: parseInt(__ENV.BURST_VUS || "50", 10),
    maxDuration: "30s",
  },
  stress: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "20s", target: 25 },
      { duration: "30s", target: 50 },
      { duration: "30s", target: 100 },
      { duration: "30s", target: 200 },
      { duration: "20s", target: 0 },
    ],
  },
  spike: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "10s", target: 10 },
      { duration: "5s", target: 150 },
      { duration: "15s", target: 150 },
      { duration: "10s", target: 10 },
      { duration: "5s", target: 0 },
    ],
  },
  soak: {
    executor: "constant-vus",
    vus: parseInt(__ENV.SOAK_VUS || "25", 10),
    duration: __ENV.SOAK_DURATION || "5m",
  },
};
