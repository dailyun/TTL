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
    GOOGLE_REFRESH_TOKEN_PATH: process.env.GOOGLE_REFRESH_TOKEN_PATH
  };
  const originalFetch = globalThis.fetch;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tdl-google-oauth-"));
  const tokenPath = path.join(tempDir, "token.json");

  try {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_REDIRECT_URI = "http://127.0.0.1:3000/api/google-calendar/oauth/callback";
    process.env.GOOGLE_REFRESH_TOKEN_PATH = tokenPath;
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
  } finally {
    restoreEnv("GOOGLE_CLIENT_ID", originalEnv.GOOGLE_CLIENT_ID);
    restoreEnv("GOOGLE_CLIENT_SECRET", originalEnv.GOOGLE_CLIENT_SECRET);
    restoreEnv("GOOGLE_REDIRECT_URI", originalEnv.GOOGLE_REDIRECT_URI);
    restoreEnv("GOOGLE_REFRESH_TOKEN_PATH", originalEnv.GOOGLE_REFRESH_TOKEN_PATH);
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
