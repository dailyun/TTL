import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { answerCheckIn, createCheckIn, dispatchCheckIns, feedbackFeed, listCheckIns, subscribeDevice, updateCheckIn } from "../src/check-ins/service.js";
import { withCheckInState } from "../src/check-ins/store.js";
import { createSimpleSessionToken } from "../src/auth/simple-auth.js";
import { GET as listBrowser } from "../app/api/check-ins/route.js";
import { POST as answerBrowser } from "../app/api/check-ins/[id]/feedback/route.js";
import { POST as createRemote } from "../app/api/v1/check-ins/route.js";
import { GET as feedRemote } from "../app/api/v1/feedback/route.js";
import { subscriptionSchema } from "../src/check-ins/schema.js";
import { reconcileGoogleCalendarItemIds } from "../src/local-db/db.js";
import { googleCalendarEventToItem } from "../src/google-calendar/client.js";

const NOW = new Date("2026-09-17T10:00:00Z");
const input = (id = "gym-1") => ({ id, title: "测试健身", prompt: "做得怎么样？", dueAt: "2026-09-17T09:00:00Z" });
const subscription = (suffix = "1") => ({ endpoint: `https://web.push.apple.com/Q${suffix}`, keys: { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } });

test("Google reschedules preserve an owner's completed or paused execution status", () => {
  const incoming = googleCalendarEventToItem({ calendarId: "primary", sectionId: "life", event: { id: "gym", start: { dateTime: "2026-09-17T10:00:00Z" }, end: { dateTime: "2026-09-17T11:00:00Z" } } })!;
  for (const status of ["done", "paused", "abandoned"] as const) {
    const existing = { ...incoming, status, startAt: "2026-09-17T09:00:00Z" };
    const [merged] = reconcileGoogleCalendarItemIds([existing], [incoming]);
    assert.equal(merged.status, status);
    assert.equal(merged.startAt, incoming.startAt);
  }
});
async function isolated(task: () => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "tdl-check-ins-"));
  const env = { ...process.env };
  process.env.TODOTODOLIST_CHECKIN_PATH = path.join(directory, "state.json");
  Object.assign(process.env, { NODE_ENV: "test" });
  delete process.env.VERCEL;
  delete process.env.TODOTODOLIST_PUBLIC_URL;
  delete process.env.TODOTODOLIST_PASSWORD;
  try { await task(); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await rm(directory, { recursive: true, force: true });
  }
}

test("durable feedback is idempotent and calendar time does not imply completion", () => isolated(async () => {
  const created = await createCheckIn(input(), { now: NOW });
  assert.equal(created.status, "pending");
  assert.equal((await createCheckIn(input(), { now: NOW })).id, created.id);
  assert.equal((await listCheckIns()).data.length, 1);
  const reply = { id: "reply-1", outcome: "partial", text: "练了半小时" };
  const first = await answerCheckIn(created.id, reply);
  assert.equal((await answerCheckIn(created.id, reply)).sequence, first.sequence);
  assert.equal((await feedbackFeed(0, 10)).data.length, 1);
  assert.equal((await feedbackFeed(1, 10)).data.length, 0);
  assert.equal((await listCheckIns()).data[0].status, "answered");
  await assert.rejects(answerCheckIn(created.id, { ...reply, text: "changed" }), /ID/);
  const stored = JSON.parse(await readFile(process.env.TODOTODOLIST_CHECKIN_PATH!, "utf8"));
  assert.equal(stored.feedback[0].text, "练了半小时");
  assert.equal(stored.checkIns[0].feedback.sequence, 1);
}));

test("stable check-in IDs reject different or omitted goal associations", () => isolated(async () => {
  await createCheckIn({ ...input(), goalTreeLink: { treeId: "tree", nodeId: "gym" } });
  await assert.rejects(createCheckIn(input()), /ID/);
  await assert.rejects(createCheckIn({ ...input(), title: "another", goalTreeLink: { treeId: "tree", nodeId: "gym" } }), /ID/);
}));

test("concurrent dispatch only claims each device once and does not mark action done", () => isolated(async () => {
  await createCheckIn(input());
  await subscribeDevice(subscription());
  let sent = 0;
  const sender = async (_sub: unknown, payload: string) => { sent += 1; assert.equal(JSON.parse(payload).url, "/review?checkIn=gym-1"); };
  await Promise.all([dispatchCheckIns({ now: NOW, sender }), dispatchCheckIns({ now: NOW, sender })]);
  assert.equal(sent, 1);
  assert.equal((await listCheckIns()).data[0].status, "pending");
  assert.equal((await listCheckIns()).data[0].deliveries[0].status, "accepted");
}));

test("rescheduling, cancellation and answered check-ins invalidate old reminders", () => isolated(async () => {
  await subscribeDevice(subscription());
  await createCheckIn(input("later"));
  await createCheckIn(input("cancelled"));
  await createCheckIn(input("answered"));
  await updateCheckIn("later", 1, { dueAt: "2026-09-18T10:00:00Z" });
  await updateCheckIn("cancelled", 1, { status: "cancelled" });
  await answerCheckIn("answered", { id: "r1", outcome: "completed" });
  await assert.rejects(updateCheckIn("later", 1, { status: "cancelled" }), /变化/);
  const result = await dispatchCheckIns({ now: NOW, sender: async () => assert.fail("must not send") });
  assert.equal(result.processed, 0);
}));

test("ambiguous network sends are not retried; expired devices are removed", () => isolated(async () => {
  await subscribeDevice(subscription());
  await createCheckIn(input());
  await dispatchCheckIns({ now: NOW, sender: async () => { throw new Error("timeout"); } });
  assert.equal((await listCheckIns()).data[0].deliveries[0].status, "unknown");
  assert.equal((await dispatchCheckIns({ now: NOW, sender: async () => assert.fail("duplicate") })).processed, 0);
  await createCheckIn(input("expired"));
  await dispatchCheckIns({ now: NOW, sender: async () => { throw Object.assign(new Error("expired"), { statusCode: 410 }); } });
  assert.equal(await withCheckInState((s) => s.devices.length, false), 0);
}));

test("known transient push failures retry after backoff, at most three times", () => isolated(async () => {
  await subscribeDevice(subscription());
  await createCheckIn(input());
  let sent = 0;
  const sender = async () => { sent += 1; throw Object.assign(new Error("busy"), { statusCode: 429 }); };
  for (let offset = 0; offset < 5; offset++) await dispatchCheckIns({ now: new Date(NOW.getTime() + offset * 300_000), sender });
  assert.equal(sent, 3);
}));

test("crashed claimed sends become unknown, and device-specific test does not broadcast", () => isolated(async () => {
  const device = await subscribeDevice(subscription());
  await subscribeDevice(subscription("2"));
  await createCheckIn(input(), { test: true, targetSubscriptionId: device.id });
  await dispatchCheckIns({ now: NOW, sender: async () => undefined });
  await withCheckInState((s) => { assert.equal(s.deliveries.length, 1); s.deliveries[0].status = "sending"; });
  await dispatchCheckIns({ now: new Date(NOW.getTime() + 120_000), sender: async () => assert.fail("unknown must not resend") });
  assert.equal((await listCheckIns()).data[0].deliveries[0].status, "unknown");
  assert.equal((await listCheckIns()).data[0].test, true);
}));

test("subscription rejects local and attacker-controlled endpoints", () => {
  for (const endpoint of ["http://web.push.apple.com/a", "https://127.0.0.1/a", "https://web.push.apple.com.attacker.invalid/a", "https://user@web.push.apple.com/a"]) {
    assert.equal(subscriptionSchema.safeParse({ ...subscription(), endpoint }).success, false);
  }
});

test("browser feedback requires session and same origin; API uses a separate bearer", () => isolated(async () => {
  process.env.TODOTODOLIST_PASSWORD = "test-password";
  process.env.TODOTODOLIST_API_TOKEN = "test-api-token";
  const url = "http://127.0.0.1:3000";
  assert.equal((await listBrowser(new Request(`${url}/api/check-ins`))).status, 401);
  assert.equal((await createRemote(new Request(`${url}/api/v1/check-ins`, { method: "POST", body: JSON.stringify(input()) }))).status, 401);
  const created = await createRemote(new Request(`${url}/api/v1/check-ins`, { method: "POST", headers: { authorization: "Bearer test-api-token" }, body: JSON.stringify(input()) }));
  assert.equal(created.status, 201);
  const token = await createSimpleSessionToken();
  const headers = { cookie: `tdl_session=${token}`, "content-type": "application/json", origin: "https://attacker.invalid" };
  const body = JSON.stringify({ id: "owner-reply", outcome: "completed", text: "完成测试" });
  const context = { params: Promise.resolve({ id: "gym-1" }) };
  assert.equal((await answerBrowser(new Request(`${url}/api/check-ins/gym-1/feedback`, { method: "POST", headers, body }), context)).status, 403);
  headers.origin = url;
  assert.equal((await answerBrowser(new Request(`${url}/api/check-ins/gym-1/feedback`, { method: "POST", headers, body }), context)).status, 200);
  const feed = await feedRemote(new Request(`${url}/api/v1/feedback?after=0`, { headers: { authorization: "Bearer test-api-token" } }));
  const data = await feed.json();
  assert.equal(data.data[0].text, "完成测试");
  assert.equal(data.nextCursor, 1);
  assert.equal(feed.headers.get("cache-control"), "no-store");
}));
