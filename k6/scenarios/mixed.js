import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { CONFIG, DEFAULT_THRESHOLDS } from "../config/env.js";
import { authHeaders, generateUUID } from "../helpers/utils.js";

const mixedDuration = new Trend("mixed_request_duration_ms");
const mixedFailureRate = new Rate("mixed_failure_rate");
const feedCount = new Counter("mixed_feed_requests_count");
const likeCount = new Counter("mixed_like_requests_count");
const notifCount = new Counter("mixed_notif_requests_count");
const postCount = new Counter("mixed_post_requests_count");

export const options = {
  scenarios: {
    mixed_traffic: {
      executor: "ramping-vus",
      startVUs: 2,
      stages: [
        { duration: "10s", target: 15 },
        { duration: "20s", target: 30 },
        { duration: "20s", target: 50 },
        { duration: "10s", target: 0 },
      ],
      exec: "mixedWorkloadFlow",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    mixed_request_duration_ms: ["p(95)<800", "p(99)<1500"],
    mixed_failure_rate: ["rate<0.01"],
  },
};

export function setup() {
  let targetPostId = CONFIG.targetPostId;
  if (!targetPostId) {
    const res = http.get(`${CONFIG.baseUrl}/posts?page=1&limit=1`);
    if (res.status === 200) {
      try {
        const body = res.json();
        if (body?.data?.length > 0) {
          targetPostId = body.data[0].id;
        }
      } catch {}
    }
  }
  return { targetPostId };
}

export default function (data) {
  mixedWorkloadFlow(data);
}

export function mixedWorkloadFlow(data) {
  const headers = authHeaders(CONFIG.authToken);
  const postId = data?.targetPostId || CONFIG.targetPostId;

  // Realistic user behavior distribution:
  // 60% Read (Feed / Post details)
  // 20% Likes
  // 15% Notifications
  // 5%  Post Creation
  const rand = Math.random();

  if (rand < 0.60) {
    // Read feed
    feedCount.add(1);
    const start = Date.now();
    const res = http.get(`${CONFIG.baseUrl}/posts?page=1&limit=20`, { headers });
    mixedDuration.add(Date.now() - start);
    mixedFailureRate.add(res.status !== 200);
  } else if (rand < 0.80) {
    // Like toggle
    if (postId) {
      likeCount.add(1);
      const start = Date.now();
      const res = http.post(`${CONFIG.baseUrl}/likes/${postId}`, null, { headers });
      mixedDuration.add(Date.now() - start);
      mixedFailureRate.add(res.status !== 200);
    }
  } else if (rand < 0.95) {
    // Check notifications
    notifCount.add(1);
    const start = Date.now();
    const res = http.get(`${CONFIG.baseUrl}/notifications`, { headers });
    mixedDuration.add(Date.now() - start);
    mixedFailureRate.add(res.status !== 200);
  } else {
    // Create draft post
    postCount.add(1);
    const start = Date.now();
    const res = http.post(
      `${CONFIG.baseUrl}/posts`,
      JSON.stringify({
        title: `Mixed Load Test Post ${Date.now()}`,
        summary: "Created during mixed workload testing",
        content: "Verifying system stability under concurrent read and write operations.",
        education_level: "UNIVERSITY",
        post_status: "DRAFT",
        idempotency_key: `mixed_${generateUUID().replace(/-/g, "")}`,
      }),
      { headers }
    );
    mixedDuration.add(Date.now() - start);
    mixedFailureRate.add(![200, 201].includes(res.status));
  }

  sleep(Math.random() * 1.5 + 0.5); // Think time 0.5s - 2s
}
