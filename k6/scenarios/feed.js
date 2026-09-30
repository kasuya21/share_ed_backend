import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";
import { CONFIG, PROFILES, DEFAULT_THRESHOLDS } from "../config/env.js";
import { authHeaders } from "../helpers/utils.js";

const feedDuration = new Trend("feed_duration_ms");
const postDetailDuration = new Trend("post_detail_duration_ms");
const successRate = new Rate("feed_success_rate");

const profileName = __ENV.PROFILE || "smoke";
const selectedProfile = PROFILES[profileName] || PROFILES.smoke;

export const options = {
  scenarios: {
    browse_feed: {
      ...selectedProfile,
      exec: "browseFlow",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    feed_duration_ms: ["p(95)<500", "p(99)<1000"],
    post_detail_duration_ms: ["p(95)<500", "p(99)<1000"],
  },
};

export default function () {
  browseFlow();
}

export function browseFlow() {
  const headers = authHeaders(CONFIG.authToken);

  group("1. Get Feed Posts (Page 1)", function () {
    const start = Date.now();
    const res = http.get(`${CONFIG.baseUrl}/posts?page=1&limit=20`, { headers });
    feedDuration.add(Date.now() - start);

    const ok = check(res, {
      "feed status is 200": r => r.status === 200,
      "feed returns success": r => {
        try {
          return r.json()?.success === true;
        } catch {
          return false;
        }
      },
      "feed has data array": r => {
        try {
          return Array.isArray(r.json()?.data);
        } catch {
          return false;
        }
      },
    });
    successRate.add(ok);

    // If target post ID is not set, try to grab the first post from feed
    let postId = CONFIG.targetPostId;
    if (!postId) {
      try {
        const body = res.json();
        if (body?.data?.length > 0) {
          postId = body.data[0].id;
        }
      } catch {}
    }

    if (postId) {
      sleep(0.5);
      group("2. View Post Detail", function () {
        const startDetail = Date.now();
        const detailRes = http.get(`${CONFIG.baseUrl}/posts/${postId}`, { headers });
        postDetailDuration.add(Date.now() - startDetail);

        check(detailRes, {
          "post detail status 200": r => r.status === 200,
          "post detail id matches": r => {
            try {
              return r.json()?.data?.id === postId;
            } catch {
              return false;
            }
          },
        });
      });
    }
  });

  sleep(1);
}
