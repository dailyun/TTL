import assert from "node:assert/strict";
import test from "node:test";
import { POST as login } from "../app/api/auth/login/route.js";
import { POST as logout } from "../app/api/auth/logout/route.js";
import { resetLoginAttemptsForTests } from "../src/auth/login-attempts.js";

test("login route does not cache successful password response", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;
  const originalSecret = process.env.TODOTODOLIST_AUTH_SECRET;

  try {
    resetLoginAttemptsForTests();
    process.env.TODOTODOLIST_PASSWORD = "correct password";
    process.env.TODOTODOLIST_AUTH_SECRET = "test-secret";

    const response = await login(
      new Request("http://127.0.0.1:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.10"
        },
        body: JSON.stringify({ password: "correct password" })
      })
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie") ?? "", /tdl_session=/);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
    restoreEnv("TODOTODOLIST_AUTH_SECRET", originalSecret);
    resetLoginAttemptsForTests();
  }
});

test("login route does not cache failed password response", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;

  try {
    resetLoginAttemptsForTests();
    process.env.TODOTODOLIST_PASSWORD = "correct password";

    const response = await login(
      new Request("http://127.0.0.1:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.11"
        },
        body: JSON.stringify({ password: "wrong password" })
      })
    );

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
    resetLoginAttemptsForTests();
  }
});

test("rotating untrusted forwarding headers does not bypass login lockout", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;
  const originalTrustProxy = process.env.TODOTODOLIST_TRUST_PROXY;

  try {
    resetLoginAttemptsForTests();
    process.env.TODOTODOLIST_PASSWORD = "correct password";
    delete process.env.TODOTODOLIST_TRUST_PROXY;

    for (let index = 0; index < 4; index += 1) {
      const response = await failedLogin(`192.0.2.${index + 1}`);
      assert.equal(response.status, 401);
    }

    const locked = await failedLogin("198.51.100.200");
    assert.equal(locked.status, 429);
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
    restoreEnv("TODOTODOLIST_TRUST_PROXY", originalTrustProxy);
    resetLoginAttemptsForTests();
  }
});

test("logout route clears session without caching response", async () => {
  const response = await logout();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie") ?? "", /tdl_session=;/);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function failedLogin(forwardedFor: string): Promise<Response> {
  return login(
    new Request("http://127.0.0.1:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": forwardedFor
      },
      body: JSON.stringify({ password: "wrong password" })
    })
  );
}
