import assert from "node:assert/strict";
import test from "node:test";
import {
  checkLoginAttempt,
  clearLoginAttempts,
  recordFailedLoginAttempt,
  resetLoginAttemptsForTests
} from "../src/auth/login-attempts.js";

test("login attempts lock after repeated failures and recover after window", () => {
  resetLoginAttemptsForTests();
  const key = "127.0.0.1";
  const now = Date.UTC(2026, 6, 7, 12, 0, 0);

  assert.deepEqual(checkLoginAttempt(key, now), { allowed: true, remainingAttempts: 5 });
  for (let index = 0; index < 4; index += 1) {
    assert.equal(recordFailedLoginAttempt(key, now + index).allowed, true);
  }

  const locked = recordFailedLoginAttempt(key, now + 4);
  assert.equal(locked.allowed, false);
  assert.deepEqual(checkLoginAttempt(key, now + 5), {
    allowed: false,
    retryAfterSeconds: 900
  });

  assert.deepEqual(checkLoginAttempt(key, now + 15 * 60 * 1000 + 5), {
    allowed: true,
    remainingAttempts: 5
  });
});

test("successful login can clear previous failed attempts", () => {
  resetLoginAttemptsForTests();
  const key = "127.0.0.1";
  const now = Date.UTC(2026, 6, 7, 12, 0, 0);

  recordFailedLoginAttempt(key, now);
  recordFailedLoginAttempt(key, now + 1);
  assert.deepEqual(checkLoginAttempt(key, now + 2), {
    allowed: true,
    remainingAttempts: 3
  });

  clearLoginAttempts(key);
  assert.deepEqual(checkLoginAttempt(key, now + 3), {
    allowed: true,
    remainingAttempts: 5
  });
});

test("partial failed attempts expire after the lockout window", () => {
  resetLoginAttemptsForTests();
  const key = "127.0.0.1";
  const now = Date.UTC(2026, 6, 7, 12, 0, 0);

  recordFailedLoginAttempt(key, now);
  recordFailedLoginAttempt(key, now + 1);
  assert.deepEqual(checkLoginAttempt(key, now + 2), {
    allowed: true,
    remainingAttempts: 3
  });
  assert.deepEqual(checkLoginAttempt(key, now + 15 * 60 * 1000 + 2), {
    allowed: true,
    remainingAttempts: 5
  });
});
