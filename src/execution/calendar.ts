import { randomUUID } from "node:crypto";
import { withCheckInState } from "../check-ins/store.js";
import type { CheckInState } from "../check-ins/schema.js";
import { dispatchCheckIns, pushConfiguration } from "../check-ins/service.js";
import { syncGoogleCalendarRealtime, startGoogleCalendarWatch } from "../google-calendar/realtime.js";
import { createGoogleCalendarEvent, patchGoogleCalendarEvent, deleteGoogleCalendarEvent, getGoogleCalendarEvent,
  googleCalendarConfigFromEnv, refreshGoogleCalendarAccessToken, googleCalendarEventToItem, GoogleCalendarApiError,
  type GoogleCalendarEvent } from "../google-calendar/client.js";
import { changed, dailyNotifications, digest, eligible, ensureReview, execution, localDate, reconcileItems, scheduleToday } from "./core.js";
import { bindCalendarItem } from "./calendar-binding.js";

function eventTimes(event: GoogleCalendarEvent) {
  const startAt = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00+08:00` : undefined);
  const endAt = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00+08:00` : undefined);
  return { startAt, endAt };
}
function sameTime(a?: string, b?: string) { return a === b || Boolean(a && b && Date.parse(a) === Date.parse(b)); }

/** Mirror and reconciliation are one transaction; repeating the mirror is harmless. */
export function reconcileCalendar(state: CheckInState, events: GoogleCalendarEvent[], calendarId: string, now = new Date()) {
  const w = execution(state);
  w.calendar.events = events;
  for (const event of events) {
    const privateLink = event.extendedProperties?.private;
    let occurrence = w.occurrences.find(o => o.calendarId === calendarId && o.eventId === event.id);
    let item = occurrence ? w.snapshot.items.find(i => i.id === occurrence!.itemId) : w.snapshot.items.find(i => i.sourceLink?.calendarId === calendarId && i.sourceLink?.eventId === event.id);
    // A remotely copied system event must not silently rebind itself by title or metadata.
    if (!occurrence && privateLink?.todotodolistOccurrence) continue;
    const times = eventTimes(event);
    if (!occurrence && event.status !== "cancelled" && times.startAt && times.endAt) {
      if (!item) {
        const imported = googleCalendarEventToItem({ calendarId, event, sectionId: process.env.GOOGLE_CALENDAR_SECTION || "work", now });
        if (!imported) continue;
        item = imported; w.snapshot.items.push(item);
      }
      // Google's instance ID survives a recurring occurrence's move; originalStartTime also survives it.
      const id = `occ:${digest([calendarId, event.recurringEventId || event.id, event.originalStartTime ?? event.id]).slice(0, 32)}`;
      occurrence = { id, itemId: item.id, date: localDate(new Date(times.startAt)), version: 1, state: "scheduled",
        ...times, eventId: event.id, etag: event.etag, calendarId, calendarStatus: "confirmed", managed: false, locked: true, reviewEnabled: localDate(new Date(times.endAt)) >= localDate(now), updatedAt: now.toISOString() };
      w.occurrences.push(occurrence); changed(state, "calendar_imported", id, now);
    }
    if (!occurrence || !item) continue;
    bindCalendarItem(state, item, event, calendarId);
    const activeJob = w.jobs.find(j => j.occurrenceId === occurrence!.id && j.occurrenceVersion === occurrence!.version && ["pending", "sending", "failed"].includes(j.state));
    if (event.etag === occurrence.etag && occurrence.calendarStatus === (event.status === "cancelled" ? "cancelled" : "confirmed")) { ensureReview(state, occurrence, item, now); continue; }
    // Do not reinterpret an old mirror as an owner edit while our own write is pending.
    if (activeJob) continue;
    const moved = !sameTime(times.startAt, occurrence.startAt) || !sameTime(times.endAt, occurrence.endAt);
    occurrence.etag = event.etag;
    occurrence.calendarStatus = event.status === "cancelled" ? "cancelled" : "confirmed";
    if (event.status === "cancelled") {
      if (!occurrence.feedbackId) occurrence.state = "cancelled";
      occurrence.reason = "Google 日历已取消；目标和已有反馈保留";
      const review = state.checkIns.find(c => c.occurrenceId === occurrence!.id);
      if (review?.status === "pending") { review.status = "cancelled"; review.version++; }
      if (!occurrence.managed) item.deletedAt = now.toISOString();
    } else {
      if (moved) { Object.assign(occurrence, times); occurrence.locked = true;
        if (times.endAt && localDate(new Date(times.endAt)) >= localDate(now)) occurrence.reviewEnabled = true;
      }
      if (times.startAt) occurrence.date = localDate(new Date(times.startAt));
      if (!occurrence.feedbackId) occurrence.state = "scheduled";
      if (event.summary) item.title = event.summary;
      if (!item.recurrence && !item.calendarPlanId) { item.startAt = times.startAt; item.endAt = times.endAt; }
      if (!occurrence.managed) { item.description = event.description ?? ""; delete item.deletedAt; }
      ensureReview(state, occurrence, item, now);
    }
    occurrence.version++; occurrence.updatedAt = now.toISOString(); item.updatedAt = now.toISOString();
    changed(state, "calendar_updated", occurrence.id, now);
  }
}

export async function processCalendarJobs(now = new Date()) {
  const config = googleCalendarConfigFromEnv();
  const claims = await withCheckInState(state => {
    const w = execution(state);
    for (const job of w.jobs) if (job.state === "sending" && now.getTime() - Date.parse(job.claimedAt!) > 90_000) job.state = "pending";
    const result = [];
    for (const job of w.jobs) {
      if (!["pending", "failed"].includes(job.state) || (job.retryAt && Date.parse(job.retryAt) > now.getTime())) continue;
      const occurrence = w.occurrences.find(o => o.id === job.occurrenceId);
      const item = w.snapshot.items.find(i => i.id === occurrence?.itemId);
      if (!occurrence || !item || occurrence.version !== job.occurrenceVersion) { job.state = "done"; continue; }
      if (job.kind === "put" && ((!eligible(item) && !job.ownerRequested) || !occurrence.startAt || !occurrence.endAt)) { job.state = "done"; continue; }
      if (result.length >= 10) break;
      job.state = "sending"; job.claimedAt = now.toISOString(); job.attempts++;
      result.push({ job: { ...job }, occurrence: { ...occurrence }, item: { ...item } });
    }
    return result;
  });
  if (!claims.length) return;
  let accessToken: string;
  try { accessToken = (await refreshGoogleCalendarAccessToken(config)).access_token; }
  catch (error) {
    await withCheckInState(state => { for (const claim of claims) { const job = execution(state).jobs.find(j => j.id === claim.job.id)!; job.state = "failed"; job.error = safeCalendarError(error); job.retryAt = new Date(now.getTime() + 300_000).toISOString(); } });
    throw error;
  }
  for (const { job, occurrence, item } of claims) {
    const params = { accessToken, calendarId: occurrence.calendarId, eventId: occurrence.eventId! };
    try {
      let remote: GoogleCalendarEvent | undefined;
      try { remote = await getGoogleCalendarEvent(params); }
      catch (error) { if (!(error instanceof GoogleCalendarApiError && [404, 410].includes(error.status))) throw error; }
      const matchesTarget = remote && remote.summary === item.title && (remote.description ?? "") === item.description
        && (item.allDay ? remote.start?.date === localDate(new Date(occurrence.startAt!)) && remote.end?.date === localDate(new Date(occurrence.endAt!))
          : sameTime(remote.start?.dateTime, occurrence.startAt) && sameTime(remote.end?.dateTime, occurrence.endAt))
        && (occurrence.reminderMinutes === undefined || (remote.reminders?.useDefault === false && remote.reminders.overrides?.length === 1
          && remote.reminders.overrides[0].method === "popup" && remote.reminders.overrides[0].minutes === occurrence.reminderMinutes));
      const recoveredWrite = matchesTarget && remote?.extendedProperties?.private?.todotodolistWrite === job.id;
      if (remote && occurrence.etag && remote.etag !== occurrence.etag && !recoveredWrite && !(job.kind === "delete" && remote.status === "cancelled")) throw new GoogleCalendarApiError("Event changed", 412, "Precondition Failed");
      if (remote && !occurrence.etag && remote.extendedProperties?.private?.todotodolistOccurrence !== occurrence.id) throw new GoogleCalendarApiError("ID collision", 412, "Precondition Failed");
      let saved: GoogleCalendarEvent | undefined;
      if (job.kind === "delete") {
        if (remote && remote.status !== "cancelled") await deleteGoogleCalendarEvent({ ...params, etag: remote.etag });
      } else {
        if (remote?.status === "cancelled") throw new GoogleCalendarApiError("Event was cancelled", 412, "Precondition Failed");
        const patch = { summary: item.title, description: item.description,
          start: item.allDay ? { date: localDate(new Date(occurrence.startAt!)) } : { dateTime: occurrence.startAt, timeZone: "Asia/Shanghai" },
          end: item.allDay ? { date: localDate(new Date(occurrence.endAt!)) } : { dateTime: occurrence.endAt, timeZone: "Asia/Shanghai" },
          ...(occurrence.reminderMinutes !== undefined ? { reminders: { useDefault: false, overrides: [{ method: "popup" as const, minutes: occurrence.reminderMinutes }] } } : {}),
          extendedProperties: { private: { ...remote?.extendedProperties?.private, todotodolistOccurrence: occurrence.id, todotodolistItem: item.id, todotodolistWrite: job.id } } };
        // An accepted create whose response was lost is recovered using the stable ID.
        if (recoveredWrite || (remote && !occurrence.etag && matchesTarget)) saved = remote;
        else saved = remote ? await patchGoogleCalendarEvent({ ...params, etag: remote.etag, patch })
          : await createGoogleCalendarEvent({ accessToken, calendarId: occurrence.calendarId, event: { ...patch, id: occurrence.eventId } });
      }
      await withCheckInState(state => {
        const w = execution(state), currentJob = w.jobs.find(j => j.id === job.id)!;
        currentJob.state = "done"; currentJob.error = undefined;
        const current = w.occurrences.find(o => o.id === occurrence.id)!;
        // Retain the latest etag even when a user edited the item during the HTTP request.
        if (saved) current.etag = saved.etag;
        current.calendarStatus = job.kind === "delete" ? "cancelled" : "confirmed";
        if (current.version === occurrence.version) {
          if (job.kind === "put") { if (current.reason === "避开新增日程，正在等待日历确认") current.reason = "已避开新增日程"; if (!current.feedbackId) current.state = "scheduled"; ensureReview(state, current, w.snapshot.items.find(i => i.id === item.id)!); }
          else {
            if (!current.feedbackId) current.state = "cancelled";
            const review = state.checkIns.find(c => c.occurrenceId === current.id);
            if (review?.status === "pending") { review.status = "cancelled"; review.version++; }
          }
          current.updatedAt = new Date().toISOString();
        }
        if (saved) { w.calendar.events = w.calendar.events.filter(e => e.id !== saved.id); w.calendar.events.push(saved); }
        else w.calendar.events = w.calendar.events.map(e => e.id === occurrence.eventId ? { ...e, status: "cancelled" } : e);
        changed(state, "calendar_write_confirmed", occurrence.id);
      });
    } catch (error) {
      await withCheckInState(state => {
        const w = execution(state), currentJob = w.jobs.find(j => j.id === job.id)!;
        currentJob.state = error instanceof GoogleCalendarApiError && error.status === 412 ? "conflict" : "failed";
        currentJob.error = safeCalendarError(error);
        currentJob.retryAt = new Date(now.getTime() + Math.min(3600_000, 30_000 * 2 ** Math.min(job.attempts, 7))).toISOString();
        if (currentJob.state === "conflict") { const current = w.occurrences.find(o => o.id === occurrence.id)!; current.locked = true; current.reason = "日历已被修改，保留本人安排"; }
        changed(state, "calendar_write_failed", occurrence.id);
      });
    }
  }
}

export function safeCalendarError(error: unknown) {
  if (error instanceof GoogleCalendarApiError) return `Google HTTP ${error.status}；${[400, 401, 403].includes(error.status) ? "请检查连接授权" : error.status === 412 ? "日程版本冲突，请核对本人修改" : "后台将重试"}`;
  return "日历连接未成功，请检查配置、授权或网络；后台保留待处理操作。";
}

export async function runExecutionWorker(options: { now?: Date; skipCalendar?: boolean; skipPush?: boolean } = {}) {
  const now = options.now ?? new Date(), leaseId = randomUUID();
  const acquired = await withCheckInState(state => {
    const worker = execution(state).worker;
    if (worker.leaseUntil && Date.parse(worker.leaseUntil) > now.getTime()) return false;
    Object.assign(worker, { leaseId, leaseUntil: new Date(now.getTime() + 600_000).toISOString(), lastStartedAt: now.toISOString() }); return true;
  });
  if (!acquired) return { busy: true };
  let calendarError: string | undefined;
  try {
    if (!options.skipCalendar) {
      try {
        const retry = await withCheckInState(s => execution(s).calendar, false);
        if (retry.retryAt && Date.parse(retry.retryAt) > now.getTime()) {
          calendarError = retry.lastError;
        } else {
        const result = await syncGoogleCalendarRealtime({ now });
        await withCheckInState(state => {
          const w = execution(state);
          if (result.mode !== "skipped" || w.calendar.lastSyncAt !== result.syncedAt) reconcileCalendar(state, result.events, result.calendarId, now);
          w.calendar.lastSyncAt = result.syncedAt; w.calendar.lastError = undefined; w.calendar.retryAt = undefined;
        });
        try { await startGoogleCalendarWatch(now); await withCheckInState(s => { execution(s).calendar.watchError = undefined; }); }
        catch { await withCheckInState(s => { execution(s).calendar.watchError = "日历订阅暂不可用，后台继续定期补查"; }); }
        }
      } catch (error) {
        calendarError = safeCalendarError(error);
        await withCheckInState(state => { execution(state).calendar.lastError = calendarError; execution(state).calendar.retryAt = new Date(now.getTime() + 300_000).toISOString(); });
      }
    }
    await withCheckInState(state => { reconcileItems(state, now); scheduleToday(state, now); });
    if (!calendarError && !options.skipCalendar) await processCalendarJobs(now);
    await withCheckInState(state => dailyNotifications(state, now));
    if (!options.skipPush && pushConfiguration().configured) await dispatchCheckIns({ now });
    await withCheckInState(state => { const worker = execution(state).worker; worker.lastSuccessAt = new Date().toISOString(); worker.lastError = calendarError; });
    return { success: !calendarError, calendarError };
  } catch (error) {
    await withCheckInState(state => { execution(state).worker.lastError = "后台处理失败，下一轮重试；未确认的操作保留。"; });
    throw error;
  } finally {
    await withCheckInState(state => { const worker = execution(state).worker; if (worker.leaseId === leaseId) { delete worker.leaseId; delete worker.leaseUntil; } });
  }
}
