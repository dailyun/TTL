import {
  deleteGoogleCalendarEvent,
  googleCalendarConfigFromEnv,
  refreshGoogleCalendarAccessToken
} from "../../../../src/index.js";
import type { Item } from "../../../../src/index.js";
import { jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      item?: Item;
    };
    const item = body.item;

    if (!item || item.source !== "google_calendar" || item.sourceLink?.provider !== "google_calendar") {
      return jsonError(new Error("Request must include a Google Calendar sourced item"), 400);
    }
    if (!item.sourceLink.calendarId || !item.sourceLink.eventId) {
      return jsonError(new Error("Google Calendar sourced item is missing calendarId or eventId"), 400);
    }

    const config = googleCalendarConfigFromEnv();
    const token = await refreshGoogleCalendarAccessToken(config);
    await deleteGoogleCalendarEvent({
      accessToken: token.access_token,
      calendarId: item.sourceLink.calendarId,
      eventId: item.sourceLink.eventId,
      etag: item.sourceLink.etag
    });

    return jsonOk({
      calendarId: item.sourceLink.calendarId,
      eventId: item.sourceLink.eventId,
      ok: true
    });
  } catch (error) {
    return jsonError(error);
  }
}
