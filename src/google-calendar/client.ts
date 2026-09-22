import type { Item } from "../domain/types.js";
import {
  addDaysToDateKey,
  allDayDateKeyFromIso,
  allDayIsoFromDateKey
} from "../calendar/all-day.js";
import { readStoredGoogleCalendarRefreshToken } from "./token-store.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
  calendarId: string;
  sectionId: string;
}

export interface GoogleCalendarTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface GoogleCalendarEventDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
  recurringEventId?: string;
  originalStartTime?: GoogleCalendarEventDate;
  transparency?: "opaque" | "transparent";
  extendedProperties?: { private?: Record<string, string> };
  id: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  start?: GoogleCalendarEventDate;
  end?: GoogleCalendarEventDate;
  updated?: string;
  created?: string;
}

export interface GoogleCalendarEventPatch {
  reminders?: { useDefault: boolean; overrides: Array<{ method: "popup"; minutes: number }> };
  id?: string;
  extendedProperties?: { private?: Record<string, string> };
  description?: string;
  end?: GoogleCalendarEventDate;
  start?: GoogleCalendarEventDate;
  summary?: string;
}

export interface GoogleCalendarEventsResponse {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleCalendarEventChanges {
  events: GoogleCalendarEvent[];
  nextSyncToken: string;
}

export interface GoogleCalendarWatchChannel {
  id: string;
  resourceId: string;
  resourceUri?: string;
  token?: string;
  expiration?: string;
}

export class GoogleCalendarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string
  ) {
    super(message);
    this.name = "GoogleCalendarApiError";
  }
}

export function googleCalendarConfigFromEnv(): GoogleCalendarConfig {
  return {
    clientId: requiredEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: requiredEnv("GOOGLE_REDIRECT_URI"),
    refreshToken: readStoredGoogleCalendarRefreshToken() ?? process.env.GOOGLE_REFRESH_TOKEN,
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    sectionId: process.env.GOOGLE_CALENDAR_SECTION || "work"
  };
}

export function buildGoogleCalendarAuthUrl(config: GoogleCalendarConfig, state: string): string {
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: config.clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    state
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCalendarCode(
  config: GoogleCalendarConfig,
  code: string
): Promise<GoogleCalendarTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    })
  });

  return parseGoogleResponse<GoogleCalendarTokenResponse>(response);
}

export async function refreshGoogleCalendarAccessToken(
  config: GoogleCalendarConfig
): Promise<GoogleCalendarTokenResponse> {
  if (!config.refreshToken) {
    throw new Error("Missing required environment variable: GOOGLE_REFRESH_TOKEN");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: config.refreshToken
    })
  });

  return parseGoogleResponse<GoogleCalendarTokenResponse>(response);
}

export async function listGoogleCalendarEvents(params: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
}): Promise<GoogleCalendarEvent[]> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      maxResults: "250",
      orderBy: "startTime",
      showDeleted: "true",
      singleEvents: "true",
      timeMax: params.timeMax,
      timeMin: params.timeMin
    });
    if (pageToken) query.set("pageToken", pageToken);

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events?${query.toString()}`,
      {
        signal: AbortSignal.timeout(25_000),
        headers: {
          authorization: `Bearer ${params.accessToken}`
        }
      }
    );
    const payload = await parseGoogleResponse<GoogleCalendarEventsResponse>(response);
    events.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return events;
}

export async function listGoogleCalendarEventChanges(params: {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
}): Promise<GoogleCalendarEventChanges> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const query = new URLSearchParams({
      maxResults: "250",
      showDeleted: "true",
      singleEvents: "true"
    });
    if (params.syncToken) {
      query.set("syncToken", params.syncToken);
    } else {
      if (params.timeMin) query.set("timeMin", params.timeMin);
      if (params.timeMax) query.set("timeMax", params.timeMax);
    }
    if (pageToken) query.set("pageToken", pageToken);

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events?${query.toString()}`,
      {
        signal: AbortSignal.timeout(25_000),
        headers: {
          authorization: `Bearer ${params.accessToken}`
        }
      }
    );
    const payload = await parseGoogleResponse<GoogleCalendarEventsResponse>(response);
    events.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken;
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  if (!nextSyncToken) {
    throw new Error("Google Calendar sync response did not include nextSyncToken");
  }

  return { events, nextSyncToken };
}

export async function watchGoogleCalendarEvents(params: {
  accessToken: string;
  calendarId: string;
  channelId: string;
  address: string;
  token: string;
  expiration: number;
}): Promise<GoogleCalendarWatchChannel> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events/watch`,
    {
      method: "POST",
    signal: AbortSignal.timeout(25_000),
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: params.channelId,
        type: "web_hook",
        address: params.address,
        token: params.token,
        expiration: String(params.expiration)
      })
    }
  );

  return parseGoogleResponse<GoogleCalendarWatchChannel>(response);
}

export async function stopGoogleCalendarWatchChannel(params: {
  accessToken: string;
  channelId: string;
  resourceId: string;
}): Promise<void> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/channels/stop`, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: params.channelId,
      resourceId: params.resourceId
    })
  });

  if (response.status === 404 || response.status === 410) return;
  if (!response.ok) await parseGoogleResponse<unknown>(response);
}

export async function getGoogleCalendarEvent(params: { accessToken: string; calendarId: string; eventId: string }): Promise<GoogleCalendarEvent> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`, {
    headers: { authorization: `Bearer ${params.accessToken}` }, signal: AbortSignal.timeout(25_000)
  });
  return parseGoogleResponse<GoogleCalendarEvent>(response);
}

export async function patchGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  etag?: string;
  patch: GoogleCalendarEventPatch;
}): Promise<GoogleCalendarEvent> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}?sendUpdates=none`,
    {
      method: "PATCH",
      signal: AbortSignal.timeout(25_000),
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json",
        ...(params.etag ? { "if-match": params.etag } : {})
      },
      body: JSON.stringify(params.patch)
    }
  );

  return parseGoogleResponse<GoogleCalendarEvent>(response);
}

export async function createGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId: string;
  event: GoogleCalendarEventPatch;
}): Promise<GoogleCalendarEvent> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events?sendUpdates=none`,
    {
      method: "POST",
    signal: AbortSignal.timeout(25_000),
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(params.event)
    }
  );

  return parseGoogleResponse<GoogleCalendarEvent>(response);
}

export async function deleteGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  etag?: string;
}): Promise<void> {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}?sendUpdates=none`,
    {
      method: "DELETE",
      signal: AbortSignal.timeout(25_000),
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        ...(params.etag ? { "if-match": params.etag } : {})
      }
    }
  );

  if (response.status === 404 || response.status === 410) {
    return;
  }

  if (!response.ok) {
    await parseGoogleResponse<unknown>(response);
  }
}

export function googleCalendarEventToItem(params: {
  calendarId: string;
  event: GoogleCalendarEvent;
  sectionId: string;
  now?: Date;
}): Item | null {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  if (params.event.status === "cancelled") {
    return {
      id: stableGoogleItemId(params.calendarId, params.event.id),
      type: "event",
      title: params.event.summary?.trim() || "已取消的 Google Calendar 事件",
      description: googleEventDescription(params.event),
      sectionId: params.sectionId,
      status: "abandoned",
      tags: ["google-calendar"],
      source: "google_calendar",
      sourceLink: {
        provider: "google_calendar",
        sourceId: "google-calendar",
        calendarId: params.calendarId,
        eventId: params.event.id,
        etag: params.event.etag,
        writeBack: "none"
      },
      createdAt: params.event.created ?? params.event.updated ?? nowIso,
      updatedAt: params.event.updated ?? nowIso,
      deletedAt: params.event.updated ?? nowIso
    };
  }

  if (!params.event.start) return null;

  const startAt = googleDateToIso(params.event.start);
  const endAt = googleEndDateToIso(params.event.end, params.event.start);
  if (!startAt) return null;

  return {
    id: stableGoogleItemId(params.calendarId, params.event.id),
    type: "event",
    title: params.event.summary?.trim() || "未命名日程",
    description: googleEventDescription(params.event),
    sectionId: params.sectionId,
    // Calendar time is a plan; only actual user feedback can establish completion.
    status: "active",
    tags: ["google-calendar"],
    startAt,
    endAt,
    allDay: Boolean(params.event.start.date),
    source: "google_calendar",
    sourceLink: {
      provider: "google_calendar",
      sourceId: "google-calendar",
      calendarId: params.calendarId,
      eventId: params.event.id,
      etag: params.event.etag,
      writeBack: "none"
    },
    createdAt: params.event.created ?? nowIso,
    updatedAt: params.event.updated ?? nowIso
  };
}

export function googleCalendarPatchFromItem(item: Item): GoogleCalendarEventPatch {
  if (!item.startAt) {
    throw new Error("Google Calendar writeback requires startAt");
  }

  const patch: GoogleCalendarEventPatch = {
    description: item.description,
    summary: item.title
  };

  if (item.allDay) {
    const startDate = allDayDateKeyFromIso(item.startAt);
    const endDate = allDayDateKeyFromIso(item.endAt ?? item.startAt);
    patch.start = {
      date: startDate
    };
    patch.end = {
      date: addDaysToDateKey(endDate, 1)
    };
  } else {
    patch.start = {
      dateTime: new Date(item.startAt).toISOString()
    };
    patch.end = {
      dateTime: new Date(item.endAt ?? item.startAt).toISOString()
    };
  }

  return patch;
}

function googleDateToIso(value?: GoogleCalendarEventDate): string | undefined {
  if (!value) return undefined;
  if (value.dateTime) return new Date(value.dateTime).toISOString();
  if (value.date) return allDayIsoFromDateKey(value.date);
  return undefined;
}

function googleEndDateToIso(
  end: GoogleCalendarEventDate | undefined,
  start: GoogleCalendarEventDate
): string | undefined {
  if (!end) return undefined;
  if (end.dateTime) return new Date(end.dateTime).toISOString();
  if (!end.date) return undefined;

  const endDate = allDayIsoFromDateKey(end.date);
  if (!endDate) return undefined;
  if (start.date) {
    return allDayIsoFromDateKey(addDaysToDateKey(end.date, -1));
  }
  return endDate;
}

function googleEventDescription(event: GoogleCalendarEvent): string {
  return [
    event.description?.trim(),
    event.location ? `地点：${event.location}` : undefined,
    event.htmlLink ? `Google Calendar：${event.htmlLink}` : undefined
  ]
    .filter(Boolean)
    .join("\n\n");
}

function stableGoogleItemId(calendarId: string, eventId: string): string {
  return `google_${slug(calendarId)}_${slug(eventId)}`;
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
}

async function parseGoogleResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string | { message?: string };
    error_description?: string;
  };

  if (!response.ok) {
    const message =
      typeof payload.error === "object"
        ? payload.error.message
        : payload.error_description ?? payload.error;
    throw new GoogleCalendarApiError(
      message || `Google Calendar request failed: ${response.status}`,
      response.status,
      response.statusText
    );
  }

  return payload;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
