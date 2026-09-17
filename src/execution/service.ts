import { z } from "zod";
import { randomUUID } from "node:crypto";
import { withCheckInState } from "../check-ins/store.js";
import { idSchema, goalTreeLinkSchema } from "../check-ins/schema.js";
import { ExternalApiError } from "../external-api/errors.js";
import { validateSnapshot, type AppSnapshot } from "../local-db/db.js";
import { changed, digest, execution, localDate, reconcileItems, reconcileOwnerEdits, scheduleToday, eligible, queueCalendar } from "./core.js";
import type { CheckInState } from "../check-ins/schema.js";

export function canonicalEnabled() { return Boolean(process.env.TODOTODOLIST_STATE_PATH); }
export const actionSchema = z.object({
  operationId: idSchema, id: idSchema, title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""), goalTreeLink: goalTreeLinkSchema,
  durationMinutes: z.number().int().min(5).max(600).optional(),
  autoSchedule: z.boolean().default(true), recurrence: z.enum(["daily", "weekdays"]).optional(),
  status: z.enum(["wanted", "active", "paused", "abandoned", "done"]).default("active"),
  expectedUpdatedAt: z.string().optional()
}).strict();

function receipt(state: CheckInState, operationId: string, payload: unknown) {
  const w = execution(state), hash = digest(payload);
  if (w.receipts[operationId] && w.receipts[operationId] !== hash) throw new ExternalApiError(409, "operation_reused", "操作编号已用于不同内容。");
  const repeated = Boolean(w.receipts[operationId]);
  w.receipts[operationId] = hash;
  return repeated;
}
export async function publishAction(value: unknown) {
  const input = actionSchema.parse(value);
  return withCheckInState(state => {
    const w = execution(state);
    if (!receipt(state, input.operationId, input)) {
      const existing = w.snapshot.items.find(i => i.id === input.id);
      if (existing && existing.updatedAt !== input.expectedUpdatedAt) throw new ExternalApiError(412, "item_changed", "事项已变化，先读取当前版本。");
      if (existing && JSON.stringify(existing.goalTreeLink) !== JSON.stringify(input.goalTreeLink)) throw new ExternalApiError(409, "link_conflict", "不能把事项关联到另一个节点。");
      const now = new Date().toISOString();
      const { operationId: _, expectedUpdatedAt: __, ...fields } = input;
      const item = { ...existing, ...fields, type: "todo" as const, sectionId: existing?.sectionId ?? "work", tags: existing?.tags ?? [], source: "local" as const,
        createdAt: existing?.createdAt ?? now, updatedAt: now };
      if (existing) Object.assign(existing, item); else w.snapshot.items.push(item);
      changed(state, "action_published", item.id); reconcileItems(state); scheduleToday(state);
    }
    return actionResult(state, input.id);
  });
}
function actionResult(state: CheckInState, id: string) {
  const w = execution(state), item = w.snapshot.items.find(i => i.id === id)!;
  const occurrences = w.occurrences.filter(o => o.itemId === id);
  return { item, occurrences, jobs: w.jobs.filter(j => occurrences.some(o => o.id === j.occurrenceId)),
    steps: { item: "saved", schedule: occurrences.length ? "prepared" : item.durationMinutes ? "waiting_for_calendar_or_time" : "duration_required",
      calendar: occurrences.some(o => o.state === "scheduled") ? "synced" : "pending",
      review: state.checkIns.some(c => c.itemId === id) ? "ready" : "waiting_for_calendar" }, revision: w.revision };
}

export async function readWorkspace() {
  return withCheckInState(state => {
    const w = execution(state), date = localDate(new Date());
    return { mode: "server" as const, revision: w.revision, snapshot: w.snapshot,
      occurrences: w.occurrences.filter(o => o.date >= date || state.checkIns.some(c => c.occurrenceId === o.id && c.status === "pending")),
      reviews: state.checkIns.filter(c => c.kind === "occurrence" || (!c.kind && !c.test)).slice(-500),
      preferences: w.preferences, calendar: { lastSyncAt: w.calendar.lastSyncAt, lastError: w.calendar.lastError, watchError: w.calendar.watchError,
        events: w.calendar.events.filter(e => (e.start?.dateTime ?? e.start?.date ?? "").slice(0, 10) >= date && e.status !== "cancelled").slice(0, 1000) },
      worker: { lastSuccessAt: w.worker.lastSuccessAt, lastError: w.worker.lastError, lastBackupAt: w.worker.lastBackupAt, backupError: w.worker.backupError }, planner: w.planner,
      briefs: w.briefs.slice(-14), conflicts: w.conflicts.filter(c => c.status === "open"),
      jobs: w.jobs.filter(j => j.state !== "done").slice(-100),
      feedbackHistory: state.feedback.slice(-500), deviceCount: state.devices.length, lastDispatchAt: state.lastDispatchAt };
  }, false);
}

const collectionSchema = z.enum(["items", "sections", "settings"]);
export const workspaceMergeSchema = z.object({
  operationId: idSchema, source: z.string().max(200),
  changes: z.array(z.object({ collection: collectionSchema, id: z.string().min(1).max(128), before: z.unknown().optional(), after: z.unknown() }).strict()).max(10_000)
}).strict();
export async function mergeWorkspace(value: unknown) {
  const input = workspaceMergeSchema.parse(value);
  await withCheckInState(state => {
    const w = execution(state);
    if (receipt(state, input.operationId, input)) return;
    const beforeItems = structuredClone(w.snapshot.items);
    for (const change of input.changes) {
      const records = w.snapshot[change.collection] as unknown as Array<Record<string, unknown>>;
      const current = records.find(r => r.id === change.id);
      const incoming = change.after as Record<string, unknown>;
      if (!incoming || incoming.id !== change.id) throw new ExternalApiError(400, "invalid_entity", "实体 ID 不一致，删除请保留 deletedAt 标记。");
      if (digest(current) === digest(incoming)) continue;
      if (digest(current) !== digest(change.before)) {
        w.conflicts.push({ id: `conflict:${digest([input.operationId, change.collection, change.id]).slice(0, 32)}`,
          collection: change.collection, entityId: change.id, base: change.before, incoming, current,
          source: input.source, status: "open", createdAt: new Date().toISOString() });
      } else {
        if (current) records[records.indexOf(current)] = incoming; else records.push(incoming);
      }
    }
    w.snapshot = validateSnapshot(w.snapshot);
    reconcileOwnerEdits(state, beforeItems); reconcileItems(state); changed(state, "workspace_merged", input.operationId);
  });
  return readWorkspace();
}

const preferencesSchema = z.object({
  bufferMinutes: z.number().int().min(0).max(120).optional(), morningTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  eveningTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), notifications: z.boolean().optional(), autoSchedule: z.boolean().optional()
}).strict();
export async function workspaceCommand(value: unknown) {
  const command = z.discriminatedUnion("type", [
    z.object({ type: z.literal("preferences"), operationId: idSchema, expected: preferencesSchema, patch: preferencesSchema }).strict(),
    z.object({ type: z.literal("resolve"), operationId: idSchema, id: idSchema, choice: z.enum(["server", "incoming"]), expectedCurrent: z.unknown() }).strict(),
    z.object({ type: z.literal("snooze"), operationId: idSchema, id: idSchema, until: z.string().datetime({ offset: true }) }).strict(),
    z.object({ type: z.literal("retry"), operationId: idSchema, id: idSchema }).strict(),
    z.object({ type: z.literal("unlock"), operationId: idSchema, id: idSchema, version: z.number().int() }).strict(),
    z.object({ type: z.literal("calendar_create"), operationId: idSchema, id: idSchema, expectedUpdatedAt: z.string() }).strict()
  ]).parse(value);
  await withCheckInState(state => {
    const w = execution(state);
    if (receipt(state, command.operationId, command)) return;
    if (command.type === "preferences") {
      for (const key of Object.keys(command.patch) as Array<keyof typeof command.patch>) if (w.preferences[key] !== command.expected[key]) throw new ExternalApiError(412, "preferences_changed", "设置已变化，请刷新。");
      Object.assign(w.preferences, command.patch);
    } else if (command.type === "resolve") {
      const conflict = w.conflicts.find(c => c.id === command.id && c.status === "open");
      if (!conflict) throw new ExternalApiError(404, "conflict_missing", "冲突已处理。");
      const records = w.snapshot[conflict.collection] as unknown as Array<Record<string, unknown>>;
      const current = records.find(r => r.id === conflict.entityId);
      if (digest(current) !== digest(command.expectedCurrent)) throw new ExternalApiError(412, "conflict_changed", "服务器内容又有变化，请查看新的差异。");
      if (command.choice === "incoming") {
        const beforeItems = structuredClone(w.snapshot.items);
        const next = { ...(conflict.incoming as Record<string, unknown>), updatedAt: new Date().toISOString() };
        if (current) records[records.indexOf(current)] = next; else records.push(next);
        w.snapshot = validateSnapshot(w.snapshot); reconcileOwnerEdits(state, beforeItems); reconcileItems(state);
      }
      conflict.status = "resolved"; conflict.resolvedAt = new Date().toISOString();
    } else if (command.type === "snooze") {
      const checkIn = state.checkIns.find(c => c.id === command.id);
      if (!checkIn || checkIn.status !== "pending") throw new ExternalApiError(409, "not_pending", "回顾已变化。");
      checkIn.snoozedUntil = command.until; checkIn.version++;
    } else if (command.type === "retry") {
      const job = w.jobs.find(j => j.id === command.id);
      if (!job || job.state === "conflict") throw new ExternalApiError(409, "job_conflict", "日历有本人修改，请先核对。");
      if (job.state !== "done") { job.state = "pending"; job.retryAt = undefined; }
    } else if (command.type === "unlock") {
      const occurrence = w.occurrences.find(o => o.id === command.id);
      if (!occurrence || occurrence.version !== command.version) throw new ExternalApiError(412, "occurrence_changed", "安排已变化。");
      if (!occurrence.managed || occurrence.feedbackId || !occurrence.startAt || Date.parse(occurrence.startAt) <= Date.now()) throw new ExternalApiError(409, "not_adjustable", "仅能允许调整尚未开始的系统安排。");
      occurrence.locked = false; occurrence.version++;
    } else if (command.type === "calendar_create") {
      const item = w.snapshot.items.find(i => i.id === command.id);
      if (!item || item.updatedAt !== command.expectedUpdatedAt) throw new ExternalApiError(412, "item_changed", "事项已变化。");
      if (!item.startAt || !item.endAt || Date.parse(item.endAt) <= Date.parse(item.startAt)) throw new ExternalApiError(400, "time_required", "请先填写起止时间。");
      if (w.occurrences.some(o => o.itemId === item.id && o.state !== "cancelled")) throw new ExternalApiError(409, "already_scheduled", "此事项已有日历安排。");
      const id = `occ:${digest([item.id, command.operationId]).slice(0, 32)}`;
      const occurrence = { id, itemId: item.id, date: localDate(new Date(item.startAt)), version: 1, state: "pending" as const,
        startAt: item.startAt, endAt: item.endAt, eventId: `td${digest(id).slice(0, 48)}`, calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        managed: true, locked: true, updatedAt: new Date().toISOString() };
      w.occurrences.push(occurrence); queueCalendar(state, occurrence, "put");
    }
    changed(state, command.type, command.operationId);
  });
  return readWorkspace();
}

export async function executionChanges(after: number, limit: number) {
  return withCheckInState(state => {
    const changes = execution(state).changes.filter(c => c.sequence > after);
    const data = changes.slice(0, limit);
    return { data, nextCursor: data.at(-1)?.sequence ?? after, hasMore: changes.length > data.length };
  }, false);
}
export async function saveBrief(value: unknown) {
  const input = z.object({ id: idSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), summary: z.string().min(1).max(4000),
    actionIds: z.array(idSchema).max(100), createdAt: z.string().datetime({ offset: true }), usage: z.unknown().optional() }).strict().parse(value);
  return withCheckInState(state => {
    const w = execution(state);
    if (!input.actionIds.every(id => w.snapshot.items.some(i => i.id === id && eligible(i) && i.goalTreeLink))) throw new ExternalApiError(409, "unknown_actions", "AI 只能引用已选、有效的行动。");
    if (!receipt(state, input.id, input)) {
      const { usage, ...brief } = input;
      w.briefs.push({ ...brief, source: "local_codex" });
      // The validated list prioritizes already selected actions; it cannot create a new task.
      const rank = new Map(input.actionIds.map((id, index) => [id, index]));
      w.snapshot.items.sort((a, b) => (rank.get(a.id) ?? 1000) - (rank.get(b.id) ?? 1000));
      scheduleToday(state);
      w.planner = { ...w.planner, lastSeenAt: new Date().toISOString(), lastSuccessAt: input.createdAt, lastError: undefined, usage };
      changed(state, "ai_brief", input.id);
    }
    return { saved: true };
  });
}
export async function plannerStatus(value: unknown) {
  const input = z.object({ lastError: z.string().max(500).nullable().optional() }).strict().parse(value);
  return withCheckInState(state => { const w = execution(state); w.planner.lastSeenAt = new Date().toISOString(); w.planner.lastError = input.lastError ?? undefined; return { saved: true }; });
}
export async function importSnapshot(snapshot: AppSnapshot, source: string) {
  const valid = validateSnapshot(snapshot);
  const bootstrapped = await withCheckInState(state => {
    const w = execution(state);
    if (w.revision !== 0 || w.snapshot.items.length !== 0) return false;
    w.snapshot = valid;
    changed(state, "snapshot_bootstrap", source);
    return true;
  });
  if (bootstrapped) return readWorkspace();
  return mergeWorkspace({ operationId: `import:${digest([source, valid]).slice(0, 48)}`, source,
    changes: (["items", "sections", "settings"] as const).flatMap(collection => valid[collection].map(after => ({ collection, id: after.id, after }))) });
}
