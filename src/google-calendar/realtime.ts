import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Item } from "../domain/types.js";
import {
  GoogleCalendarApiError,
  googleCalendarConfigFromEnv,
  googleCalendarEventToItem,
  listGoogleCalendarEventChanges,
  refreshGoogleCalendarAccessToken,
  stopGoogleCalendarWatchChannel,
  watchGoogleCalendarEvents,
  type GoogleCalendarEvent,
  type GoogleCalendarEventChanges
} from "./client.js";
import {
  readGoogleCalendarSyncState,
  withGoogleCalendarSyncLock,
  writeGoogleCalendarSyncState,
  type GoogleCalendarSyncState
} from "./sync-state.js";

const DEFAULT_FALLBACK_POLL_SECONDS = 300;
const DEFAULT_WATCH_TTL_SECONDS = 6 * 24 * 60 * 60;
const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface GoogleCalendarRealtimeSyncResult {
  calendarId: string;
  deliveryVersion: number;
  items: Item[];
  events: GoogleCalendarEvent[];
  pulledEventCount: number;
  mode: "full" | "incremental" | "skipped";
  syncedAt?: string;
}

export async function syncGoogleCalendarRealtime(options: {
  force?: boolean;
  now?: Date;
} = {}): Promise<GoogleCalendarRealtimeSyncResult> {
  return withGoogleCalendarSyncLock(async () => {
    const config = googleCalendarConfigFromEnv();
    let state = readGoogleCalendarSyncState(config.calendarId);
    const now = options.now ?? new Date();
    const latestSyncAt = state.lastIncrementalSyncAt ?? state.lastFullSyncAt;
    const fallbackPollMs = envInteger(
      "GOOGLE_CALENDAR_FALLBACK_POLL_SECONDS",
      DEFAULT_FALLBACK_POLL_SECONDS,
      15,
      3600
    ) * 1000;
    const isFallbackDue = !latestSyncAt || now.getTime() - new Date(latestSyncAt).getTime() >= fallbackPollMs;

    if (state.syncToken && !options.force && !state.dirtyAt && !isFallbackDue) {
      return resultFromState(state, "skipped", 0, latestSyncAt);
    }

    const token = await refreshGoogleCalendarAccessToken(config);
    let mode: "full" | "incremental" = state.syncToken ? "incremental" : "full";
    let changes: GoogleCalendarEventChanges;

    try {
      changes = await listGoogleCalendarEventChanges({
        accessToken: token.access_token,
        calendarId: config.calendarId,
        ...(state.syncToken
          ? { syncToken: state.syncToken }
          : initialSyncWindow(now))
      });
    } catch (error) {
      if (!(error instanceof GoogleCalendarApiError) || error.status !== 410 || !state.syncToken) {
        throw error;
      }

      mode = "full";
      state = {
        ...state,
        syncToken: undefined,
        lastFullSyncAt: undefined,
        lastIncrementalSyncAt: undefined
      };
      changes = await listGoogleCalendarEventChanges({
        accessToken: token.access_token,
        calendarId: config.calendarId,
        ...initialSyncWindow(now)
      });
    }

    const syncedAt = now.toISOString();
    const incomingItems = changes.events
      .map((event) => googleCalendarEventToItem({
        calendarId: config.calendarId,
        event,
        sectionId: config.sectionId,
        now
      }))
      .filter((item): item is Item => Boolean(item));
    const pendingItems = mergePendingItems(state.pendingItems, incomingItems);
    const deliveryVersion = incomingItems.length > 0
      ? state.deliveryVersion + 1
      : state.deliveryVersion;

    state = {
      ...state,
      eventsMirror: mergeEventMirror(state.eventsMirror ?? [], changes.events, mode === "full", now),
      syncToken: changes.nextSyncToken,
      dirtyAt: undefined,
      pendingItems,
      deliveryVersion,
      ...(mode === "full"
        ? { lastFullSyncAt: syncedAt, lastIncrementalSyncAt: undefined }
        : { lastIncrementalSyncAt: syncedAt })
    };
    writeGoogleCalendarSyncState(state);

    return resultFromState(state, mode, changes.events.length, syncedAt);
  });
}

export async function acknowledgeGoogleCalendarDelivery(deliveryVersion: number): Promise<boolean> {
  return withGoogleCalendarSyncLock(() => {
    const config = googleCalendarConfigFromEnv();
    const state = readGoogleCalendarSyncState(config.calendarId);
    if (state.deliveryVersion !== deliveryVersion) return false;
    if (state.pendingItems.length === 0) return true;

    writeGoogleCalendarSyncState({
      ...state,
      pendingItems: []
    });
    return true;
  });
}

export async function startGoogleCalendarWatch(now = new Date()): Promise<{
  active: boolean;
  calendarId: string;
  channelId: string;
  expiration?: string;
  reused: boolean;
}> {
  return withGoogleCalendarSyncLock(async () => {
    const config = googleCalendarConfigFromEnv();
    const webhookUrl = requiredWebhookUrl();
    const state = readGoogleCalendarSyncState(config.calendarId);
    if (state.channel && !channelNeedsRenewal(state.channel.expiration, now)) {
      return {
        active: true,
        calendarId: config.calendarId,
        channelId: state.channel.id,
        expiration: state.channel.expiration,
        reused: true
      };
    }

    const accessToken = await refreshGoogleCalendarAccessToken(config);
    const channelId = randomUUID();
    const channelToken = randomBytes(32).toString("base64url");
    const expiration = now.getTime() + envInteger(
      "GOOGLE_CALENDAR_WATCH_TTL_SECONDS",
      DEFAULT_WATCH_TTL_SECONDS,
      3600,
      7 * 24 * 60 * 60
    ) * 1000;
    const channel = await watchGoogleCalendarEvents({
      accessToken: accessToken.access_token,
      calendarId: config.calendarId,
      channelId,
      address: webhookUrl,
      token: channelToken,
      expiration
    });
    const nextState: GoogleCalendarSyncState = {
      ...state,
      dirtyAt: state.dirtyAt ?? now.toISOString(),
      channel: {
        id: channel.id,
        resourceId: channel.resourceId,
        resourceUri: channel.resourceUri,
        token: channelToken,
        expiration: String(channel.expiration ?? expiration),
        createdAt: now.toISOString()
      }
    };
    writeGoogleCalendarSyncState(nextState);

    if (state.channel) {
      await stopGoogleCalendarWatchChannel({
        accessToken: accessToken.access_token,
        channelId: state.channel.id,
        resourceId: state.channel.resourceId
      }).catch(() => undefined);
    }

    return {
      active: true,
      calendarId: config.calendarId,
      channelId: channel.id,
      expiration: nextState.channel?.expiration,
      reused: false
    };
  });
}

export async function stopGoogleCalendarWatch(): Promise<{ stopped: boolean }> {
  return withGoogleCalendarSyncLock(async () => {
    const config = googleCalendarConfigFromEnv();
    const state = readGoogleCalendarSyncState(config.calendarId);
    if (!state.channel) return { stopped: false };

    const accessToken = await refreshGoogleCalendarAccessToken(config);
    await stopGoogleCalendarWatchChannel({
      accessToken: accessToken.access_token,
      channelId: state.channel.id,
      resourceId: state.channel.resourceId
    });
    writeGoogleCalendarSyncState({
      ...state,
      channel: undefined
    });
    return { stopped: true };
  });
}

export async function acceptGoogleCalendarNotification(headers: Headers, now = new Date()): Promise<{
  accepted: boolean;
  shouldSync: boolean;
}> {
  return withGoogleCalendarSyncLock(() => {
    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
    const state = readGoogleCalendarSyncState(calendarId);
    const channelId = headers.get("x-goog-channel-id") ?? "";
    const channelToken = headers.get("x-goog-channel-token") ?? "";
    const resourceId = headers.get("x-goog-resource-id") ?? "";
    const resourceState = headers.get("x-goog-resource-state") ?? "";
    const messageNumber = headers.get("x-goog-message-number") ?? undefined;

    if (!state.channel
      || channelId !== state.channel.id
      || resourceId !== state.channel.resourceId
      || !safeEqual(channelToken, state.channel.token)) {
      return { accepted: false, shouldSync: false };
    }

    const shouldSync = resourceState === "exists" || resourceState === "not_exists";
    const timestamp = now.toISOString();
    writeGoogleCalendarSyncState({
      ...state,
      dirtyAt: shouldSync ? timestamp : state.dirtyAt,
      lastNotificationAt: timestamp,
      lastNotificationNumber: messageNumber ?? state.lastNotificationNumber
    });
    return { accepted: true, shouldSync };
  });
}

export function getGoogleCalendarRealtimeStatus(now = new Date()) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const state = readGoogleCalendarSyncState(calendarId);
  const webhookConfigured = Boolean(process.env.GOOGLE_CALENDAR_WEBHOOK_URL);
  const channelActive = Boolean(
    state.channel?.expiration
      && Number(state.channel.expiration) > now.getTime()
  );

  return {
    webhookConfigured,
    channelActive,
    channelExpiration: state.channel?.expiration,
    channelNeedsRenewal: Boolean(state.channel && channelNeedsRenewal(state.channel.expiration, now)),
    hasSyncToken: Boolean(state.syncToken),
    lastFullSyncAt: state.lastFullSyncAt,
    lastIncrementalSyncAt: state.lastIncrementalSyncAt,
    lastNotificationAt: state.lastNotificationAt,
    pendingItemCount: state.pendingItems.length
  };
}

function resultFromState(
  state: GoogleCalendarSyncState,
  mode: GoogleCalendarRealtimeSyncResult["mode"],
  pulledEventCount: number,
  syncedAt?: string
): GoogleCalendarRealtimeSyncResult {
  return {
    calendarId: state.calendarId,
    deliveryVersion: state.deliveryVersion,
    items: state.pendingItems,
    events: state.eventsMirror ?? [],
    pulledEventCount,
    mode,
    syncedAt
  };
}

function mergePendingItems(existing: Item[], incoming: Item[]): Item[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = merged.get(item.id);
    if (!current || item.updatedAt >= current.updatedAt) merged.set(item.id, item);
  }
  return Array.from(merged.values());
}

function initialSyncWindow(now: Date): { timeMin: string; timeMax: string } {
  return {
    timeMin: addDays(now, -envInteger("GOOGLE_CALENDAR_INITIAL_DAYS_BACK", 30, 0, 3650)).toISOString(),
    timeMax: addDays(now, envInteger("GOOGLE_CALENDAR_INITIAL_DAYS_FORWARD", 365, 1, 3650)).toISOString()
  };
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function requiredWebhookUrl(): string {
  const raw = process.env.GOOGLE_CALENDAR_WEBHOOK_URL;
  if (!raw) throw new Error("Missing required environment variable: GOOGLE_CALENDAR_WEBHOOK_URL");
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("GOOGLE_CALENDAR_WEBHOOK_URL must use HTTPS");
  }
  return url.toString();
}

function channelNeedsRenewal(expiration: string | undefined, now: Date): boolean {
  if (!expiration) return true;
  const expirationTime = Number(expiration);
  return !Number.isFinite(expirationTime)
    || expirationTime - now.getTime() <= WATCH_RENEWAL_WINDOW_MS;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function mergeEventMirror(previous: GoogleCalendarEvent[], incoming: GoogleCalendarEvent[], full: boolean, now: Date): GoogleCalendarEvent[] {
  const records = new Map(previous.map(e => [e.id, e]));
  if (full) {
    const window = initialSyncWindow(now);
    const incomingIds = new Set(incoming.map(e => e.id));
    for (const e of previous) {
      const at = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : undefined);
      if (at && Date.parse(at) >= Date.parse(window.timeMin) && Date.parse(at) < Date.parse(window.timeMax) && !incomingIds.has(e.id)) records.set(e.id, { ...e, status: "cancelled" });
    }
  }
  for (const event of incoming) records.set(event.id, { ...records.get(event.id), ...event });
  return [...records.values()];
}
