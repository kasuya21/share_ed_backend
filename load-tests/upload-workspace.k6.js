import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const createPostDuration = new Trend("create_post_duration_ms");
const sessionCreateDuration = new Trend("session_create_duration_ms");
const fileSignDuration = new Trend("file_sign_duration_ms");
const completeVerifyDuration = new Trend("complete_verify_duration_ms");
const failureRate = new Rate("failed_requests_rate");
const replayedPostsCount = new Counter("replayed_posts_count");

export const options = {
  scenarios: {
    // Scenario 1: Standard 100 concurrent users flow
    standard_users: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "10s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "15s", target: 100 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
      exec: "standardFlow",
    },
    // Scenario 2: Spike test 200 - 300 users
    spike_test: {
      executor: "ramping-vus",
      startTime: "55s",
      stages: [
        { duration: "5s", target: 200 },
        { duration: "10s", target: 300 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
      exec: "standardFlow",
    },
    // Scenario 3: Idempotency & Retry Stress Test
    idempotency_retry: {
      executor: "constant-vus",
      startTime: "80s",
      vus: 20,
      duration: "15s",
      exec: "idempotencyRetryFlow",
    },
  },
  thresholds: {
    failed_requests_rate: ["rate<0.01"], // HTTP failure rate < 1%
    create_post_duration_ms: ["p(95)<1000"], // Create Post p95 < 1 second
  },
};

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000/api/v1").replace(/\/$/, "");
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "mock-jwt-token";

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

export function standardFlow() {
  const draftId = generateUUID();
  let sessionId = null;
  let coverAssetId = null;
  let pdfAssetId = null;

  // 1. Create or Reuse Session
  group("1. Create Upload Session", function () {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/posts/upload-sessions`,
      JSON.stringify({ draft_id: draftId }),
      { headers }
    );
    sessionCreateDuration.add(Date.now() - start);

    const success = check(res, {
      "session status 200": r => r.status === 200,
      "session id returned": r => {
        const body = r.json();
        if (body?.data?.session_id) {
          sessionId = body.data.session_id;
          return true;
        }
        return false;
      },
    });
    failureRate.add(!success);
  });

  if (!sessionId) return;

  // 2. Request Signed Upload (Cover + PDF)
  group("2. Request Signed Upload", function () {
    const coverFileId = generateUUID();
    const startCover = Date.now();
    const coverRes = http.post(
      `${BASE_URL}/posts/upload-sessions/${sessionId}/files/sign`,
      JSON.stringify({
        client_file_id: coverFileId,
        asset_type: "COVER",
        original_name: "cover.png",
        content_type: "image/png",
        size: 102400,
      }),
      { headers }
    );
    fileSignDuration.add(Date.now() - startCover);

    check(coverRes, {
      "cover sign 200": r => {
        const body = r.json();
        if (body?.data?.asset_id) {
          coverAssetId = body.data.asset_id;
          return true;
        }
        return false;
      },
    });

    const pdfFileId = generateUUID();
    const startPdf = Date.now();
    const pdfRes = http.post(
      `${BASE_URL}/posts/upload-sessions/${sessionId}/files/sign`,
      JSON.stringify({
        client_file_id: pdfFileId,
        asset_type: "PDF",
        original_name: "notes.pdf",
        content_type: "application/pdf",
        size: 512000,
      }),
      { headers }
    );
    fileSignDuration.add(Date.now() - startPdf);

    check(pdfRes, {
      "pdf sign 200": r => {
        const body = r.json();
        if (body?.data?.asset_id) {
          pdfAssetId = body.data.asset_id;
          return true;
        }
        return false;
      },
    });
  });

  // 3. Complete and Verify Files (Mock Provider payload)
  group("3. Complete and Verify", function () {
    if (coverAssetId) {
      const start = Date.now();
      const res = http.post(
        `${BASE_URL}/posts/upload-sessions/${sessionId}/files/${coverAssetId}/complete`,
        JSON.stringify({
          public_id: `share-ed/users/user/upload-sessions/${sessionId}/covers/mock`,
          version: 123,
          signature: "mock-signature",
          secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v123/mock.png",
          resource_type: "image",
          format: "png",
          bytes: 102400,
        }),
        { headers }
      );
      completeVerifyDuration.add(Date.now() - start);
    }

    if (pdfAssetId) {
      const start = Date.now();
      const res = http.post(
        `${BASE_URL}/posts/upload-sessions/${sessionId}/files/${pdfAssetId}/complete`,
        JSON.stringify({
          bucket: "post-pdfs",
          path: `users/user/upload-sessions/${sessionId}/${generateUUID()}.pdf`,
        }),
        { headers }
      );
      completeVerifyDuration.add(Date.now() - start);
    }
  });

  // 4. Create Post from Verified Assets
  group("4. Create Post", function () {
    const idempotencyKey = `load_${generateUUID().replace(/-/g, "")}`;
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/posts`,
      JSON.stringify({
        title: "Load Test Note Title",
        summary: "Load test note summary",
        content: "Detailed content generated during load test",
        education_level: "UNIVERSITY",
        post_status: "ACTIVE",
        upload_session_id: sessionId,
        cover_asset_id: coverAssetId,
        media_asset_ids: pdfAssetId ? [pdfAssetId] : [],
        idempotency_key: idempotencyKey,
      }),
      { headers }
    );
    const duration = Date.now() - start;
    createPostDuration.add(duration);

    const success = check(res, {
      "create post 201 or 200": r => r.status === 201 || r.status === 200,
      "create post under 1s": () => duration < 1000,
    });
    failureRate.add(!success);
  });

  sleep(1);
}

export function idempotencyRetryFlow() {
  const fixedDraftId = "e1111111-e111-4111-8111-e11111111111";
  const fixedIdempotencyKey = "idempotency_test_fixed_key_0123456789";

  // Retrying session creation with same draft_id must return 200 and same session
  const res1 = http.post(
    `${BASE_URL}/posts/upload-sessions`,
    JSON.stringify({ draft_id: fixedDraftId }),
    { headers }
  );

  check(res1, {
    "session replay status 200": r => r.status === 200,
    "session replay draft matches": r => r.json()?.data?.draft_id === fixedDraftId,
  });

  // Retrying post creation with same idempotency_key must return 200 replayed
  const start = Date.now();
  const res2 = http.post(
    `${BASE_URL}/posts`,
    JSON.stringify({
      title: "Idempotent Post",
      summary: "Idempotency test summary",
      content: "Content",
      education_level: "UNIVERSITY",
      post_status: "DRAFT",
      idempotency_key: fixedIdempotencyKey,
    }),
    { headers }
  );
  createPostDuration.add(Date.now() - start);

  check(res2, {
    "post replay status 200 or 201": r => r.status === 200 || r.status === 201,
  });

  if (res2.json()?.replayed) {
    replayedPostsCount.add(1);
  }

  sleep(0.5);
}
