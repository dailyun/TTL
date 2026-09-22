import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { calendarCommand, planSchema, planDates, readCalendar } from "../src/execution/calendar-api.js";
import { execution, scheduleToday, ensureReview, reconcileItems } from "../src/execution/core.js";
import { withCheckInState } from "../src/check-ins/store.js";
import { reconcileCalendar, processCalendarJobs } from "../src/execution/calendar.js";
import { answerCheckIn, feedbackFeed } from "../src/check-ins/service.js";
import { validateSnapshot } from "../src/local-db/db.js";

const now = new Date("2026-09-23T01:00:00Z"), options = { refresh: false, now };
const link = { treeId: "demo", nodeId: "practice" };
const plan = { kind: "plan", operationId: "plan-one", title: "演示面试", goalTreeLink: link, from: "2026-09-23", everyDays: 2, count: 7, times: ["19:00", "20:00"], durationMinutes: 60 };
async function isolated(task: () => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "calendar-api-")), env = { ...process.env }, originalFetch = global.fetch;
  process.env.TODOTODOLIST_STATE_PATH = path.join(directory, "state.json"); delete process.env.VERCEL;
  try { await task(); } finally { global.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); await rm(directory, { recursive: true, force: true }); }
}
async function commit(input: unknown) {
  const p = await calendarCommand({ ...(input as object), preview: true }, options);
  assert.equal(p.applied, false); assert.deepEqual((p as any).preview.conflicts, []);
  return calendarCommand({ ...(input as object), preview: false, previewToken: (p as any).previewToken }, options) as Promise<any>;
}
function imported(id = "series_1", start = "2026-09-23T11:00:00Z") {
  return { id, recurringEventId: "series", etag: "one", summary: "明确关联的演示", start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 3600000).toISOString() } };
}

test("Google imports are confirmed and a fresh read repairs legacy missing confirmation without changing times", () => isolated(async () => {
  await withCheckInState(s => {
    reconcileCalendar(s, [imported()], "primary", now);
    const o = execution(s).occurrences[0];
    assert.equal(o.calendarStatus, "confirmed");
    delete o.calendarStatus; // Legacy versions omitted this field on first import.
    const before = { startAt: o.startAt, endAt: o.endAt, itemId: o.itemId, state: o.state };
    reconcileCalendar(s, [imported()], "primary", now);
    assert.equal(o.calendarStatus, "confirmed");
    assert.deepEqual({ startAt: o.startAt, endAt: o.endAt, itemId: o.itemId, state: o.state }, before);
    assert.equal(execution(s).jobs.length, 0);
  });
  const linked = await commit({ kind: "link", operationId: "link", goalTreeLink: link, seriesId: "series", from: "2026-09-23", until: "2026-10-05" });
  assert.equal(linked.calendarConfirmed, true);
}));

test("bounded daily/every-two-day/weekday rules stop at inclusive dates and reject invalid ranges", () => {
  assert.deepEqual(planDates(planSchema.parse(plan)), ["2026-09-23", "2026-09-25", "2026-09-27", "2026-09-29", "2026-10-01", "2026-10-03", "2026-10-05"]);
  assert.equal(planDates(planSchema.parse({ ...plan, everyDays: 1, count: undefined, until: "2026-10-05" })).length, 13);
  assert.deepEqual(planDates(planSchema.parse({ ...plan, everyDays: 1, count: 3, weekdays: true, from: "2026-09-25" })), ["2026-09-25", "2026-09-28", "2026-09-29"]);
  assert.throws(() => planSchema.parse({ ...plan, from: "2026-02-30" }));
  assert.throws(() => planDates(planSchema.parse({ ...plan, until: "2026-09-24" })), /次数/);
});

test("preview is read-only, chooses alternate hours and skips transparent all-day events", () => isolated(async () => {
  await withCheckInState(s => { execution(s).calendar.events = [
    { id: "busy", start: { dateTime: "2026-09-23T11:00:00Z" }, end: { dateTime: "2026-09-23T11:45:00Z" } },
    { id: "anniversary", transparency: "transparent", start: { date: "2026-09-25" }, end: { date: "2026-09-26" } }
  ]; });
  const before = await withCheckInState(s => s, false);
  const p: any = await calendarCommand(plan, options);
  assert.equal(p.preview.slots[0].startAt, "2026-09-23T12:00:00.000Z");
  assert.equal(p.preview.slots[1].startAt, "2026-09-25T11:00:00.000Z");
  assert.deepEqual(await withCheckInState(s => s, false), before);
}));

test("commit is durable, concurrent identical requests deduplicate, other operation cannot double-book the node", () => isolated(async () => {
  const p: any = await calendarCommand(plan, options);
  const request = { ...plan, preview: false, previewToken: p.previewToken };
  const results = await Promise.all([calendarCommand(request, options), calendarCommand(request, options)]);
  assert.equal(results.every(r => r.applied), true);
  const state = await withCheckInState(s => s, false);
  assert.equal(state.workspace!.occurrences.length, 7); assert.equal(state.workspace!.snapshot.items.length, 1);
  assert.equal(state.workspace!.jobs.length, 7);
  assert.equal((results[0] as any).calendarConfirmed, false);
  validateSnapshot(state.workspace!.snapshot);
  const duplicate: any = await calendarCommand({ ...plan, operationId: "different" }, options);
  assert.equal(duplicate.preview.conflicts.length, 7);
  await assert.rejects(calendarCommand({ ...plan, title: "changed", preview: false }, options), /编号/);
}));

test("a fresh conflict invalidates preview and no partial series is saved", () => isolated(async () => {
  const p: any = await calendarCommand(plan, options);
  await withCheckInState(s => { execution(s).calendar.events.push({ id: "busy", start: { dateTime: "2026-09-23T11:00:00Z" }, end: { dateTime: "2026-09-23T13:00:00Z" } }); });
  const r: any = await calendarCommand({ ...plan, preview: false, previewToken: p.previewToken }, options);
  assert.equal(r.applied, false); assert.equal(r.preview.conflicts.length, 1);
  assert.equal(await withCheckInState(s => execution(s).jobs.length, false), 0);
}));

test("finite plans are never regenerated by daily scheduler; one completion does not finish the series", () => isolated(async () => {
  const r = await commit(plan), o = r.occurrences[0];
  await withCheckInState(s => { const w = execution(s); w.calendar.lastSyncAt = now.toISOString(); w.snapshot.items[0].autoSchedule = true;
    w.occurrences[0].state = "scheduled"; w.jobs[0].state = "done"; ensureReview(s, w.occurrences[0], w.snapshot.items[0], now); scheduleToday(s, now); });
  const feedback = await answerCheckIn(`review:${o.id}`, { id: "reply", outcome: "completed", text: "实际完成" });
  assert.deepEqual(feedback.goalTreeLink, link);
  const state = await withCheckInState(s => s, false);
  assert.equal(state.workspace!.occurrences.length, 7); assert.equal(state.workspace!.snapshot.items[0].status, "active");
}));

test("explicit series binding links existing/future reviews, resolves old feedback without rewriting it", () => isolated(async () => {
  await withCheckInState(s => reconcileCalendar(s, [imported()], "primary", now));
  const id = await withCheckInState(s => s.checkIns[0].id, false);
  const original = await answerCheckIn(id, { id: "reply", outcome: "partial", text: "原始反馈" });
  assert.equal(original.goalTreeLink, undefined);
  const bound = await commit({ kind: "link", operationId: "link-one", goalTreeLink: link, seriesId: "series", from: "2026-09-23", until: "2026-10-05" });
  assert.equal(bound.occurrences.length, 1);
  assert.deepEqual((await feedbackFeed(0, 10)).data[0].goalTreeLink, link);
  assert.deepEqual(await withCheckInState(s => s.feedback[0], false), JSON.parse(JSON.stringify(original)));
  await withCheckInState(s => reconcileCalendar(s, [imported(), imported("series_2", "2026-09-25T11:00:00Z")], "primary", now));
  const state = await withCheckInState(s => s, false);
  assert.equal(state.checkIns.length, 2); assert.deepEqual(state.checkIns[1].goalTreeLink, link);
  const corrected = await answerCheckIn(id, { id: "correction", supersedesId: "reply", outcome: "completed", text: "更正" });
  assert.deepEqual(corrected.goalTreeLink, link);
  await assert.rejects(commit({ kind: "link", operationId: "bad-link", goalTreeLink: { ...link, nodeId: "wrong" }, seriesId: "series", from: "2026-09-23", until: "2026-10-05" }), /关联/);
}));

test("description containing a node ID cannot grant a binding", () => isolated(async () => {
  await withCheckInState(s => reconcileCalendar(s, [{ ...imported(), description: "goalTreeLink demo/practice" }], "primary", now));
  assert.equal(await withCheckInState(s => s.checkIns[0].goalTreeLink, false), undefined);
}));

test("moving one instance requires its version; calendar confirmation and feedback are retained", () => isolated(async () => {
  await withCheckInState(s => reconcileCalendar(s, [imported(), imported("series_2", "2026-09-25T11:00:00Z")], "primary", now));
  await commit({ kind: "link", operationId: "link", goalTreeLink: link, seriesId: "series", from: "2026-09-23", until: "2026-10-05" });
  const before = await withCheckInState(s => s, false), o = before.workspace!.occurrences[0];
  const move = { kind: "move", operationId: "move", goalTreeLink: link, occurrenceId: o.id, expectedVersion: o.version, startAt: "2026-09-23T12:00:00Z", endAt: "2026-09-23T13:00:00Z" };
  await assert.rejects(calendarCommand({ ...move, expectedVersion: o.version - 1 }, options));
  const moved = await commit(move); assert.equal(moved.calendarConfirmed, false);
  const after = await withCheckInState(s => s, false);
  assert.deepEqual(after.workspace!.occurrences[1], before.workspace!.occurrences[1]);
  assert.equal(after.checkIns[0].dueAt, before.checkIns[0].dueAt);
  assert.equal(after.workspace!.jobs[0].ownerRequested, true);
}));

test("calendar write includes reminders; accepted create with a lost reply retries stable ID without duplication", () => isolated(async () => {
  await commit({ ...plan, count: 1 });
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_REDIRECT_URI: "https://example.invalid", GOOGLE_REFRESH_TOKEN: "test" });
  let saved: any, inserts = 0;
  global.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "test" });
    if (init?.method === "POST") { inserts++; saved = { ...JSON.parse(String(init.body)), etag: "saved", status: "confirmed" }; throw new Error("lost response"); }
    return saved ? Response.json(saved) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  await processCalendarJobs(now);
  assert.equal(await withCheckInState(s => execution(s).jobs[0].state, false), "failed");
  await processCalendarJobs(new Date(now.getTime() + 3600_000));
  assert.equal(inserts, 1); assert.deepEqual(saved.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] });
  const state = await withCheckInState(s => s, false);
  assert.equal(state.workspace!.jobs[0].state, "done"); assert.deepEqual(state.checkIns[0].goalTreeLink, link);
}));

test("lost PATCH response is recovered, while a later owner's edit is a conflict", () => isolated(async () => {
  await withCheckInState(s => reconcileCalendar(s, [imported()], "primary", now));
  await commit({ kind: "link", operationId: "link", goalTreeLink: link, seriesId: "series", from: "2026-09-23", until: "2026-10-05" });
  let o = await withCheckInState(s => execution(s).occurrences[0], false);
  await commit({ kind: "move", operationId: "move", goalTreeLink: link, occurrenceId: o.id, expectedVersion: o.version, startAt: "2026-09-23T12:00:00Z", endAt: "2026-09-23T13:00:00Z" });
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_REDIRECT_URI: "https://example.invalid", GOOGLE_REFRESH_TOKEN: "test" });
  let remote: any = imported(), patches = 0;
  global.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "test" });
    if (init?.method === "PATCH") { patches++; remote = { ...remote, ...JSON.parse(String(init.body)), etag: `patch-${patches}` }; throw new Error("lost PATCH reply"); }
    return Response.json(remote);
  }) as typeof fetch;
  await processCalendarJobs(now);
  await withCheckInState(s => reconcileItems(s, now));
  assert.equal(await withCheckInState(s => s.checkIns[0].dueAt, false), "2026-09-23T12:00:00.000Z");
  await processCalendarJobs(new Date(now.getTime() + 3600_000));
  assert.equal(patches, 1); assert.equal(await withCheckInState(s => execution(s).jobs[0].state, false), "done");
  o = await withCheckInState(s => execution(s).occurrences[0], false);
  await commit({ kind: "move", operationId: "move-again", goalTreeLink: link, occurrenceId: o.id, expectedVersion: o.version, startAt: "2026-09-23T13:00:00Z", endAt: "2026-09-23T14:00:00Z" });
  remote.etag = "owner-edit"; remote.summary = "本人修改的标题";
  await processCalendarJobs(now);
  assert.equal(patches, 1); assert.equal(await withCheckInState(s => execution(s).jobs.at(-1)!.state, false), "conflict");
}));
