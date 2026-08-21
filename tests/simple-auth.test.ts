import assert from "node:assert/strict";
import test from "node:test";
import {
  createSimpleSessionToken,
  isSimpleAuthEnabled,
  verifySimplePassword,
  verifySimpleSessionToken
} from "../src/auth/simple-auth.js";

test("simple auth is disabled when password env is empty", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;

  try {
    delete process.env.TODOTODOLIST_PASSWORD;

    assert.equal(isSimpleAuthEnabled(), false);
    assert.equal(await verifySimpleSessionToken(undefined), true);
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
  }
});

test("simple auth validates passwords and signed session expiry", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;
  const originalSecret = process.env.TODOTODOLIST_AUTH_SECRET;

  try {
    process.env.TODOTODOLIST_PASSWORD = "correct horse battery staple";
    process.env.TODOTODOLIST_AUTH_SECRET = "test-secret";

    assert.equal(isSimpleAuthEnabled(), true);
    assert.equal(verifySimplePassword("wrong"), false);
    assert.equal(verifySimplePassword("correct horse battery staple"), true);

    const now = Date.UTC(2026, 6, 7, 12, 0, 0);
    const token = await createSimpleSessionToken(now);

    assert.equal(await verifySimpleSessionToken(token, now + 1000), true);
    assert.equal(await verifySimpleSessionToken(`${token}x`, now + 1000), false);
    assert.equal(await verifySimpleSessionToken(token, now + 8 * 24 * 60 * 60 * 1000), false);
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
    restoreEnv("TODOTODOLIST_AUTH_SECRET", originalSecret);
  }
});

test("simple auth invalidates existing sessions after password rotation", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;
  const originalSecret = process.env.TODOTODOLIST_AUTH_SECRET;

  try {
    process.env.TODOTODOLIST_PASSWORD = "old password";
    process.env.TODOTODOLIST_AUTH_SECRET = "stable-secret";

    const now = Date.UTC(2026, 6, 7, 12, 0, 0);
    const token = await createSimpleSessionToken(now);
    assert.equal(await verifySimpleSessionToken(token, now + 1000), true);

    process.env.TODOTODOLIST_PASSWORD = "new password";
    assert.equal(await verifySimpleSessionToken(token, now + 1000), false);
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
    restoreEnv("TODOTODOLIST_AUTH_SECRET", originalSecret);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
