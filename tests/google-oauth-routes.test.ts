import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GET as googleOAuthCallback } from "../app/api/google-calendar/oauth/callback/route.js";
import { GET as googleOAuthStart } from "../app/api/google-calendar/oauth/start/route.js";

test("Google OAuth start redirects with state cookie without caching", () => {
  const originalEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI
  };

  try {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_REDIRECT_URI = "http://127.0.0.1:3000/api/google-calendar/oauth/callback";

    const response = googleOAuthStart(new Request("http://127.0.0.1:3000/api/google-calendar/oauth/start"));
    const redirectUrl = new URL(response.headers.get("location") ?? "");

    assert.equal(response.status, 307);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie") ?? "", /tdl_google_oauth_state=/);
    assert.equal(redirectUrl.hostname, "accounts.google.com");
    assert.equal(redirectUrl.searchParams.get("client_id"), "client-id");
    assert.equal(redirectUrl.searchParams.get("access_type"), "offline");
  } finally {
    restoreEnv("GOOGLE_CLIENT_ID", originalEnv.GOOGLE_CLIENT_ID);
    restoreEnv("GOOGLE_CLIENT_SECRET", originalEnv.GOOGLE_CLIENT_SECRET);
    restoreEnv("GOOGLE_REDIRECT_URI", originalEnv.GOOGLE_REDIRECT_URI);
  }
});

test("Google OAuth callback returns refresh token page without caching", async () => {
  const originalEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_REFRESH_TOKEN_PATH: process.env.GOOGLE_REFRESH_TOKEN_PATH,
    GOOGLE_CALENDAR_SYNC_STATE_PATH: process.env.GOOGLE_CALENDAR_SYNC_STATE_PATH
  };
  const originalFetch = globalThis.fetch;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tdl-google-oauth-"));
  const tokenPath = path.join(tempDir, "token.json");
  const syncStatePath = path.join(tempDir, "sync-state.json");

  try {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_REDIRECT_URI = "http://127.0.0.1:3000/api/google-calendar/oauth/callback";
    process.env.GOOGLE_REFRESH_TOKEN_PATH = tokenPath;
    process.env.GOOGLE_CALENDAR_SYNC_STATE_PATH = syncStatePath;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer"
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200
        }
      )) as typeof fetch;

    const response = await googleOAuthCallback(
      new Request("http://127.0.0.1:3000/api/google-calendar/oauth/callback?code=code&state=state", {
        headers: {
          cookie: "tdl_google_oauth_state=state"
        }
      })
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie") ?? "", /tdl_google_oauth_state=;/);
    assert.doesNotMatch(await response.text(), /refresh-token/);
    const savedToken = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
      refreshToken?: string;
      updatedAt?: string;
    };
    assert.equal(savedToken.refreshToken, "refresh-token");
    assert.equal(typeof savedToken.updatedAt, "string");
    const syncState = JSON.parse(fs.readFileSync(syncStatePath, "utf8")) as {
      calendarId?: string;
      pendingItems?: unknown[];
    };
    assert.equal(syncState.calendarId, "primary");
    assert.deepEqual(syncState.pendingItems, []);
  } finally {
    restoreEnv("GOOGLE_CLIENT_ID", originalEnv.GOOGLE_CLIENT_ID);
    restoreEnv("GOOGLE_CLIENT_SECRET", originalEnv.GOOGLE_CLIENT_SECRET);
    restoreEnv("GOOGLE_REDIRECT_URI", originalEnv.GOOGLE_REDIRECT_URI);
    restoreEnv("GOOGLE_REFRESH_TOKEN_PATH", originalEnv.GOOGLE_REFRESH_TOKEN_PATH);
    restoreEnv("GOOGLE_CALENDAR_SYNC_STATE_PATH", originalEnv.GOOGLE_CALENDAR_SYNC_STATE_PATH);
    globalThis.fetch = originalFetch;
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test("legacy callback relays to public domain, then validates its state cookie before exchange", async () => {
  const savedEnv = { ...process.env }, originalFetch = globalThis.fetch;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tdl-oauth-domain-"));
  let exchanges = 0;
  try {
    Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
      GOOGLE_REDIRECT_URI: "https://old.example.org/api/google-calendar/oauth/callback", TODOTODOLIST_PUBLIC_URL: "https://todo.example.com",
      GOOGLE_REFRESH_TOKEN_PATH: path.join(directory, "token.json"), GOOGLE_CALENDAR_SYNC_STATE_PATH: path.join(directory, "sync.json") });
    delete process.env.TODOTODOLIST_STATE_PATH;
    globalThis.fetch = async (_url, init) => {
      exchanges++;
      assert.equal(new URLSearchParams(String(init?.body)).get("redirect_uri"), process.env.GOOGLE_REDIRECT_URI);
      return Response.json({ access_token: "test-access", refresh_token: "test-refresh", token_type: "Bearer" });
    };
    const start = googleOAuthStart(new Request("https://todo.example.com/api/google-calendar/oauth/start"));
    const authorization = new URL(start.headers.get("location")!);
    const state = authorization.searchParams.get("state")!;
    const legacy = new URL(authorization.searchParams.get("redirect_uri")!);
    legacy.search = new URLSearchParams({ code: "test-code", state, next: "https://untrusted.example" }).toString();
    const relay = await googleOAuthCallback(new Request(legacy));
    assert.equal(relay.status, 303); assert.equal(exchanges, 0);
    const destination = new URL(relay.headers.get("location")!);
    assert.equal(destination.origin, "https://todo.example.com"); assert.equal(destination.searchParams.get("state"), state);
    assert.equal(destination.searchParams.has("next"), false);
    assert.equal(relay.headers.get("referrer-policy"), "no-referrer");
    const missing = await googleOAuthCallback(new Request(destination));
    assert.equal(missing.status, 400); assert.equal(exchanges, 0);
    assert.match(await missing.text(), /重新连接/);
    const wrong = await googleOAuthCallback(new Request(destination, { headers: { cookie: "tdl_google_oauth_state=other" } }));
    assert.equal(wrong.status, 400); assert.equal(exchanges, 0);
    const accepted = await googleOAuthCallback(new Request(destination, { headers: { cookie: start.headers.get("set-cookie")!.split(";")[0] } }));
    assert.equal(accepted.status, 200); assert.equal(exchanges, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "token.json"), "utf8")).refreshToken, "test-refresh");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv); globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("starting on the old domain redirects before creating the state cookie", () => {
  const publicUrl = process.env.TODOTODOLIST_PUBLIC_URL, redirect = process.env.GOOGLE_REDIRECT_URI;
  try {
    process.env.TODOTODOLIST_PUBLIC_URL = "https://todo.example.com";
    process.env.GOOGLE_REDIRECT_URI = "https://old.example.org/api/google-calendar/oauth/callback";
    const response = googleOAuthStart(new Request("https://old.example.org/api/google-calendar/oauth/start?next=https://untrusted.example"));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://todo.example.com/api/google-calendar/oauth/start");
    assert.equal(response.headers.has("set-cookie"), false);
    assert.equal(googleOAuthStart(new Request("https://untrusted.example/api/google-calendar/oauth/start")).status, 400);
  } finally { restoreEnv("TODOTODOLIST_PUBLIC_URL", publicUrl); restoreEnv("GOOGLE_REDIRECT_URI", redirect); }
});
