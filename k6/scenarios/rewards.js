import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { CONFIG, PROFILES, DEFAULT_THRESHOLDS } from "../config/env.js";
import { authHeaders } from "../helpers/utils.js";

const claimDuration = new Trend("claim_reward_duration_ms");
const doubleClaimViolations = new Counter("double_claim_violations_count");
const claimSuccessOrHandled = new Rate("claim_validly_handled_rate");

const profileName = __ENV.PROFILE || "smoke";
const selectedProfile = PROFILES[profileName] || PROFILES.smoke;

export const options = {
  scenarios: {
    claim_rewards: {
      ...selectedProfile,
      exec: "claimFlow",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    claim_reward_duration_ms: ["p(95)<1000"],
    double_claim_violations_count: ["count==0"],
  },
};

export function setup() {
  const headers = authHeaders(CONFIG.authToken);
  let achievementId = CONFIG.targetAchievementId;

  if (!achievementId) {
    const res = http.get(`${CONFIG.baseUrl}/achievements`, { headers });
    if (res.status === 200) {
      try {
        const body = res.json();
        if (body?.data?.length > 0) {
          // Look for any achievement with status READY_TO_CLAIM or just the first achievement
          const ready = body.data.find(a => a.status === "READY_TO_CLAIM");
          achievementId = ready ? ready.id : body.data[0].id;
        }
      } catch {}
    }
  }
  return { achievementId };
}

export default function (data) {
  claimFlow(data);
}

export function claimFlow(data) {
  const achievementId = data?.achievementId || CONFIG.targetAchievementId;
  if (!achievementId) {
    console.error("No target achievement available for claim test");
    return;
  }

  const headers = authHeaders(CONFIG.authToken);

  group("Claim Achievement Reward Concurrently", function () {
    const start = Date.now();
    const res = http.post(`${CONFIG.baseUrl}/achievements/${achievementId}/claim`, null, { headers });
    claimDuration.add(Date.now() - start);

    // Business check:
    // 200 = Success (First claim)
    // 400 = Already claimed or not completed yet (Valid rejection)
    // 404 = Progress not found (Valid rejection)
    // 500 = Server failure / race condition violation
    const isHandledCorrectly = check(res, {
      "claim response status is 200 or 400 or 404": r => [200, 400, 404].includes(r.status),
      "not internal server error (500)": r => r.status !== 500,
    });

    claimSuccessOrHandled.add(isHandledCorrectly);

    if (res.status === 500) {
      doubleClaimViolations.add(1);
    }
  });

  sleep(0.5);
}
