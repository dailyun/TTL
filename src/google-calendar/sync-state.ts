import lockfile from "proper-lockfile";
import type { GoogleCalendarEvent } from "./client.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Item } from "../domain/types.js";

export interface GoogleCalendarWatchState {
  id: string;
  resourceId: string;
  resourceUri?: string;
  token: string;
  expiration?: string;
  createdAt: string;
}

export interface GoogleCalendarSyncState {
  version: 1;
  calendarId: string;
  syncToken?: string;
  lastFullSyncAt?: string;
  lastIncrementalSyncAt?: string;
  dirtyAt?: string;
  lastNotificationAt?: string;
  lastNotificationNumber?: string;
  eventsMirror?: GoogleCalendarEvent[];
  pendingItems: Item[];
  deliveryVersion: number;
  channel?: GoogleCalendarWatchState;
}



export function googleCalendarSyncStatePath(): string {
  return process.env.GOOGLE_CALENDAR_SYNC_STATE_PATH || ".tmp/google-calendar-sync-state.json";
}

export function emptyGoogleCalendarSyncState(calendarId: string): GoogleCalendarSyncState {
  return {
    version: 1,
    calendarId,
    pendingItems: [],
    deliveryVersion: 0
  };
}

export function readGoogleCalendarSyncState(
  calendarId = process.env.GOOGLE_CALENDAR_ID || "primary"
): GoogleCalendarSyncState {
  const statePath = googleCalendarSyncStatePath();
  if (!fs.existsSync(/* turbopackIgnore: true */ statePath)) return emptyGoogleCalendarSyncState(calendarId);

  const payload = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ statePath, "utf8")) as unknown;
  if (!isSyncState(payload)) {
    throw new Error(`Invalid Google Calendar sync state: ${statePath}`);
  }
  if (payload.calendarId !== calendarId) {
    return emptyGoogleCalendarSyncState(calendarId);
  }
  return payload;
}

export function writeGoogleCalendarSyncState(state: GoogleCalendarSyncState): void {
  const statePath = googleCalendarSyncStatePath();
  const directory = path.dirname(statePath);
  fs.mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    fs.writeFileSync(/* turbopackIgnore: true */ temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(/* turbopackIgnore: true */ temporaryPath, statePath);
  } finally {
    if (fs.existsSync(/* turbopackIgnore: true */ temporaryPath)) {
      fs.unlinkSync(/* turbopackIgnore: true */ temporaryPath);
    }
  }
}

export async function resetGoogleCalendarSyncState(
  calendarId = process.env.GOOGLE_CALENDAR_ID || "primary"
): Promise<void> {
  await withGoogleCalendarSyncLock(() => {
    writeGoogleCalendarSyncState(emptyGoogleCalendarSyncState(calendarId));
  });
}

export async function withGoogleCalendarSyncLock<T>(task: () => Promise<T> | T): Promise<T> {
  const filename = googleCalendarSyncStatePath();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const release = await lockfile.lock(filename, { realpath: false, stale: 120_000, update: 10_000,
    retries: { retries: 100, minTimeout: 50, maxTimeout: 300 } });
  try { return await task(); } finally { await release(); }
}

function isSyncState(value: unknown): value is GoogleCalendarSyncState {
  if (!isRecord(value)) return false;
  return value.version === 1
    && typeof value.calendarId === "string"
    && Array.isArray(value.pendingItems)
    && typeof value.deliveryVersion === "number"
    && (value.syncToken === undefined || typeof value.syncToken === "string")
    && (value.channel === undefined || isWatchState(value.channel));
}

function isWatchState(value: unknown): value is GoogleCalendarWatchState {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.resourceId === "string"
    && typeof value.token === "string"
    && typeof value.createdAt === "string"
    && (value.expiration === undefined || typeof value.expiration === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
