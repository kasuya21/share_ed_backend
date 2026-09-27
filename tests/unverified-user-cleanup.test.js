import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { prisma } = await import("../configs/prisma.js");
const { cleanupUnverifiedUsers } = await import("../utils/cron.js");

function replace(t, object, key, value) {
  const original = object[key];
  object[key] = t.mock.fn(value);
  t.after(() => { object[key] = original; });
  return object[key];
}

test("unverified users older than two days are deleted from app and auth schemas", async (t) => {
  const query = replace(t, prisma, "$queryRaw", async () => [
    { id: "11111111-1111-4111-8111-111111111111" },
  ]);
  const now = new Date("2026-09-28T12:00:00.000Z");

  const deletedCount = await cleanupUnverifiedUsers(now);

  assert.equal(deletedCount, 1);
  assert.equal(query.mock.callCount(), 1);
  const [strings, cutoff, batchSize] = query.mock.calls[0].arguments;
  const sql = strings.join("?");
  assert.equal(cutoff.toISOString(), "2026-09-26T12:00:00.000Z");
  assert.equal(batchSize, 100);
  assert.match(sql, /email_confirmed_at IS NULL/);
  assert.match(sql, /DELETE FROM public\.users/);
  assert.match(sql, /DELETE FROM auth\.users/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
});
