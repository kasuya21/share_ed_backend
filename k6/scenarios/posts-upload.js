import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";
import { CONFIG, PROFILES, DEFAULT_THRESHOLDS } from "../config/env.js";
import { authHeaders, generateUUID } from "../helpers/utils.js";

const sessionCreateDuration = new Trend("session_create_duration_ms");
const fileSignDuration = new Trend("file_sign_duration_ms");
const createPostDuration = new Trend("create_post_duration_ms");
const uploadPostFailureRate = new Rate("upload_post_failure_rate");

const profileName = __ENV.PROFILE || "smoke";
const selectedProfile = PROFILES[profileName] || PROFILES.smoke;

export const options = {
  scenarios: {
    create_post_upload: {
      ...selectedProfile,
      exec: "createPostUploadFlow",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    session_create_duration_ms: ["p(95)<500"],
    file_sign_duration_ms: ["p(95)<500"],
    create_post_duration_ms: ["p(95)<1000"],
  },
};

export default function () {
  createPostUploadFlow();
}

export function createPostUploadFlow() {
  const headers = authHeaders(CONFIG.authToken);
  const draftId = generateUUID();
  let sessionId = null;
  let coverAssetId = null;

  // 1. Create Upload Session
  group("1. Create Upload Session", function () {
    const start = Date.now();
    const res = http.post(
      `${CONFIG.baseUrl}/posts/upload-sessions`,
      JSON.stringify({ draft_id: draftId }),
      { headers }
    );
    sessionCreateDuration.add(Date.now() - start);

    const ok = check(res, {
      "session created status 200": r => r.status === 200,
      "session id present": r => {
        try {
          const body = r.json();
          sessionId = body?.data?.session_id;
          return Boolean(sessionId);
        } catch {
          return false;
        }
      },
    });
    uploadPostFailureRate.add(!ok);
  });

  if (!sessionId) return;

  // 2. Request Signed Upload URL for Cover Image
  group("2. Request Signed Cover", function () {
    const clientFileId = generateUUID();
    const start = Date.now();
    const res = http.post(
      `${CONFIG.baseUrl}/posts/upload-sessions/${sessionId}/files/sign`,
      JSON.stringify({
        client_file_id: clientFileId,
        asset_type: "COVER",
        original_name: "test-cover.png",
        content_type: "image/png",
        size: 102400,
      }),
      { headers }
    );
    fileSignDuration.add(Date.now() - start);

    const ok = check(res, {
      "cover sign status 200": r => r.status === 200,
      "asset id returned": r => {
        try {
          const body = r.json();
          coverAssetId = body?.data?.asset_id;
          return Boolean(coverAssetId);
        } catch {
          return false;
        }
      },
    });
    uploadPostFailureRate.add(!ok);
  });

  // 3. Create Draft Post or Active Post with Idempotency Key
  group("3. Create Post with Idempotency Key", function () {
    const idempotencyKey = `k6_${generateUUID().replace(/-/g, "")}`;
    const start = Date.now();
    const res = http.post(
      `${CONFIG.baseUrl}/posts`,
      JSON.stringify({
        title: `K6 Load Test Post ${Date.now()}`,
        summary: "Automated load test verification post",
        content: "Testing concurrent post creation, uploads and idempotency under load.",
        education_level: "UNIVERSITY",
        post_status: "DRAFT",
        upload_session_id: sessionId,
        idempotency_key: idempotencyKey,
      }),
      { headers }
    );
    createPostDuration.add(Date.now() - start);

    const ok = check(res, {
      "post creation status 200 or 201": r => [200, 201].includes(r.status),
      "post id returned": r => {
        try {
          return Boolean(r.json()?.data?.id);
        } catch {
          return false;
        }
      },
    });
    uploadPostFailureRate.add(!ok);
  });

  sleep(1);
}
