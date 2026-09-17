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

test("proxy lets Google Calendar webhook requests validate their channel token", async () => {
  const originalPassword = process.env.TODOTODOLIST_PASSWORD;

  try {
    process.env.TODOTODOLIST_PASSWORD = "correct password";
    const response = await proxy(new NextRequest("https://todo.example.com/api/google-calendar/webhook", {
      method: "POST"
    }));
    assert.equal(response.headers.get("x-middleware-next"), "1");

    const lookalike = await proxy(new NextRequest("https://todo.example.com/api/google-calendar/webhook-admin", {
      method: "POST"
    }));
    assert.equal(lookalike.status, 401);
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

test("legacy OAuth relay does not require a legacy-domain session; current domain still authenticates", async () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, { TODOTODOLIST_PASSWORD: "test-password", TODOTODOLIST_PUBLIC_URL: "https://todo.example.com", GOOGLE_REDIRECT_URI: "https://old.example.org/api/google-calendar/oauth/callback" });
    const old = await proxy(new NextRequest("https://old.example.org/api/google-calendar/oauth/callback?code=test&state=test"));
    assert.equal(old.status, 303);
    const current = await proxy(new NextRequest(old.headers.get("location")!));
    assert.equal(current.status, 307);
    const login = new URL(current.headers.get("location")!);
    assert.equal(login.pathname, "/login"); assert.equal(login.searchParams.get("next"), "/api/google-calendar/oauth/start");
    assert.equal(login.searchParams.has("code"), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
