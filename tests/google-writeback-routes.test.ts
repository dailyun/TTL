import assert from "node:assert/strict";
import test from "node:test";
import { POST as writeBackGoogleEvent } from "../app/api/google-calendar/writeback-event/route.js";
import type { Item } from "../src/domain/types.js";

test("Google Calendar writeback maps stale etag responses to conflict", async () => {
  const restoreEnv = withGoogleEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "access-token" }), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    }

    return new Response(JSON.stringify({ error: { message: "Precondition Failed" } }), {
      headers: { "content-type": "application/json" },
      status: 412,
      statusText: "Precondition Failed"
    });
  }) as typeof fetch;

  try {
    const response = await writeBackGoogleEvent(
      new Request("http://127.0.0.1:3000/api/google-calendar/writeback-event", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ item: googleItem() })
      })
    );
    const payload = (await response.json()) as { error?: string };

    assert.equal(response.status, 409);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(payload.error ?? "", /远端更新/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

function googleItem(): Item {
  const now = "2026-07-07T00:00:00.000Z";
  return {
    id: "google_primary_event",
    type: "event",
    title: "Updated",
    description: "",
    sectionId: "work",
    status: "active",
    tags: ["google-calendar"],
    source: "google_calendar",
    sourceLink: {
      provider: "google_calendar",
      sourceId: "google-calendar",
      calendarId: "primary",
      eventId: "event",
      etag: "\"stale\"",
      writeBack: "none"
    },
    startAt: "2026-07-07T01:00:00.000Z",
    endAt: "2026-07-07T02:00:00.000Z",
    createdAt: now,
    updatedAt: now
  };
}

function withGoogleEnv(): () => void {
  const original = {
    GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID,
    GOOGLE_CALENDAR_SECTION: process.env.GOOGLE_CALENDAR_SECTION,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN
  };

  process.env.GOOGLE_CALENDAR_ID = "primary";
  process.env.GOOGLE_CALENDAR_SECTION = "work";
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://127.0.0.1:3000/api/google-calendar/oauth/callback";
  process.env.GOOGLE_REFRESH_TOKEN = "refresh-token";

  return () => {
    restoreEnv("GOOGLE_CALENDAR_ID", original.GOOGLE_CALENDAR_ID);
    restoreEnv("GOOGLE_CALENDAR_SECTION", original.GOOGLE_CALENDAR_SECTION);
    restoreEnv("GOOGLE_CLIENT_ID", original.GOOGLE_CLIENT_ID);
    restoreEnv("GOOGLE_CLIENT_SECRET", original.GOOGLE_CLIENT_SECRET);
    restoreEnv("GOOGLE_REDIRECT_URI", original.GOOGLE_REDIRECT_URI);
    restoreEnv("GOOGLE_REFRESH_TOKEN", original.GOOGLE_REFRESH_TOKEN);
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
