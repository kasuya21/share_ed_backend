import test from "node:test";
import assert from "node:assert/strict";

import { validatePassword } from "../utils/password-validation.js";

test("password accepts at least eight alphanumeric characters with a letter and number", () => {
  assert.deepEqual(validatePassword("shareed1"), []);
  assert.deepEqual(validatePassword("SHAREED1"), []);
});

test("password reports every unmet visible requirement", () => {
  const codes = validatePassword("ภาษาไทย!").map(error => error.code);

  assert.ok(codes.includes("LETTER"));
  assert.ok(codes.includes("NUMBER"));
  assert.ok(codes.includes("CHARACTERS"));
});

test("password rejects values shorter than eight characters", () => {
  assert.ok(validatePassword("abc123").some(error => error.code === "LENGTH"));
});
