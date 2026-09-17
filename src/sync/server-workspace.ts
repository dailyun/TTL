import { db, exportSnapshot, enableLegacySeed, type AppSnapshot } from "../local-db/db.js";
import type { readWorkspace } from "../execution/service.js";
export type ServerWorkspace = Awaited<ReturnType<typeof readWorkspace>>;
type EntityCollection = "items" | "sections" | "settings";
const collections: EntityCollection[] = ["items", "sections", "settings"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let activeSync: Promise<ServerWorkspace | null> | undefined;
let serverMode = false;
export function isServerMode() { return serverMode; }
export async function cachedWorkspace() { return (await db.runtime.get("workspace"))?.value as ServerWorkspace | undefined; }
export async function browserApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) }).catch(() => { throw new Error("暂时无法连接服务器，内容已保存在此设备，联网后自动重试。"); });
  const payload = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请先登录；本机待提交内容仍保留。" : payload.error?.message ?? payload.error ?? `请求失败 HTTP ${response.status}`);
  return payload as T;
}
export async function queueBrowserOperation(path: string, body: { id?: string; operationId?: string } & Record<string, unknown>) {
  const id = body.operationId ?? body.id ?? crypto.randomUUID();
  const existing = await db.outbox.get(id);
  if (existing && !same(existing.body, body)) throw new Error("此操作仍待提交，请先处理原内容。");
  await db.outbox.put({ id, path, body, createdAt: existing?.createdAt ?? new Date().toISOString() });
  window.dispatchEvent(new Event("todo-outbox"));
  try { await flushBrowserOperations(); } catch { /* Durable pending operation is visible in Today. */ }
}
export async function flushBrowserOperations() {
  for (const operation of await db.outbox.orderBy("createdAt").toArray()) {
    try { await browserApi(operation.path, operation.body); await db.outbox.delete(operation.id); }
    catch (error) { await db.outbox.update(operation.id, { error: error instanceof Error ? error.message : "待同步" }); throw error; }
  }
  window.dispatchEvent(new Event("todo-outbox"));
}

/** Baseline + durable request receipt make refresh/crash/offline replay idempotent. */
export async function syncServerWorkspace(): Promise<ServerWorkspace | null> {
  if (activeSync) return activeSync;
  const task = async () => {
    let remote: ServerWorkspace | { mode: "legacy" };
    try { remote = await browserApi("/api/workspace"); }
    catch (error) {
      if (await cachedWorkspace()) serverMode = true;
      throw error;
    }
    if (remote.mode === "legacy") { enableLegacySeed(true); return null; }
    serverMode = true; enableLegacySeed(false);
    const baseline = (await db.runtime.get("baseline"))?.value as AppSnapshot | undefined;
    let pending = (await db.runtime.get("snapshot-request"))?.value as { body: unknown; captured: AppSnapshot } | undefined;
    if (!pending) {
      const captured = await exportSnapshot();
      const changes = collections.flatMap(collection => captured[collection].filter(after => {
        const before = baseline?.[collection].find(r => r.id === after.id);
        return !same(before, after);
      }).map(after => ({ collection, id: after.id, before: baseline?.[collection].find(r => r.id === after.id), after })));
      if (changes.length) {
        pending = { body: { operationId: `browser:${crypto.randomUUID()}`, source: baseline ? "browser_edit" : "device_migration", changes }, captured };
        await db.runtime.put({ key: "snapshot-request", value: pending });
      }
    }
    const captured = pending?.captured ?? await exportSnapshot();
    if (pending) remote = await browserApi<ServerWorkspace>("/api/workspace", pending.body);
    const confirmed = remote;
    await db.transaction("rw", [db.items, db.sections, db.settings, db.runtime], async () => {
      for (const collection of collections) {
        const table = db.table(collection);
        for (const value of confirmed.snapshot[collection]) {
          const current = await table.get(value.id);
          const sent = captured[collection].find(r => r.id === value.id);
          // Never erase a change made while the network request was in flight.
          if (!current || same(current, sent)) await table.put(value);
        }
      }
      await db.runtime.put({ key: "baseline", value: confirmed.snapshot });
      await db.runtime.put({ key: "workspace", value: confirmed });
      await db.runtime.delete("snapshot-request");
    });
    await flushBrowserOperations();
    return confirmed;
  };
  const promise: Promise<ServerWorkspace | null> = (async () => navigator.locks ? await navigator.locks.request("todotodolist-sync", task) : await task())();
  activeSync = promise.finally(() => { activeSync = undefined; });
  return activeSync;
}
export async function pendingOperations() {
  return { operations: await db.outbox.orderBy("createdAt").toArray(), snapshot: Boolean(await db.runtime.get("snapshot-request")) };
}
