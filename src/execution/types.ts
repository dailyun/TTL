import type { AppSnapshot } from "../local-db/db.js";
import type { GoogleCalendarEvent } from "../google-calendar/client.js";

export interface Occurrence {
  id: string; itemId: string; date: string; version: number;
  state: "pending" | "scheduled" | "cancelled" | "completed" | "partial" | "not_done" | "skipped";
  startAt?: string; endAt?: string; eventId?: string; etag?: string;
  calendarId: string; managed: boolean; locked: boolean;
  reviewEnabled?: boolean; calendarStatus?: "confirmed" | "cancelled";
  feedbackId?: string; reason?: string; updatedAt: string;
  reminderMinutes?: number;
}
export interface CalendarJob {
  id: string; occurrenceId: string; occurrenceVersion: number;
  kind: "put" | "delete"; state: "pending" | "sending" | "done" | "failed" | "conflict";
  attempts: number; retryAt?: string; claimedAt?: string; error?: string;
  ownerRequested?: boolean;
}
export interface Preferences {
  timeZone: "Asia/Shanghai"; windowStart: string; windowEnd: string;
  bufferMinutes: number; morningTime: string; eveningTime: string;
  notifications: boolean; autoSchedule: boolean;
}
export interface Conflict {
  id: string; collection: "items" | "sections" | "settings"; entityId: string;
  base?: unknown; incoming: unknown; current?: unknown; source: string;
  status: "open" | "resolved"; createdAt: string; resolvedAt?: string;
}
export interface ExecutionState {
  version: 1; revision: number; snapshot: AppSnapshot;
  occurrences: Occurrence[]; jobs: CalendarJob[];
  preferences: Preferences;
  changes: Array<{ sequence: number; kind: string; id?: string; at: string }>;
  receipts: Record<string, string>;
  calendarPlans?: Array<{ id: string; itemId: string; goalTreeLink: { treeId: string; nodeId: string }; request: unknown; occurrenceIds: string[]; createdAt: string }>;
  calendarBindings?: Array<{ id: string; calendarId: string; eventId?: string; seriesId?: string; goalTreeLink: { treeId: string; nodeId: string }; createdAt: string }>;
  calendarOperations?: Record<string, { hash: string; occurrenceIds: string[] }>;
  conflicts: Conflict[];
  calendar: { events: GoogleCalendarEvent[]; lastSyncAt?: string; lastError?: string; watchError?: string; retryAt?: string };
  worker: { lastStartedAt?: string; lastSuccessAt?: string; lastError?: string; leaseUntil?: string; leaseId?: string; lastBackupAt?: string; backupError?: string };
  planner: { lastSeenAt?: string; lastSuccessAt?: string; lastError?: string; usage?: unknown };
  briefs: Array<{ id: string; date: string; summary: string; source: "local_codex"; createdAt: string; actionIds: string[] }>;
}
