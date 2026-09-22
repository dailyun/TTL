import { createHash } from "node:crypto";
import type { Item } from "../domain/types.js";
import type { CheckInState, Feedback } from "../check-ins/schema.js";
import type { ExecutionState, Occurrence, Preferences } from "./types.js";
import { createEmptySnapshot } from "./empty-snapshot.js";

export const DEFAULT_PREFERENCES: Preferences = {
  timeZone: "Asia/Shanghai", windowStart: "12:00", windowEnd: "22:00", bufferMinutes: 10,
  morningTime: "09:00", eveningTime: "22:30", notifications: true, autoSchedule: true
};
export function execution(state: CheckInState): ExecutionState {
  return state.workspace ??= { version: 1, revision: 0, snapshot: createEmptySnapshot(), occurrences: [], jobs: [],
    preferences: { ...DEFAULT_PREFERENCES }, changes: [], receipts: {}, conflicts: [], calendar: { events: [] }, worker: {}, planner: {}, briefs: [] };
}
export function changed(state: CheckInState, kind: string, id?: string, now = new Date()) {
  const w = execution(state);
  w.changes.push({ sequence: ++w.revision, kind, id, at: now.toISOString() });
  w.snapshot.exportedAt = now.toISOString();
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex"); }
export function localDate(now: Date) { return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10); }
export function dateTime(date: string, time: string) { return Date.parse(`${date}T${time}:00+08:00`); }
export function eligible(item: Item) { return !item.deletedAt && ["wanted", "active"].includes(item.status); }
export function queueCalendar(state: CheckInState, occurrence: Occurrence, kind: "put" | "delete", ownerRequested = false) {
  const w = execution(state);
  const id = `job:${occurrence.id}:${occurrence.version}:${kind}`;
  if (!w.jobs.some(j => j.id === id)) w.jobs.push({ id, occurrenceId: occurrence.id, occurrenceVersion: occurrence.version, kind, state: "pending", attempts: 0, ownerRequested });
}

/** Explicit owner edits share the durable queue, including offline edits of Google items. */
export function reconcileOwnerEdits(state: CheckInState, before: Item[]) {
  const w = execution(state);
  for (const occurrence of w.occurrences) {
    const item = w.snapshot.items.find(i => i.id === occurrence.itemId);
    const previous = before.find(i => i.id === occurrence.itemId);
    if (!item || !previous) continue;
    if (item.deletedAt && !previous.deletedAt) {
      occurrence.version++;
      queueCalendar(state, occurrence, "delete", true);
      continue;
    }
    if (item.deletedAt) continue;
    const moved = item.startAt !== previous.startAt || item.endAt !== previous.endAt;
    const edited = item.title !== previous.title || item.description !== previous.description || item.allDay !== previous.allDay;
    if (!moved && !edited) continue;
    if ((item.recurrence || item.calendarPlanId) && Date.parse(occurrence.startAt ?? "") < Date.now()) continue;
    if (moved && item.startAt && item.endAt) {
      occurrence.startAt = item.startAt; occurrence.endAt = item.endAt;
      occurrence.date = localDate(new Date(item.startAt)); occurrence.locked = true;
    }
    occurrence.version++;
    queueCalendar(state, occurrence, "put", true);
  }
}
export function ensureReview(state: CheckInState, occurrence: Occurrence, item: Item, now = new Date()) {
  if (!occurrence.endAt || occurrence.reviewEnabled === false) return;
  if (execution(state).jobs.some(j => j.occurrenceId === occurrence.id && j.occurrenceVersion === occurrence.version && j.state !== "done")) return;
  const id = `review:${occurrence.id}`;
  const existing = state.checkIns.find(c => c.id === id);
  if (existing) {
    // Association is metadata, not a rewrite of the owner's original answer.
    if (!existing.goalTreeLink && item.goalTreeLink) {
      existing.goalTreeLink = { ...item.goalTreeLink }; existing.version++; existing.updatedAt = now.toISOString();
    }
    if (existing.status === "answered") return;
    const status = occurrence.state === "cancelled" || !eligible(item) ? "cancelled" : "pending";
    if (existing.dueAt !== occurrence.endAt || existing.status !== status || existing.title !== item.title) {
      Object.assign(existing, { dueAt: occurrence.endAt, status, title: item.title.slice(0, 200), updatedAt: now.toISOString(), version: existing.version + 1 });
    }
  } else if (occurrence.state !== "cancelled" && eligible(item)) {
    state.checkIns.push({ id, title: item.title.slice(0, 200), prompt: "这次实际做得怎么样？可以补充结果、困难或下次想调整的地方。",
      dueAt: occurrence.endAt, itemId: item.id, occurrenceId: occurrence.id, goalTreeLink: item.goalTreeLink,
      version: 1, status: "pending", test: false, kind: "occurrence", suppressPush: true,
      createdAt: now.toISOString(), updatedAt: now.toISOString() });
  }
}
export function applyFeedback(state: CheckInState, feedback: Feedback) {
  const w = execution(state);
  const occurrence = w.occurrences.find(o => o.id === feedback.occurrenceId);
  if (occurrence) {
    occurrence.state = feedback.outcome;
    occurrence.feedbackId = feedback.id;
    occurrence.updatedAt = feedback.submittedAt;
    occurrence.version++;
    const item = w.snapshot.items.find(i => i.id === occurrence.itemId);
    if (item && !item.recurrence && !item.calendarPlanId && !item.deletedAt && !["paused", "abandoned"].includes(item.status)) {
      item.status = feedback.outcome === "completed" ? "done" : "active";
      item.updatedAt = feedback.submittedAt;
    }
  }
  changed(state, "feedback", feedback.id);
}

/** Called inside the same transaction as every item edit, including external API edits. */
export function reconcileItems(state: CheckInState, now = new Date()) {
  const w = execution(state);
  for (const occurrence of w.occurrences) {
    const item = w.snapshot.items.find(i => i.id === occurrence.itemId);
    if (!item || !eligible(item)) {
      if (["pending", "scheduled"].includes(occurrence.state) && (!occurrence.startAt || Date.parse(occurrence.startAt) > now.getTime())) {
        // Pausing never removes an independently arranged or already started calendar block.
        if (occurrence.managed && !occurrence.locked && occurrence.eventId) {
          occurrence.version++; queueCalendar(state, occurrence, "delete");
        }
        occurrence.state = "cancelled"; occurrence.reason = "事项已停止自动安排";
      }
      const review = state.checkIns.find(c => c.occurrenceId === occurrence.id);
      if (review?.status === "pending") { review.status = "cancelled"; review.version++; }
    } else {
      // Explicit owner edits of an existing one-off schedule are queued, never written in the browser.
      if (!item.recurrence && !item.calendarPlanId && occurrence.managed && item.startAt && item.endAt
        && (item.startAt !== occurrence.startAt || item.endAt !== occurrence.endAt)
        && !occurrence.feedbackId && occurrence.state !== "cancelled") {
        occurrence.startAt = item.startAt; occurrence.endAt = item.endAt; occurrence.locked = true;
        occurrence.version++; queueCalendar(state, occurrence, "put");
      }
      ensureReview(state, occurrence, item, now);
    }
  }
}

/** Deterministic scheduling: selected actions only; a fresh mirror is a precondition. */
export function scheduleToday(state: CheckInState, now = new Date()) {
  const w = execution(state), p = w.preferences, date = localDate(now);
  if (!p.autoSchedule || !w.calendar.lastSyncAt || w.calendar.lastError || now.getTime() - Date.parse(w.calendar.lastSyncAt) > 10 * 60_000) return [];
  const windowStart = dateTime(date, p.windowStart), windowEnd = dateTime(date, p.windowEnd);
  const buffer = p.bufferMinutes * 60_000;
  type Busy = { start: number; end: number; eventId?: string; occurrenceId?: string };
  const busy: Busy[] = w.calendar.events.filter(e => e.status !== "cancelled" && e.transparency !== "transparent").flatMap(e => {
    const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00+08:00` : undefined);
    const end = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00+08:00` : undefined);
    return start && end ? [{ start: Date.parse(start), end: Date.parse(end), eventId: e.id }] : [];
  });
  for (const o of w.occurrences) if (o.startAt && o.endAt && o.state !== "cancelled" && o.calendarStatus !== "cancelled") busy.push({ start: Date.parse(o.startAt), end: Date.parse(o.endAt), eventId: o.eventId, occurrenceId: o.id });
  const availableStart = (duration: number, occupied: Busy[]) => {
    let start = Math.ceil(Math.max(now.getTime() + 60_000, windowStart) / 60_000) * 60_000;
    for (const slot of [...occupied].sort((a, b) => a.start - b.start)) {
      if (start < slot.end + buffer && start + duration + buffer > slot.start) start = Math.max(start, slot.end + buffer);
    }
    return start + duration <= windowEnd ? start : undefined;
  };
  // Repair only future, system-arranged blocks when new busy time causes a conflict.
  // Owner moves remain locked, and no block is moved merely to fill a gap.
  for (const o of w.occurrences) {
    if (!o.managed || o.locked || o.feedbackId || o.date !== date || !["pending", "scheduled"].includes(o.state)
      || !o.startAt || !o.endAt || Date.parse(o.startAt) <= now.getTime()) continue;
    const item = w.snapshot.items.find(i => i.id === o.itemId);
    if (!item || !eligible(item) || !item.autoSchedule) continue;
    if (w.jobs.some(j => j.occurrenceId === o.id && j.state === "sending")) continue;
    const others = busy.filter(s => s.occurrenceId !== o.id && s.eventId !== o.eventId);
    const start = Date.parse(o.startAt), end = Date.parse(o.endAt);
    if (!others.some(s => start < s.end + buffer && end + buffer > s.start)) continue;
    const next = availableStart(end - start, others);
    if (next === undefined) { o.reason = "与新增日程冲突，今天没有足够空闲时间，请商讨调整"; continue; }
    o.startAt = new Date(next).toISOString(); o.endAt = new Date(next + end - start).toISOString();
    o.version++; o.updatedAt = now.toISOString(); o.reason = "避开新增日程，正在等待日历确认";
    o.state = "pending"; queueCalendar(state, o, "put");
    if (!item.recurrence) { item.startAt = o.startAt; item.endAt = o.endAt; item.updatedAt = now.toISOString(); }
    for (const slot of busy) if (slot.occurrenceId === o.id || slot.eventId === o.eventId) { slot.start = next; slot.end = next + end - start; }
    changed(state, "schedule_adjusted_pending", o.id, now);
  }
  const created: Occurrence[] = [];
  for (const item of w.snapshot.items) {
    if (!eligible(item) || !item.autoSchedule || item.calendarPlanId || !item.durationMinutes || !["todo", "event"].includes(item.type)) continue;
    if (item.recurrence === "weekdays" && [0, 6].includes(new Date(`${date}T12:00:00+08:00`).getUTCDay())) continue;
    const occurrenceDate = item.recurrence ? date : "once";
    const id = `occ:${digest([item.id, occurrenceDate]).slice(0, 32)}`;
    if (w.occurrences.some(o => o.id === id)) continue;
    const duration = item.durationMinutes * 60_000;
    const start = availableStart(duration, busy);
    if (start === undefined) continue;
    const occurrence: Occurrence = { id, itemId: item.id, date, version: 1, state: "pending", startAt: new Date(start).toISOString(),
      endAt: new Date(start + duration).toISOString(), eventId: `td${digest(id).slice(0, 48)}`,
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary", managed: true, locked: false, updatedAt: now.toISOString() };
    w.occurrences.push(occurrence); queueCalendar(state, occurrence, "put");
    if (!item.recurrence) { item.startAt = occurrence.startAt; item.endAt = occurrence.endAt; item.updatedAt = now.toISOString(); }
    busy.push({ start, end: start + duration, eventId: occurrence.eventId, occurrenceId: id }); created.push(occurrence); changed(state, "scheduled_pending", id, now);
  }
  return created;
}

export function dailyNotifications(state: CheckInState, now = new Date()) {
  const w = execution(state), date = localDate(now);
  if (!w.preferences.notifications) return;
  for (const kind of ["morning", "evening"] as const) {
    const due = dateTime(date, kind === "morning" ? w.preferences.morningTime : w.preferences.eveningTime);
    if (now.getTime() < due || now.getTime() > due + 90 * 60_000) continue;
    const id = `${kind}:${date}`;
    if (state.checkIns.some(c => c.id === id)) continue;
    const occurrences = w.occurrences.filter(o => o.date === date && o.state === "scheduled");
    const reviews = state.checkIns.filter(c => c.kind === "occurrence" && c.status === "pending" && Date.parse(c.dueAt) <= now.getTime()
      && (!c.snoozedUntil || Date.parse(c.snoozedUntil) <= now.getTime()));
    const pending = w.snapshot.items.filter(i => eligible(i) && i.autoSchedule && !w.occurrences.some(o => o.itemId === i.id && o.date === date && o.state === "scheduled"));
    const count = kind === "morning" ? occurrences.length + pending.length : reviews.length;
    if (!count) continue;
    state.checkIns.push({ id, title: kind === "morning" ? "今日安排" : "今晚回顾", prompt: kind === "morning" ? `${occurrences.length} 项已有安排，${pending.length} 项待安排。打开查看 AI 建议的更新时间。` : `${reviews.length} 项行动待反馈，花一点时间记录实际结果。`,
      dueAt: new Date(due).toISOString(), expiresAt: new Date(dateTime(date, "23:59")).toISOString(), kind,
      version: 1, status: "pending", test: false, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  }
}
