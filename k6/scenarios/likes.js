import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { CONFIG, PROFILES, DEFAULT_THRESHOLDS } from "../config/env.js";
import { authHeaders } from "../helpers/utils.js";

const likeDuration = new Trend("like_toggle_duration_ms");
const likeErrors = new Counter("like_errors_count");
const likeSuccessRate = new Rate("like_success_rate");

const profileName = __ENV.PROFILE || "smoke";
const selectedProfile = PROFILES[profileName] || PROFILES.smoke;

export const options = {
  scenarios: {
    concurrent_likes: {
      ...selectedProfile,
      exec: "likeFlow",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    like_toggle_duration_ms: ["p(95)<500", "p(99)<1000"],
    like_errors_count: ["count==0"],
  },
};

export function setup() {
  // If TARGET_POST_ID is not provided, fetch the latest public post
  if (!CONFIG.targetPostId) {
    const res = http.get(`${CONFIG.baseUrl}/posts?page=1&limit=1`);
    if (res.status === 200) {
      try {
        const body = res.json();
        if (body?.data?.length > 0) {
          return { postId: body.data[0].id };
        }
      } catch {}
    }
  }
  return { postId: CONFIG.targetPostId };
}

export default function (data) {
  likeFlow(data);
}

export function likeFlow(data) {
  const postId = data?.postId || CONFIG.targetPostId;
  if (!postId) {
    console.error("No target post available for concurrent like test");
    return;
  }

  const headers = authHeaders(CONFIG.authToken);

  group("Toggle Like Concurrently", function () {
    const start = Date.now();
    const res = http.post(`${CONFIG.baseUrl}/likes/${postId}`, null, { headers });
    likeDuration.add(Date.now() - start);

    const ok = check(res, {
      "like response 200": r => r.status === 200,
      "like response success": r => {
        try {
          return r.json()?.success === true;
        } catch {
          return false;
        }
      },
      "isLiked boolean present": r => {
        try {
          return typeof r.json()?.isLiked === "boolean";
        } catch {
          return false;
        }
      },
    });

    likeSuccessRate.add(ok);
    if (!ok) {
      likeErrors.add(1);
    }
  });

  sleep(0.5);
}
