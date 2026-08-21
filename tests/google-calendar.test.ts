import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  GoogleCalendarApiError,
  googleCalendarEventToItem,
  googleCalendarPatchFromItem,
  listGoogleCalendarEvents,
  patchGoogleCalendarEvent
} from "../src/google-calendar/client.js";

test("maps timed Google Calendar events to workspace items", () => {
  const item = googleCalendarEventToItem({
    calendarId: "primary",
    sectionId: "work",
    event: {
      id: "abc123",
      etag: "\"etag\"",
      summary: "Planning Review",
      description: "Discuss roadmap",
      location: "Meeting Room",
      htmlLink: "https://calendar.google.com/event?eid=abc",
      start: { dateTime: "2026-07-07T10:00:00+08:00" },
      end: { dateTime: "2026-07-07T11:00:00+08:00" },
      created: "2026-07-01T00:00:00.000Z",
      updated: "2026-07-02T00:00:00.000Z"
    }
  });

  assert.ok(item);
  assert.equal(item.id, "google_primary_abc123");
  assert.equal(item.source, "google_calendar");
  assert.equal(item.sourceLink?.eventId, "abc123");
  assert.equal(item.startAt, "2026-07-07T02:00:00.000Z");
  assert.equal(item.endAt, "2026-07-07T03:00:00.000Z");
  assert.equal(item.allDay, false);
  assert.match(item.description, /Discuss roadmap/);
  assert.match(item.description, /Meeting Room/);
});

test("marks imported Google Calendar events as done after their end time", () => {
  const item = googleCalendarEventToItem({
    calendarId: "primary",
    sectionId: "work",
    now: new Date("2026-07-07T03:30:00.000Z"),
    event: {
      id: "past-event",
      summary: "Finished review",
      start: { dateTime: "2026-07-07T10:00:00+08:00" },
      end: { dateTime: "2026-07-07T11:00:00+08:00" }
    }
  });

  assert.ok(item);
  assert.equal(item.status, "done");
});

test("keeps active Google Calendar events active before their end time", () => {
  const item = googleCalendarEventToItem({
    calendarId: "primary",
    sectionId: "work",
    now: new Date("2026-07-07T02:30:00.000Z"),
    event: {
      id: "current-event",
      summary: "Current review",
      start: { dateTime: "2026-07-07T10:00:00+08:00" },
      end: { dateTime: "2026-07-07T11:00:00+08:00" }
    }
  });

  assert.ok(item);
  assert.equal(item.status, "active");
});

test("maps all-day Google Calendar end dates from exclusive to inclusive", () => {
  const item = googleCalendarEventToItem({
    calendarId: "primary",
    sectionId: "work",
    event: {
      id: "all-day",
      summary: "Two day offsite",
      start: { date: "2026-07-07" },
      end: { date: "2026-07-09" }
    }
  });

  assert.ok(item);
  assert.equal(item.allDay, true);
  assert.equal(item.startAt, "2026-07-07T00:00:00.000Z");
  assert.equal(item.endAt, "2026-07-08T00:00:00.000Z");
});

test("marks imported all-day events as done after their exclusive end date", () => {
  const item = googleCalendarEventToItem({
    calendarId: "primary",
    sectionId: "work",
    now: new Date("2026-07-09T01:00:00.000Z"),
    event: {
      id: "past-all-day",
      summary: "Past all-day event",
      start: { date: "2026-07-07" },
      end: { date: "2026-07-09" }
    }
  });

  assert.ok(item);
  assert.equal(item.status, "done");
});

test("maps cancelled Google Calendar events to local delete markers", () => {
  const item = googleCalendarEventToItem({
    calendarId: "primary",
    sectionId: "work",
    event: {
      id: "cancelled",
      etag: "\"cancelled\"",
      status: "cancelled",
      summary: "Cancelled",
      updated: "2026-07-07T12:00:00.000Z"
    }
  });

  assert.ok(item);
  assert.equal(item.id, "google_primary_cancelled");
  assert.equal(item.status, "abandoned");
  assert.equal(item.deletedAt, "2026-07-07T12:00:00.000Z");
  assert.equal(item.updatedAt, "2026-07-07T12:00:00.000Z");
  assert.equal(item.sourceLink?.eventId, "cancelled");
  assert.equal(item.sourceLink?.etag, "\"cancelled\"");
});

test("builds Google Calendar patch for timed workspace items", () => {
  const patch = googleCalendarPatchFromItem({
    id: "google_primary_abc123",
    type: "event",
    title: "Moved Review",
    description: "",
    sectionId: "work",
    status: "active",
    tags: ["google-calendar"],
    source: "google_calendar",
    sourceLink: {
      provider: "google_calendar",
      sourceId: "google-calendar",
      calendarId: "primary",
      eventId: "abc123",
      writeBack: "none"
    },
    startAt: "2026-07-08T02:00:00.000Z",
    endAt: "2026-07-08T03:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z"
  });

  assert.deepEqual(patch, {
    summary: "Moved Review",
    description: "",
    start: { dateTime: "2026-07-08T02:00:00.000Z" },
    end: { dateTime: "2026-07-08T03:00:00.000Z" }
  });
});

test("builds Google Calendar patch for all-day workspace items", () => {
  const patch = googleCalendarPatchFromItem({
    id: "google_primary_all_day",
    type: "event",
    title: "Two day offsite",
    description: "",
    sectionId: "work",
    status: "active",
    tags: ["google-calendar"],
    source: "google_calendar",
    sourceLink: {
      provider: "google_calendar",
      sourceId: "google-calendar",
      calendarId: "primary",
      eventId: "all-day",
      writeBack: "none"
    },
    allDay: true,
    startAt: "2026-07-07T00:00:00.000Z",
    endAt: "2026-07-08T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z"
  });

  assert.deepEqual(patch, {
    summary: "Two day offsite",
    description: "",
    start: { date: "2026-07-07" },
    end: { date: "2026-07-09" }
  });
});

test("creates Google Calendar events through insert endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify({ id: "created-event", etag: "\"created\"" }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  }) as typeof fetch;

  try {
    const event = await createGoogleCalendarEvent({
      accessToken: "access-token",
      calendarId: "primary",
      event: {
        summary: "Planning",
        description: "Discuss launch",
        start: { dateTime: "2026-07-08T02:00:00.000Z" },
        end: { dateTime: "2026-07-08T03:00:00.000Z" }
      }
    });

    assert.equal(event.id, "created-event");
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].input,
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none"
    );
    assert.equal(requests[0].init?.method, "POST");
    assert.equal((requests[0].init?.headers as Record<string, string>).authorization, "Bearer access-token");
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      summary: "Planning",
      description: "Discuss launch",
      start: { dateTime: "2026-07-08T02:00:00.000Z" },
      end: { dateTime: "2026-07-08T03:00:00.000Z" }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("patches Google Calendar events with etag preconditions", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify({ id: "existing-event", etag: "\"next\"" }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  }) as typeof fetch;

  try {
    const event = await patchGoogleCalendarEvent({
      accessToken: "access-token",
      calendarId: "primary",
      eventId: "existing-event",
      etag: "\"previous\"",
      patch: {
        summary: "Updated"
      }
    });

    assert.equal(event.etag, "\"next\"");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init?.method, "PATCH");
    assert.equal((requests[0].init?.headers as Record<string, string>)["if-match"], "\"previous\"");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Calendar precondition failures preserve status for conflict handling", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "Precondition Failed" } }), {
      headers: { "content-type": "application/json" },
      status: 412,
      statusText: "Precondition Failed"
    })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        patchGoogleCalendarEvent({
          accessToken: "access-token",
          calendarId: "primary",
          eventId: "existing-event",
          etag: "\"stale\"",
          patch: {
            summary: "Updated"
          }
        }),
      (error: unknown) =>
        error instanceof GoogleCalendarApiError &&
        error.status === 412 &&
        /Precondition Failed/.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lists Google Calendar events including deleted events", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  }) as typeof fetch;

  try {
    await listGoogleCalendarEvents({
      accessToken: "access-token",
      calendarId: "primary",
      timeMin: "2026-07-01T00:00:00.000Z",
      timeMax: "2026-08-01T00:00:00.000Z"
    });

    assert.equal(requests.length, 1);
    const url = new URL(requests[0]);
    assert.equal(url.searchParams.get("showDeleted"), "true");
    assert.equal(url.searchParams.get("singleEvents"), "true");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deletes Google Calendar events through delete endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await deleteGoogleCalendarEvent({
      accessToken: "access-token",
      calendarId: "primary",
      eventId: "created-event",
      etag: "\"created\""
    });

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].input,
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/created-event?sendUpdates=none"
    );
    assert.equal(requests[0].init?.method, "DELETE");
    assert.equal((requests[0].init?.headers as Record<string, string>).authorization, "Bearer access-token");
    assert.equal((requests[0].init?.headers as Record<string, string>)["if-match"], "\"created\"");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("treats already-deleted Google Calendar events as delete success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Gone" }), { status: 410 })) as typeof fetch;

  try {
    await deleteGoogleCalendarEvent({
      accessToken: "access-token",
      calendarId: "primary",
      eventId: "already-deleted"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
