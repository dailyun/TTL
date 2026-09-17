import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withCheckInState } from "../src/check-ins/store.js";
import { answerCheckIn, dispatchCheckIns, subscribeDevice } from "../src/check-ins/service.js";
import { execution, scheduleToday, ensureReview, dailyNotifications, reconcileItems, reconcileOwnerEdits } from "../src/execution/core.js";
import { backupDaily } from "../src/execution/backup.js";
import { publishAction, readWorkspace, mergeWorkspace, workspaceCommand, importSnapshot } from "../src/execution/service.js";
import { reconcileCalendar, processCalendarJobs, runExecutionWorker } from "../src/execution/calendar.js";
import { readExternalApiSnapshot, mutateExternalApiSnapshot, createEmptySnapshot } from "../src/external-api/snapshot-store.js";
import { createExternalItem } from "../src/external-api/items.js";
import { externalItemCreateSchema } from "../src/external-api/schema.js";
import type { GoogleCalendarEvent } from "../src/google-calendar/client.js";

const NOW = new Date("2026-09-17T03:59:00Z");
const action = (id = "a1", recurrence?: "daily") => ({ operationId: `publish:${id}`, id, title: "演示锻炼", goalTreeLink: { treeId: "demo", nodeId: `n_${id}` }, durationMinutes: 45, recurrence });
async function isolated(task: () => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "tdl-execution-")), env = { ...process.env };
  process.env.TODOTODOLIST_STATE_PATH = path.join(directory, "state.json");
  delete process.env.VERCEL;
  try { await task(); }
  finally { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); await rm(directory, { recursive: true, force: true }); }
}
async function ready(now = NOW) { await withCheckInState(s => { execution(s).calendar.lastSyncAt = now.toISOString(); }); }
async function prepared(id = "a1", recurrence?: "daily") {
  await publishAction(action(id, recurrence)); await ready();
  return withCheckInState(s => scheduleToday(s, NOW)[0]);
}
async function confirmed(id = "a1", recurrence?: "daily") {
  const occurrence = await prepared(id, recurrence);
  await withCheckInState(s => { const w = execution(s), o = w.occurrences.find(o => o.id === occurrence.id)!; o.state = "scheduled"; o.etag = "one"; w.jobs.forEach(j => { j.state = "done"; }); ensureReview(s, o, w.snapshot.items.find(i => i.id === id)!); });
  return occurrence;
}

test("publish is durable and idempotent; missing duration stays unplanned", () => isolated(async () => {
  const first = await publishAction(action());
  assert.equal(first.steps.calendar, "pending");
  assert.deepEqual((await publishAction(action())).item, JSON.parse(JSON.stringify(first.item)));
  await assert.rejects(publishAction({ ...action(), title: "changed" }), /编号/);
  const input = { ...action("missing"), durationMinutes: undefined };
  assert.equal((await publishAction(input)).steps.schedule, "duration_required");
  await ready(); await withCheckInState(s => scheduleToday(s, NOW));
  assert.equal((await readWorkspace()).snapshot.items.length, 2);
  assert.equal(await withCheckInState(s => execution(s).occurrences.length, false), 1);
}));

test("scheduler respects busy primary events, buffer, time window and fresh sync", () => isolated(async () => {
  await publishAction(action());
  assert.equal((await withCheckInState(s => scheduleToday(s, NOW))).length, 0);
  await ready();
  await withCheckInState(s => { execution(s).calendar.events = [{ id: "owner", start: { dateTime: "2026-09-17T04:00:00Z" }, end: { dateTime: "2026-09-17T05:00:00Z" } }]; });
  const [o] = await withCheckInState(s => scheduleToday(s, NOW));
  assert.equal(o.startAt, "2026-09-17T05:10:00.000Z");
  assert.equal(o.endAt, "2026-09-17T05:55:00.000Z");
  assert.equal((await withCheckInState(s => scheduleToday(s, NOW))).length, 0);
}));

test("recurring feedback and corrections retain history without completing the habit", () => isolated(async () => {
  const occurrence = await confirmed("habit", "daily"), id = `review:${occurrence.id}`;
  const first = await answerCheckIn(id, { id: "reply1", outcome: "completed", text: "锻炼了" });
  assert.equal((await readWorkspace()).snapshot.items[0].status, "active");
  await assert.rejects(answerCheckIn(id, { id: "reply2", outcome: "partial" }), /变化/);
  await answerCheckIn(id, { id: "reply2", outcome: "partial", text: "更正：只做一半", supersedesId: first.id });
  const state = await withCheckInState(s => s, false);
  assert.equal(state.feedback.length, 2); assert.equal(state.feedback[0].outcome, "completed");
  assert.equal(state.workspace!.occurrences[0].state, "partial");
  assert.equal((await answerCheckIn(id, { id: "reply2", outcome: "partial", text: "更正：只做一半", supersedesId: first.id })).id, "reply2");
}));

test("calendar owner reschedule locks occurrence, cancellation keeps feedback and item", () => isolated(async () => {
  const occurrence = await confirmed();
  const moved: GoogleCalendarEvent = { id: occurrence.eventId!, etag: "two", summary: "演示锻炼", start: { dateTime: "2026-09-17T08:00:00Z" }, end: { dateTime: "2026-09-17T09:00:00Z" } };
  await withCheckInState(s => reconcileCalendar(s, [moved], "primary", NOW));
  let state = await withCheckInState(s => s, false);
  assert.equal(state.workspace!.occurrences[0].locked, true);
  assert.equal(state.checkIns[0].dueAt, moved.end!.dateTime);
  await answerCheckIn(state.checkIns[0].id, { id: "actual", outcome: "partial" });
  await withCheckInState(s => reconcileCalendar(s, [{ ...moved, etag: "three", status: "cancelled" }], "primary", NOW));
  state = await withCheckInState(s => s, false);
  assert.equal(state.feedback.length, 1); assert.equal(state.checkIns[0].status, "answered");
  assert.equal(state.workspace!.snapshot.items[0].status, "active");
}));

test("recurring Google instances keep their occurrence after moving and do not duplicate", () => isolated(async () => {
  const event = { id: "series_instance", recurringEventId: "series", originalStartTime: { dateTime: "2026-09-17T04:00:00Z" }, etag: "1", summary: "每周阅读", start: { dateTime: "2026-09-17T04:00:00Z" }, end: { dateTime: "2026-09-17T05:00:00Z" } };
  await withCheckInState(s => reconcileCalendar(s, [event], "primary", NOW));
  const id = await withCheckInState(s => execution(s).occurrences[0].id, false);
  await withCheckInState(s => reconcileCalendar(s, [{ ...event, etag: "2", start: { dateTime: "2026-09-18T04:00:00Z" }, end: { dateTime: "2026-09-18T05:00:00Z" } }], "primary", NOW));
  const w = await withCheckInState(s => execution(s), false);
  assert.equal(w.occurrences.length, 1); assert.equal(w.occurrences[0].id, id); assert.equal(w.occurrences[0].date, "2026-09-18");
}));

test("pausing cancels only future system blocks and suppresses pending reviews", () => isolated(async () => {
  await confirmed();
  await withCheckInState(s => { const w = execution(s); w.snapshot.items[0].status = "paused"; reconcileItems(s, NOW); });
  const state = await withCheckInState(s => s, false);
  assert.equal(state.workspace!.occurrences[0].state, "cancelled");
  assert.equal(state.workspace!.jobs.at(-1)!.kind, "delete");
  assert.equal(state.checkIns[0].status, "cancelled");
}));

test("migration preserves IDs attachments tombstones; different versions require explicit resolution", () => isolated(async () => {
  const snapshot = createEmptySnapshot();
  snapshot.items.push({ id: "legacy", title: "旧数据", description: "原始内容", type: "todo", sectionId: "work", source: "local", status: "abandoned", tags: [], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), deletedAt: NOW.toISOString(), attachments: [{ id: "image", name: "a.png", mimeType: "image/png", size: 1, dataUrl: "data:image/png;base64,AA==", createdAt: NOW.toISOString() }] });
  await importSnapshot(snapshot, "github");
  const first = (await readWorkspace()).snapshot.items[0];
  assert.deepEqual(first, snapshot.items[0]);
  const changed = { ...first, title: "另一个设备版本" };
  const result = await mergeWorkspace({ operationId: "device", source: "device_migration", changes: [{ collection: "items", id: first.id, after: changed }] });
  assert.equal(result.snapshot.items[0].title, "旧数据");
  const conflict = result.conflicts.find(c => c.entityId === first.id)!;
  await workspaceCommand({ operationId: "choose", type: "resolve", id: conflict.id, choice: "incoming", expectedCurrent: first });
  assert.equal((await readWorkspace()).snapshot.items[0].title, "另一个设备版本");
  assert.equal((await readWorkspace()).snapshot.items[0].attachments![0].id, "image");
}));

test("external item API shares canonical state without requiring GitHub", () => isolated(async () => {
  const input = externalItemCreateSchema.parse({ title: "API 新增" });
  await mutateExternalApiSnapshot({ client: undefined, message: "test", mutate(snapshot) { const result = createExternalItem(snapshot, input, "api-one"); return { result: result.item, snapshot: result.snapshot }; } });
  assert.equal((await readWorkspace()).snapshot.items[0].id, "api-one");
  assert.equal((await readExternalApiSnapshot(undefined))!.snapshot.items[0].title, "API 新增");
}));

test("empty days send nothing and late review digest is sent only once per device", () => isolated(async () => {
  const evening = new Date("2026-09-17T14:30:00Z");
  await withCheckInState(s => dailyNotifications(s, evening));
  assert.equal(await withCheckInState(s => s.checkIns.length, false), 0);
  await confirmed();
  await withCheckInState(s => { dailyNotifications(s, evening); dailyNotifications(s, evening); });
  await subscribeDevice({ endpoint: "https://web.push.apple.com/test", keys: { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } });
  const payloads: string[] = [];
  await dispatchCheckIns({ now: evening, sender: async (_, p) => { payloads.push(p); } });
  await dispatchCheckIns({ now: evening, sender: async (_, p) => { payloads.push(p); } });
  assert.equal(payloads.filter(p => JSON.parse(p).url === "/today#reviews").length, 1);
  assert(!payloads.some(p => JSON.parse(p).url.includes("review?checkIn=review")));
}));

test("stable calendar create recovers lost response and etag conflicts retain manual changes", () => isolated(async () => {
  await prepared();
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", GOOGLE_REDIRECT_URI: "http://localhost/callback", GOOGLE_REFRESH_TOKEN: "test", GOOGLE_REFRESH_TOKEN_PATH: path.join(tmpdir(), "nonexistent-test-token") });
  const original = globalThis.fetch;
  let remote: GoogleCalendarEvent | undefined, posts = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "test" });
    if (init?.method === "POST") { posts++; remote = { ...JSON.parse(String(init.body)), etag: "saved" }; throw new TypeError("lost response"); }
    if (init?.method === "PATCH") assert.fail("must not overwrite owner changes");
    return remote ? Response.json(remote) : Response.json({ error: { message: "missing" } }, { status: 404 });
  };
  try {
    await processCalendarJobs(NOW);
    assert.equal(posts, 1);
    await processCalendarJobs(new Date(NOW.getTime() + 3600_000));
    assert.equal(posts, 1);
    const w = await withCheckInState(s => execution(s), false);
    assert.equal(w.occurrences[0].state, "scheduled"); assert.equal(w.jobs[0].state, "done");
    await withCheckInState(s => { const w = execution(s); w.occurrences[0].version++; w.jobs.push({ id: "edit", occurrenceId: w.occurrences[0].id, occurrenceVersion: w.occurrences[0].version, kind: "put", state: "pending", attempts: 0 }); });
    remote = { ...remote!, etag: "owner-changed" };
    await processCalendarJobs(NOW);
    assert.equal((await withCheckInState(s => execution(s), false)).jobs.at(-1)!.state, "conflict");
  } finally { globalThis.fetch = original; }
}));

test("explicit offline calendar edit is queued, owner feedback is not overwritten", () => isolated(async () => {
  const occurrence = await confirmed();
  await answerCheckIn(`review:${occurrence.id}`, { id: "actual", outcome: "completed" });
  await withCheckInState(s => {
    const w = execution(s), before = structuredClone(w.snapshot.items);
    w.snapshot.items[0].title = "更正活动标题";
    reconcileOwnerEdits(s, before);
  });
  const state = await withCheckInState(s => s, false);
  assert.equal(state.workspace!.jobs.at(-1)!.ownerRequested, true);
  assert.equal(state.workspace!.jobs.at(-1)!.kind, "put");
  assert.equal(state.feedback[0].title, "演示锻炼");
}));

test("first calendar import never requests a review of historical events", () => isolated(async () => {
  const event = { id: "past", etag: "old", start: { dateTime: "2026-09-01T04:00:00Z" }, end: { dateTime: "2026-09-01T05:00:00Z" }, summary: "过去的活动" };
  await withCheckInState(s => { reconcileCalendar(s, [event], "primary", NOW); reconcileItems(s, NOW); });
  assert.equal(await withCheckInState(s => s.checkIns.length, false), 0);
}));

test("daily private backup captures canonical items and feedback without duplication", () => isolated(async () => {
  const occurrence = await confirmed();
  await answerCheckIn(`review:${occurrence.id}`, { id: "actual", outcome: "partial" });
  await Promise.all([backupDaily(NOW), backupDaily(new Date(NOW.getTime() + 60_000))]);
  const { readFile, stat } = await import("node:fs/promises");
  const file = path.join(path.dirname(process.env.TODOTODOLIST_STATE_PATH!), "backups", "2026-09-17", "execution.json");
  const restored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(restored.feedback[0].id, "actual"); assert.equal(restored.workspace.snapshot.items[0].id, "a1");
  assert.equal((await stat(file)).mode & 0o077, 0);
}));

test("new busy time moves only a future unlocked system block, retaining stable IDs", () => isolated(async () => {
  const original = await confirmed();
  await withCheckInState(s => {
    const w = execution(s); w.calendar.events.push({ id: "new-owner-event", start: { dateTime: "2026-09-17T04:00:00Z" }, end: { dateTime: "2026-09-17T05:00:00Z" } });
    scheduleToday(s, NOW);
  });
  let w = await withCheckInState(s => execution(s), false);
  assert.equal(w.occurrences[0].id, original.id); assert.equal(w.occurrences[0].eventId, original.eventId);
  assert.equal(w.occurrences[0].startAt, "2026-09-17T05:10:00.000Z");
  assert.equal(w.occurrences[0].state, "pending"); assert.equal(w.jobs.at(-1)!.kind, "put");
  await withCheckInState(s => {
    const w = execution(s); w.occurrences[0].locked = true;
    w.calendar.events.push({ id: "another", start: { dateTime: "2026-09-17T05:00:00Z" }, end: { dateTime: "2026-09-17T07:00:00Z" } });
    scheduleToday(s, NOW);
  });
  w = await withCheckInState(s => execution(s), false);
  assert.equal(w.occurrences[0].startAt, "2026-09-17T05:10:00.000Z");
}));

test("full-sync missing event cancellation works even without a new etag", () => isolated(async () => {
  const occurrence = await confirmed();
  await withCheckInState(s => reconcileCalendar(s, [{ id: occurrence.eventId!, etag: "one", status: "cancelled" }], "primary", NOW));
  const w = await withCheckInState(s => execution(s), false);
  assert.equal(w.occurrences[0].state, "cancelled"); assert.equal(w.snapshot.items[0].status, "active");
  assert.equal(await withCheckInState(s => s.checkIns[0].status, false), "cancelled");
}));

test("an old imported event moved into today becomes reviewable without duplicate occurrences", () => isolated(async () => {
  const event = { id: "old-moved", etag: "one", start: { dateTime: "2026-09-01T04:00:00Z" }, end: { dateTime: "2026-09-01T05:00:00Z" }, summary: "移到今天的活动" };
  await withCheckInState(s => reconcileCalendar(s, [event], "primary", NOW));
  await withCheckInState(s => reconcileCalendar(s, [{ ...event, etag: "two", start: { dateTime: "2026-09-17T04:00:00Z" }, end: { dateTime: "2026-09-17T05:00:00Z" } }], "primary", NOW));
  const state = await withCheckInState(s => s, false);
  assert.equal(state.workspace!.occurrences.length, 1); assert.equal(state.checkIns.length, 1);
  assert.equal(state.checkIns[0].dueAt, "2026-09-17T05:00:00Z");
}));
