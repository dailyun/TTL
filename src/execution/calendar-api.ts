import { z } from "zod";
import type { CheckInState } from "../check-ins/schema.js";
import { goalTreeLinkSchema, idSchema } from "../check-ins/schema.js";
import { withCheckInState } from "../check-ins/store.js";
import { ExternalApiError } from "../external-api/errors.js";
import { googleCalendarConfigFromEnv, listGoogleCalendarEvents, refreshGoogleCalendarAccessToken } from "../google-calendar/client.js";
import { changed, dateTime, digest, ensureReview, execution, localDate, queueCalendar } from "./core.js";
import { reconcileCalendar, safeCalendarError } from "./calendar.js";
import { bindCalendarItem } from "./calendar-binding.js";
import type { Occurrence } from "./types.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "日期无效");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const common = { operationId: idSchema, goalTreeLink: goalTreeLinkSchema, preview: z.boolean().default(true), previewToken: z.string().optional() };
export const planSchema = z.object({ ...common, kind: z.literal("plan"), title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(600), from: day, until: day.optional(),
  count: z.number().int().min(1).max(120).optional(), everyDays: z.number().int().min(1).max(365).default(1),
  weekdays: z.boolean().default(false), times: z.array(time).max(10).default([]),
  windowStart: time.optional(), windowEnd: time.optional(), reminderMinutes: z.number().int().min(0).max(40320).default(10)
}).strict();
export const calendarCommandSchema = z.discriminatedUnion("kind", [planSchema,
  z.object({ ...common, kind: z.literal("link"), from: day, until: day, eventId: z.string().min(1).max(1024).optional(), seriesId: z.string().min(1).max(1024).optional() }).strict(),
  z.object({ ...common, kind: z.literal("move"), occurrenceId: idSchema, expectedVersion: z.number().int().positive(),
    startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ ...common, kind: z.literal("cancel"), occurrenceId: idSchema, expectedVersion: z.number().int().positive() }).strict()
]);
export const calendarQuerySchema = z.object({ from: day, until: day, treeId: idSchema.optional(), nodeId: idSchema.optional() }).strict();
type Plan = z.infer<typeof planSchema>;
type Command = z.infer<typeof calendarCommandSchema>;
const addDays = (v: string, n: number) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const sameLink = (a: { treeId: string; nodeId: string } | undefined, b: { treeId: string; nodeId: string }) => a?.treeId === b.treeId && a.nodeId === b.nodeId;

export function planDates(input: Plan) {
  const until = input.until ?? addDays(input.from, input.count ? Math.min(365, input.count * input.everyDays * (input.weekdays ? 2 : 1)) : 0);
  range(input.from, until);
  const result: string[] = [];
  for (let date = input.from; date <= until; date = addDays(date, input.everyDays)) {
    if (input.weekdays && [0, 6].includes(new Date(`${date}T12:00:00+08:00`).getUTCDay())) continue;
    result.push(date);
    if (input.count && result.length === input.count) break;
    if (result.length > 120) throw new ExternalApiError(400, "range_too_large", "一次最多安排 120 次，请缩小范围。");
  }
  if (!result.length || (input.count && result.length < input.count)) throw new ExternalApiError(400, "invalid_range", "日期范围不足以安排指定次数。");
  return result;
}
function range(from: string, until: string) {
  if (until < from || Date.parse(until) - Date.parse(from) > 366 * 86400_000) throw new ExternalApiError(400, "invalid_range", "起止日期顺序无效或超过一年。");
}
type Busy = { start: number; end: number; eventId?: string; occurrenceId?: string };
function busyTimes(state: CheckInState, ignore?: Occurrence) {
  const w = execution(state);
  const busy: Busy[] = w.calendar.events.filter(e => e.status !== "cancelled" && e.transparency !== "transparent" && e.id !== ignore?.eventId).flatMap(e => {
    const start = e.start?.dateTime ?? (e.start?.date && `${e.start.date}T00:00:00+08:00`);
    const end = e.end?.dateTime ?? (e.end?.date && `${e.end.date}T00:00:00+08:00`);
    return start && end ? [{ start: Date.parse(start), end: Date.parse(end), eventId: e.id }] : [];
  });
  for (const o of w.occurrences) if (o.id !== ignore?.id && o.state !== "cancelled" && o.calendarStatus !== "cancelled" && o.startAt && o.endAt) {
    // Transparent imported all-day reminders do not occupy time.
    if (w.calendar.events.some(e => e.id === o.eventId && e.transparency === "transparent")) continue;
    busy.push({ start: Date.parse(o.startAt), end: Date.parse(o.endAt), eventId: o.eventId, occurrenceId: o.id });
  }
  return busy.sort((a, b) => a.start - b.start);
}
function clash(start: number, end: number, busy: Busy[], buffer: number) {
  return busy.some(b => start < b.end + buffer && end + buffer > b.start);
}

/** Preview has no task/calendar mutations. The same planner is rerun on commit. */
export function previewPlan(state: CheckInState, input: Plan, now = new Date()) {
  const w = execution(state), dates = planDates(input), busy = busyTimes(state), buffer = w.preferences.bufferMinutes * 60_000;
  const windowStart = input.windowStart ?? w.preferences.windowStart, windowEnd = input.windowEnd ?? w.preferences.windowEnd;
  if (windowEnd <= windowStart) throw new ExternalApiError(400, "invalid_window", "时间窗口必须在同一天且结束晚于开始。");
  const slots: Array<{ date: string; startAt: string; endAt: string }> = [], conflicts: Array<{ date: string; reason: string; occurrenceIds?: string[] }> = [];
  for (const date of dates) {
    const existing = w.occurrences.filter(o => o.date === date && o.state !== "cancelled" && o.calendarStatus !== "cancelled"
      && sameLink(w.snapshot.items.find(i => i.id === o.itemId)?.goalTreeLink, input.goalTreeLink));
    if (existing.length) { conflicts.push({ date, reason: "该节点当天已有安排，请读取后改期或关联，不能重复创建", occurrenceIds: existing.map(o => o.id) }); continue; }
    const duration = input.durationMinutes * 60_000, begin = dateTime(date, windowStart), end = dateTime(date, windowEnd);
    let start: number | undefined;
    if (input.times.length) start = input.times.map(t => dateTime(date, t)).find(t => t >= begin && t > now.getTime() && t + duration <= end && !clash(t, t + duration, busy, buffer));
    else {
      let candidate = Math.ceil(Math.max(begin, now.getTime() + 60_000) / 60_000) * 60_000;
      for (const b of busy) if (candidate < b.end + buffer && candidate + duration + buffer > b.start) candidate = b.end + buffer;
      if (candidate + duration <= end) start = candidate;
    }
    if (start === undefined) conflicts.push({ date, reason: "指定时间已过去、超出窗口或没有足够空档" });
    else { slots.push({ date, startAt: new Date(start).toISOString(), endAt: new Date(start + duration).toISOString() }); busy.push({ start, end: start + duration }); busy.sort((a,b) => a.start-b.start); }
  }
  return { slots, conflicts, timeZone: "Asia/Shanghai", bufferMinutes: w.preferences.bufferMinutes };
}

/** Network I/O happens outside the file lock; merge, rather than replace, the bounded mirror. */
export async function refreshCalendarRange(from: string, until: string) {
  range(from, until);
  try {
    const config = googleCalendarConfigFromEnv(), token = await refreshGoogleCalendarAccessToken(config);
    const events = await listGoogleCalendarEvents({ accessToken: token.access_token, calendarId: config.calendarId, timeMin: `${from}T00:00:00+08:00`, timeMax: `${addDays(until, 1)}T00:00:00+08:00` });
    await withCheckInState(state => {
      const w = execution(state), incoming = new Map(events.map(e => [e.id, e]));
      const combined = [...w.calendar.events.filter(e => !incoming.has(e.id)), ...events];
      reconcileCalendar(state, combined, config.calendarId);
      // Bounded reads do not mark the entire mirror fresh or hide worker sync errors.
    });
    return { calendarId: config.calendarId, readAt: new Date().toISOString() };
  } catch (error) { throw new ExternalApiError(503, "calendar_unavailable", safeCalendarError(error)); }
}

export async function readCalendar(value: unknown, options: { refresh?: boolean } = {}) {
  const q = calendarQuerySchema.parse(value); range(q.from, q.until);
  const freshness = options.refresh === false ? undefined : await refreshCalendarRange(q.from, q.until);
  return withCheckInState(state => {
    const w = execution(state), start = dateTime(q.from, "00:00"), end = dateTime(addDays(q.until, 1), "00:00");
    const occurrences = w.occurrences.filter(o => o.startAt && o.endAt && Date.parse(o.startAt) < end && Date.parse(o.endAt) > start)
      .filter(o => { const link = w.snapshot.items.find(i => i.id === o.itemId)?.goalTreeLink; return (!q.treeId || link?.treeId === q.treeId) && (!q.nodeId || link?.nodeId === q.nodeId); });
    const ids = new Set(occurrences.map(o => o.itemId));
    return { timeZone: "Asia/Shanghai", from: q.from, until: q.until, freshness, preferences: w.preferences,
      items: w.snapshot.items.filter(i => ids.has(i.id)), occurrences, jobs: w.jobs.filter(j => occurrences.some(o => o.id === j.occurrenceId)),
      plans: (w.calendarPlans ?? []).filter(p => (!q.treeId || p.goalTreeLink.treeId === q.treeId) && (!q.nodeId || p.goalTreeLink.nodeId === q.nodeId)),
      bindings: (w.calendarBindings ?? []).filter(b => (!q.treeId || b.goalTreeLink.treeId === q.treeId) && (!q.nodeId || b.goalTreeLink.nodeId === q.nodeId)),
      // Busy events stay visible when selecting a node so callers cannot miss unrelated conflicts.
      busy: busyTimes(state).filter(b => b.start < end && b.end > start).map(b => ({ startAt: new Date(b.start).toISOString(), endAt: new Date(b.end).toISOString(), eventId: b.eventId })),
      reviews: state.checkIns.filter(c => c.occurrenceId && occurrences.some(o => o.id === c.occurrenceId)),
      sync: { lastSyncAt: w.calendar.lastSyncAt, lastError: w.calendar.lastError } };
  }, false);
}

function result(state: CheckInState, occurrenceIds: string[]) {
  const w = execution(state), occurrences = w.occurrences.filter(o => occurrenceIds.includes(o.id)), jobs = w.jobs.filter(j => occurrenceIds.includes(j.occurrenceId));
  return { applied: true, occurrences, jobs, calendarConfirmed: occurrences.every(o => Boolean(o.calendarStatus) && !jobs.some(j => j.occurrenceId === o.id && j.occurrenceVersion === o.version && j.state !== "done")) };
}
function semantic(input: Command) { const { preview: _, previewToken: __, ...content } = input; return content; }
function operationHash(input: Command) { return digest(semantic(input)); }
export async function calendarCommand(value: unknown, options: { refresh?: boolean; now?: Date } = {}) {
  const input = calendarCommandSchema.parse(value), now = options.now ?? new Date(), hash = operationHash(input);
  const duplicate = await withCheckInState(s => {
    const op = execution(s).calendarOperations?.[input.operationId];
    if (!op) return;
    if (op.hash !== hash) throw new ExternalApiError(409, "operation_reused", "操作编号已用于不同内容。");
    return result(s, op.occurrenceIds);
  }, false);
  if (duplicate) return { ...duplicate, repeated: true };
  if (options.refresh !== false) {
    if (input.kind === "plan") { const dates = planDates(input); await refreshCalendarRange(dates[0], dates.at(-1)!); }
    else if (input.kind === "link") await refreshCalendarRange(input.from, input.until);
    else if (input.kind === "move") await refreshCalendarRange(localDate(new Date(input.startAt)), localDate(new Date(input.endAt)));
  }
  return withCheckInState(state => {
    const w = execution(state), repeated = w.calendarOperations?.[input.operationId];
    if (repeated) {
      if (repeated.hash !== hash) throw new ExternalApiError(409, "operation_reused", "操作编号已用于不同内容。");
      return { ...result(state, repeated.occurrenceIds), repeated: true };
    }
    let preview: Record<string, unknown>, selected: Occurrence[] = [];
    if (input.kind === "plan") preview = previewPlan(state, input, now);
    else if (input.kind === "link") {
      if (Boolean(input.seriesId) === Boolean(input.eventId)) throw new ExternalApiError(400, "exact_id_required", "提供一个系列 ID 或一个事件 ID。");
      const events = w.calendar.events.filter(e => input.seriesId ? e.recurringEventId === input.seriesId : e.id === input.eventId);
      selected = w.occurrences.filter(o => events.some(e => e.id === o.eventId));
      if (!selected.length) throw new ExternalApiError(404, "events_missing", "指定 ID 没有可关联的执行记录，请检查日期范围和 ID。");
      for (const o of selected) {
        const item = w.snapshot.items.find(i => i.id === o.itemId)!;
        if (item.goalTreeLink && !sameLink(item.goalTreeLink, input.goalTreeLink)) throw new ExternalApiError(409, "link_conflict", "该事件已经关联其他节点，不能覆盖。");
      }
      const binding = w.calendarBindings?.find(b => b.seriesId === input.seriesId && b.eventId === input.eventId);
      if (binding && !sameLink(binding.goalTreeLink, input.goalTreeLink)) throw new ExternalApiError(409, "link_conflict", "该 ID 已关联其他节点。");
      preview = { occurrences: selected.map(o => ({ id: o.id, version: o.version, eventId: o.eventId })), conflicts: [] };
    } else {
      const occurrence = w.occurrences.find(o => o.id === input.occurrenceId);
      if (!occurrence || !sameLink(w.snapshot.items.find(i => i.id === occurrence.itemId)?.goalTreeLink, input.goalTreeLink)) throw new ExternalApiError(404, "occurrence_missing", "执行不存在或未关联该节点。");
      if (occurrence.version !== input.expectedVersion) throw new ExternalApiError(412, "occurrence_changed", "安排已变化，请重新读取。");
      if (w.jobs.some(j => j.occurrenceId === occurrence.id && ["pending", "sending", "failed"].includes(j.state))) throw new ExternalApiError(409, "write_pending", "该事件尚有待确认写入，请等待或核对失败原因。");
      selected = [occurrence];
      const conflicts: string[] = [];
      if (input.kind === "move") {
        const start = Date.parse(input.startAt), end = Date.parse(input.endAt);
        if (start <= now.getTime() || end <= start || end - start > 600 * 60_000 || occurrence.calendarStatus === "cancelled") conflicts.push("只能将未取消事件调整到未来的有效时段（最长 600 分钟）");
        if (clash(start, end, busyTimes(state, occurrence), w.preferences.bufferMinutes * 60_000)) conflicts.push("与现有日程或缓冲时间冲突");
      }
      preview = { occurrenceId: occurrence.id, version: occurrence.version, conflicts, ...(input.kind === "move" ? { startAt: input.startAt, endAt: input.endAt } : {}) };
    }
    const token = digest([semantic(input), preview]);
    if (input.preview || (preview.conflicts as unknown[]).length) return { applied: false, preview, previewToken: token };
    if (input.previewToken !== token) throw new ExternalApiError(412, "preview_changed", "预览已变化，请重新查看空档与安排后提交。");
    if (input.kind === "plan") {
      const id = `plan:${digest(input.operationId).slice(0, 32)}`, itemId = `calendar:${digest(input.operationId).slice(0, 32)}`, timestamp = now.toISOString();
      w.snapshot.items.push({ id: itemId, title: input.title, description: "", type: "todo", status: "active", sectionId: process.env.GOOGLE_CALENDAR_SECTION || "work", tags: [], source: "local", goalTreeLink: input.goalTreeLink,
        durationMinutes: input.durationMinutes, autoSchedule: false, calendarPlanId: id, createdAt: timestamp, updatedAt: timestamp });
      for (const slot of preview.slots as Array<{ date: string; startAt: string; endAt: string }>) {
        const occurrenceId = `occ:${digest([id, slot.date]).slice(0, 32)}`;
        const o: Occurrence = { id: occurrenceId, itemId, ...slot, version: 1, state: "pending", eventId: `td${digest(occurrenceId).slice(0, 48)}`, calendarId: process.env.GOOGLE_CALENDAR_ID || "primary", managed: true, locked: true, reminderMinutes: input.reminderMinutes, updatedAt: timestamp };
        w.occurrences.push(o); selected.push(o); queueCalendar(state, o, "put");
      }
      (w.calendarPlans ??= []).push({ id, itemId, goalTreeLink: input.goalTreeLink, request: semantic(input), occurrenceIds: selected.map(o => o.id), createdAt: timestamp });
    } else if (input.kind === "link") {
      const calendarId = selected[0].calendarId;
      if (!(w.calendarBindings ??= []).some(b => b.calendarId === calendarId && b.seriesId === input.seriesId && b.eventId === input.eventId)) w.calendarBindings.push({ id: `binding:${digest(input.operationId).slice(0, 32)}`, calendarId, seriesId: input.seriesId, eventId: input.eventId, goalTreeLink: input.goalTreeLink, createdAt: now.toISOString() });
      for (const o of selected) {
        const item = w.snapshot.items.find(i => i.id === o.itemId)!;
        bindCalendarItem(state, item, w.calendar.events.find(e => e.id === o.eventId)!, o.calendarId);
        item.updatedAt = now.toISOString(); ensureReview(state, o, item, now);
      }
    } else {
      const o = selected[0];
      o.version++; o.locked = true; o.updatedAt = now.toISOString();
      if (input.kind === "move") { o.startAt = input.startAt; o.endAt = input.endAt; o.date = localDate(new Date(input.startAt)); if (!o.feedbackId) o.state = "pending"; queueCalendar(state, o, "put", true); }
      else { if (!o.feedbackId) o.state = "cancelled"; queueCalendar(state, o, "delete", true); }
      // Review times change only after Google has confirmed the write.
    }
    (w.calendarOperations ??= {})[input.operationId] = { hash, occurrenceIds: selected.map(o => o.id) };
    changed(state, `calendar_${input.kind}`, input.operationId, now);
    return result(state, selected.map(o => o.id));
  }, !input.preview);
}
