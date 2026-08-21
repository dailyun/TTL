import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToDateKey,
  allDayDateKeyFromIso,
  allDayIsoFromDateKey
} from "../src/calendar/all-day.js";

test("all-day date keys round-trip without using the local timezone", () => {
  assert.equal(allDayIsoFromDateKey("2026-07-10"), "2026-07-10T00:00:00.000Z");
  assert.equal(allDayDateKeyFromIso("2026-07-10T00:00:00.000Z"), "2026-07-10");
});

test("all-day date arithmetic stays on calendar dates", () => {
  assert.equal(addDaysToDateKey("2026-03-08", 1), "2026-03-09");
  assert.equal(addDaysToDateKey("2026-11-01", -1), "2026-10-31");
  assert.equal(allDayIsoFromDateKey("2026-02-30"), undefined);
});
