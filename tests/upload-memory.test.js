import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { postUpload, uploadConcurrencyGuard } from "../middlewares/upload.middleware.js";
import { errorHandler } from "../utils/security.js";

function png(size = 32) {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return bytes;
}

async function withServer(configure, operation) {
  const app = express();
  configure(app);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("post upload accepts a small signed image", async () => {
  await withServer(app => {
    app.post("/", postUpload.single("cover_image"), (req, res) => {
      res.json({ size: req.file.size });
    });
  }, async baseUrl => {
    const body = new FormData();
    body.append("cover_image", new Blob([png()], { type: "image/png" }), "cover.png");
    const response = await fetch(baseUrl, { method: "POST", body });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { size: 32 });
  });
});

test("post upload rejects an image above the two MiB policy without retaining it", async () => {
  await withServer(app => {
    app.post("/", postUpload.single("cover_image"), (req, res) => res.sendStatus(204));
  }, async baseUrl => {
    const body = new FormData();
    body.append("cover_image", new Blob([png(2 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png");
    const response = await fetch(baseUrl, { method: "POST", body });
    const result = await response.json();
    assert.equal(response.status, 413);
    assert.equal(result.code, "UPLOAD_FILE_TOO_LARGE");
  });
});

test("post upload rejects a forged MIME type", async () => {
  await withServer(app => {
    app.post("/", postUpload.single("cover_image"), (req, res) => res.sendStatus(204));
  }, async baseUrl => {
    const body = new FormData();
    body.append("cover_image", new Blob(["not an image"], { type: "image/png" }), "fake.png");
    const response = await fetch(baseUrl, { method: "POST", body });
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.code, "INVALID_REQUEST");
  });
});

test("twenty concurrent multipart requests keep only one upload response active", async () => {
  let releaseFirst;
  const holdFirst = new Promise(resolve => { releaseFirst = resolve; });
  let enteredFirst;
  const firstEntered = new Promise(resolve => { enteredFirst = resolve; });

  await withServer(app => {
    app.post("/", uploadConcurrencyGuard, postUpload.single("cover_image"), async (req, res) => {
      enteredFirst();
      await holdFirst;
      res.json({ success: true });
    });
  }, async baseUrl => {
    const firstBody = new FormData();
    firstBody.append("cover_image", new Blob([png()], { type: "image/png" }), "first.png");
    const firstRequest = fetch(baseUrl, { method: "POST", body: firstBody });
    await firstEntered;

    const rejectedResponses = await Promise.all(Array.from({ length: 19 }, async (_, index) => {
      const body = new FormData();
      body.append("cover_image", new Blob([png()], { type: "image/png" }), `rejected-${index}.png`);
      const response = await fetch(baseUrl, { method: "POST", body });
      return { response, result: await response.json() };
    }));
    assert.equal(rejectedResponses.length, 19);
    for (const { response, result } of rejectedResponses) {
      assert.equal(response.status, 503);
      assert.equal(result.code, "UPLOAD_BUSY");
      assert.equal(response.headers.get("retry-after"), "2");
    }

    releaseFirst();
    assert.equal((await firstRequest).status, 200);
  });
});
