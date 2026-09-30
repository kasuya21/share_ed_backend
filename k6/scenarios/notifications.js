import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { CONFIG, PROFILES, DEFAULT_THRESHOLDS } from "../config/env.js";
import { authHeaders } from "../helpers/utils.js";

const getNotificationsDuration = new Trend("get_notifications_duration_ms");
const markAllReadDuration = new Trend("mark_all_read_duration_ms");
const notifFailureRate = new Rate("notif_failure_rate");

const profileName = __ENV.PROFILE || "smoke";
const selectedProfile = PROFILES[profileName] || PROFILES.smoke;

export const options = {
  scenarios: {
    notifications_load: {
      ...selectedProfile,
      exec: "notificationFlow",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    get_notifications_duration_ms: ["p(95)<500", "p(99)<1000"],
    mark_all_read_duration_ms: ["p(95)<500", "p(99)<1000"],
  },
};

export default function () {
  notificationFlow();
}

export function notificationFlow() {
  const headers = authHeaders(CONFIG.authToken);

  group("1. Get Notifications List", function () {
    const start = Date.now();
    const res = http.get(`${CONFIG.baseUrl}/notifications`, { headers });
    getNotificationsDuration.add(Date.now() - start);

    const ok = check(res, {
      "notifications status 200": r => r.status === 200,
      "notifications returns success": r => {
        try {
          return r.json()?.success === true;
        } catch {
          return false;
        }
      },
      "notifications has array": r => {
        try {
          return Array.isArray(r.json()?.data);
        } catch {
          return false;
        }
      },
    });
    notifFailureRate.add(!ok);
  });

  sleep(0.5);

  group("2. Mark All Notifications as Read", function () {
    const start = Date.now();
    const res = http.patch(`${CONFIG.baseUrl}/notifications/read-all`, null, { headers });
    markAllReadDuration.add(Date.now() - start);

    const ok = check(res, {
      "mark all read status 200": r => r.status === 200,
      "mark all read returns success": r => {
        try {
          return r.json()?.success === true;
        } catch {
          return false;
        }
      },
    });
    notifFailureRate.add(!ok);
  });

  sleep(1);
}
