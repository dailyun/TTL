import assert from "node:assert/strict";
import test from "node:test";
import { itemDisplayStatus } from "../src/domain/calendar-history.js";
import type { Item } from "../src/domain/types.js";

const now = new Date(2026, 8, 18, 14);
const event: Item = {
  id: "history-demo", type: "event", title: "Demo calendar event", description: "", sectionId: "work",
  status: "active", source: "google_calendar", tags: [],
  startAt: new Date(2026, 8, 17, 12).toISOString(), endAt: new Date(2026, 8, 17, 13).toISOString(),
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z"
};

test("existing and newly imported past events leave active without claiming completion or mutating data", () => {
  const before = structuredClone(event);
  assert.equal(itemDisplayStatus(event, now), "history");
  assert.deepEqual(event, before);
  assert.equal(itemDisplayStatus({ ...event, endAt: now.toISOString() }, now), "history");
});

test("future and ongoing events stay active and move back out of history when rescheduled", () => {
  assert.equal(itemDisplayStatus({ ...event, endAt: new Date(now.getTime() + 60_000).toISOString() }, now), "active");
  assert.equal(itemDisplayStatus({ ...event, startAt: "2026-09-20T12:00:00Z", endAt: "2026-09-20T13:00:00Z" }, now), "active");
});

test("all-day history uses the inclusive last calendar day", () => {
  assert.equal(itemDisplayStatus({ ...event, allDay: true, endAt: "2026-09-18T00:00:00Z" }, now), "active");
  assert.equal(itemDisplayStatus({ ...event, allDay: true, endAt: "2026-09-17T00:00:00Z" }, now), "history");
});

test("owner decisions and ordinary overdue actions retain their status", () => {
  for (const status of ["done", "paused", "abandoned", "wanted"] as const) {
    assert.equal(itemDisplayStatus({ ...event, status }, now), status);
  }
  assert.equal(itemDisplayStatus({ ...event, source: "local" }, now), "active");
  assert.equal(itemDisplayStatus({ ...event, type: "todo" }, now), "active");
  assert.equal(itemDisplayStatus({ ...event, goalTreeLink: { treeId: "demo", nodeId: "action" } }, now), "active");
  assert.equal(itemDisplayStatus({ ...event, endAt: undefined }, now), "active");
  assert.equal(itemDisplayStatus({ ...event, endAt: "invalid" }, now), "active");
});
