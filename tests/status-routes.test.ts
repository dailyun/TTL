import assert from "node:assert/strict";
import test from "node:test";
import { GET as githubStatus } from "../app/api/github/status/route.js";
import { GET as googleStatus } from "../app/api/google-calendar/status/route.js";
import { GET as health } from "../app/api/health/route.js";

test("health response is not cached", async () => {
  const response = health();
  const payload = (await response.json()) as { ok?: boolean; service?: string };

  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.ok, true);
  assert.equal(payload.service, "todotodolist");
});

test("GitHub status response is not cached and does not expose token", async () => {
  const originalEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_OWNER: process.env.GITHUB_OWNER,
    GITHUB_REPO: process.env.GITHUB_REPO
  };

  try {
    process.env.GITHUB_TOKEN = "dummy-token";
    process.env.GITHUB_OWNER = "owner";
    process.env.GITHUB_REPO = "repo";

    const response = githubStatus();
    const text = await response.text();
    const payload = JSON.parse(text) as { configured?: boolean; hasToken?: boolean };

    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.configured, true);
    assert.equal(payload.hasToken, true);
    assert.equal(text.includes("dummy-token"), false);
  } finally {
    restoreEnv("GITHUB_TOKEN", originalEnv.GITHUB_TOKEN);
    restoreEnv("GITHUB_OWNER", originalEnv.GITHUB_OWNER);
    restoreEnv("GITHUB_REPO", originalEnv.GITHUB_REPO);
  }
});

test("Google Calendar status response is not cached and does not expose secrets", async () => {
  const originalEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN
  };

  try {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret-value";
    process.env.GOOGLE_REDIRECT_URI = "http://127.0.0.1:3000/api/google-calendar/oauth/callback";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh-token-value";

    const response = googleStatus();
    const text = await response.text();
    const payload = JSON.parse(text) as {
      hasClientSecret?: boolean;
      hasRefreshToken?: boolean;
      importConfigured?: boolean;
    };

    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.importConfigured, true);
    assert.equal(payload.hasClientSecret, true);
    assert.equal(payload.hasRefreshToken, true);
    assert.equal(text.includes("client-secret-value"), false);
    assert.equal(text.includes("refresh-token-value"), false);
  } finally {
    restoreEnv("GOOGLE_CLIENT_ID", originalEnv.GOOGLE_CLIENT_ID);
    restoreEnv("GOOGLE_CLIENT_SECRET", originalEnv.GOOGLE_CLIENT_SECRET);
    restoreEnv("GOOGLE_REDIRECT_URI", originalEnv.GOOGLE_REDIRECT_URI);
    restoreEnv("GOOGLE_REFRESH_TOKEN", originalEnv.GOOGLE_REFRESH_TOKEN);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
