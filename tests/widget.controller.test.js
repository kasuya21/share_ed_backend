import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import("../configs/prisma.js");
const { getMyWidgets, updateMyWidgets } = await import("../controllers/widget.controller.js");

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("profile widget endpoints return and canonicalize the current user's widgets", async t => {
  const originalFindUnique = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.update = originalUpdate;
  });

  prisma.user.findUnique = t.mock.fn(async ({ where, select }) => {
    assert.deepEqual(where, { id: "member-1" });
    assert.deepEqual(select, { widgets: true });
    return { widgets: null };
  });
  const getResponse = response();
  await getMyWidgets({ user: { id: "member-1" } }, getResponse);
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.payload, { success: true, data: null });

  prisma.user.update = t.mock.fn(async ({ where, data, select }) => {
    assert.deepEqual(where, { id: "member-1" });
    assert.deepEqual(select, { widgets: true });
    assert.deepEqual(data.widgets, [{
      id: "instagram",
      platformId: "instagram",
      url: "https://instagram.com/share_ed",
      options: { insideProfileCard: true },
    }]);
    return { widgets: data.widgets };
  });
  const putResponse = response();
  await updateMyWidgets({
    user: { id: "member-1" },
    body: {
      widgets: [{
        platformId: "instagram",
        url: "https://instagram.com/share_ed",
        options: {},
      }],
    },
  }, putResponse);
  assert.equal(putResponse.statusCode, 200);
  assert.equal(prisma.user.update.mock.callCount(), 1);
});

test("profile widgets reject unsupported, forged, incomplete, duplicate and oversized links", async t => {
  const originalUpdate = prisma.user.update;
  prisma.user.update = t.mock.fn(async () => ({ widgets: [] }));
  t.after(() => { prisma.user.update = originalUpdate; });

  const invalidLists = [
    [{ platformId: "instagram", url: "instagram.com/share_ed" }],
    [{ platformId: "instagram", url: "https://facebook.com/share_ed" }],
    [{ platformId: "instagram", url: "https://instagram.com/p" }],
    [{ platformId: "discord", url: "https://discord.com/channels/test" }],
    [{ platformId: "youtube", url: `https://youtube.com/@${"a".repeat(2050)}` }],
    [
      { platformId: "facebook", url: "https://facebook.com/share-ed" },
      { platformId: "facebook", url: "https://facebook.com/share-ed-2" },
    ],
  ];

  for (const widgets of invalidLists) {
    const res = response();
    await updateMyWidgets({ user: { id: "member-1" }, body: { widgets } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.success, false);
  }
  assert.equal(prisma.user.update.mock.callCount(), 0);
});
