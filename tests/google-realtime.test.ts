import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acceptGoogleCalendarNotification,
  acknowledgeGoogleCalendarDelivery,
  syncGoogleCalendarRealtime
} from "../src/google-calendar/realtime.js";
import {
  readGoogleCalendarSyncState,
  writeGoogleCalendarSyncState
} from "../src/google-calendar/sync-state.js";
import type { Item } from "../src/domain/types.js";

test("accepts only notifications matching the persisted Google watch channel", async () => {
  const fixture = syncStateFixture();
  try {
    writeGoogleCalendarSyncState({
      version: 1,
      calendarId: "primary",
      pendingItems: [],
      deliveryVersion: 0,
      channel: {
        id: "channel-id",
        resourceId: "resource-id",
        token: "channel-token",
        createdAt: "2026-09-04T00:00:00.000Z",
        expiration: "1789000000000"
      }
    });

    const rejected = await acceptGoogleCalendarNotification(new Headers({
      "x-goog-channel-id": "channel-id",
      "x-goog-channel-token": "wrong-token",
      "x-goog-resource-id": "resource-id",
      "x-goog-resource-state": "exists"
    }));
    assert.equal(rejected.accepted, false);

    const accepted = await acceptGoogleCalendarNotification(new Headers({
      "x-goog-channel-id": "channel-id",
      "x-goog-channel-token": "channel-token",
      "x-goog-resource-id": "resource-id",
      "x-goog-resource-state": "exists",
      "x-goog-message-number": "7"
    }), new Date("2026-09-04T01:00:00.000Z"));
    assert.deepEqual(accepted, { accepted: true, shouldSync: true });

    const state = readGoogleCalendarSyncState("primary");
    assert.equal(state.dirtyAt, "2026-09-04T01:00:00.000Z");
    assert.equal(state.lastNotificationNumber, "7");
  } finally {
    fixture.restore();
  }
});

test("keeps pending Google changes until the matching delivery version is acknowledged", async () => {
  const fixture = syncStateFixture();
  try {
    writeGoogleCalendarSyncState({
      version: 1,
      calendarId: "primary",
      pendingItems: [googleItem()],
      deliveryVersion: 3
    });

    assert.equal(await acknowledgeGoogleCalendarDelivery(2), false);
    assert.equal(readGoogleCalendarSyncState("primary").pendingItems.length, 1);
    assert.equal(await acknowledgeGoogleCalendarDelivery(3), true);
    assert.equal(readGoogleCalendarSyncState("primary").pendingItems.length, 0);
  } finally {
    fixture.restore();
  }
});

test("recovers from an expired Google sync token with a new bounded full sync", async () => {
  const fixture = syncStateFixture();
  const originalFetch = globalThis.fetch;
  const eventRequests: string[] = [];
  try {
    writeGoogleCalendarSyncState({
      version: 1,
      calendarId: "primary",
      syncToken: "expired-sync-token",
      pendingItems: [],
      deliveryVersion: 0,
      dirtyAt: "2026-09-04T00:00:00.000Z"
    });
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "access-token" });
      }
      eventRequests.push(url);
      if (new URL(url).searchParams.get("syncToken")) {
        return Response.json({ error: { message: "Sync token is no longer valid" } }, { status: 410 });
      }
      return Response.json({
        items: [{
          id: "event-1",
          summary: "Recovered event",
          start: { dateTime: "2026-09-05T10:00:00+08:00" },
          end: { dateTime: "2026-09-05T11:00:00+08:00" },
          updated: "2026-09-04T01:00:00.000Z"
        }],
        nextSyncToken: "fresh-sync-token"
      });
    }) as typeof fetch;

    const result = await syncGoogleCalendarRealtime({
      force: true,
      now: new Date("2026-09-04T02:00:00.000Z")
    });

    assert.equal(result.mode, "full");
    assert.equal(result.items[0]?.title, "Recovered event");
    assert.equal(eventRequests.length, 2);
    assert.equal(new URL(eventRequests[0]!).searchParams.get("syncToken"), "expired-sync-token");
    assert.equal(new URL(eventRequests[1]!).searchParams.has("timeMin"), true);
    assert.equal(readGoogleCalendarSyncState("primary").syncToken, "fresh-sync-token");
  } finally {
    globalThis.fetch = originalFetch;
    fixture.restore();
  }
});

function syncStateFixture() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tdl-google-realtime-"));
  const originalEnv = {
    GOOGLE_CALENDAR_SYNC_STATE_PATH: process.env.GOOGLE_CALENDAR_SYNC_STATE_PATH,
    GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
    GOOGLE_REFRESH_TOKEN_PATH: process.env.GOOGLE_REFRESH_TOKEN_PATH
  };
  process.env.GOOGLE_CALENDAR_SYNC_STATE_PATH = path.join(temporaryDirectory, "state.json");
  process.env.GOOGLE_CALENDAR_ID = "primary";
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_REDIRECT_URI = "https://todo.example.com/api/google-calendar/oauth/callback";
  process.env.GOOGLE_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_REFRESH_TOKEN_PATH = path.join(temporaryDirectory, "refresh-token.json");

  return {
    restore() {
      Object.entries(originalEnv).forEach(([key, value]) => restoreEnv(key, value));
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  };
}

function googleItem(): Item {
  return {
    id: "google_primary_event-1",
    type: "event",
    title: "Changed event",
    description: "",
    sectionId: "work",
    status: "active",
    tags: ["google-calendar"],
    source: "google_calendar",
    sourceLink: {
      provider: "google_calendar",
      sourceId: "google-calendar",
      calendarId: "primary",
      eventId: "event-1",
      writeBack: "none"
    },
    startAt: "2026-09-04T02:00:00.000Z",
    endAt: "2026-09-04T03:00:00.000Z",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T01:00:00.000Z"
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
