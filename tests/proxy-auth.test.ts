import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.js";

test("proxy rejects unauthenticated protected API requests without caching", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;
  const originalSecret = process.env.TODOTODOLIST_AUTH_SECRET;

  try {
    process.env.TODOTODOLIST_PASSWORD = "correct password";
    process.env.TODOTODOLIST_AUTH_SECRET = "test-secret";

    const response = await proxy(
      new NextRequest("http://127.0.0.1:3000/api/github/snapshot")
    );
    const payload = (await response.json()) as { error?: string };

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.error, "unauthorized");
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
    restoreEnv("TODOTODOLIST_AUTH_SECRET", originalSecret);
  }
});


test("proxy lets the token-authenticated external API handle its own authentication", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;

  try {
    process.env.TODOTODOLIST_PASSWORD = "correct password";
    const response = await proxy(new NextRequest("http://127.0.0.1:3000/api/v1/items"));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  } finally {
    restoreEnv("TODOTODOLIST_PASSWORD", originalPassword);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
