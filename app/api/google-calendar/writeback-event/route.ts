import {
  GoogleCalendarApiError,
  googleCalendarConfigFromEnv,
  googleCalendarPatchFromItem,
  patchGoogleCalendarEvent,
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
    const event = await patchGoogleCalendarEvent({
      accessToken: token.access_token,
      calendarId: item.sourceLink.calendarId,
      eventId: item.sourceLink.eventId,
      etag: item.sourceLink.etag,
      patch: googleCalendarPatchFromItem(item)
    });

    return jsonOk({
      calendarId: item.sourceLink.calendarId,
      eventId: item.sourceLink.eventId,
      etag: event.etag,
      ok: true
    });
  } catch (error) {
    if (error instanceof GoogleCalendarApiError && error.status === 412) {
      return jsonError(
        new Error("Google Calendar 事件已在远端更新，请先重新导入日程后再修改。"),
        409
      );
    }
    return jsonError(error);
  }
}
