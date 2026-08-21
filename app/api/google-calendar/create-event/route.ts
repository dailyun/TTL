import {
  createGoogleCalendarEvent,
  googleCalendarConfigFromEnv,
  googleCalendarPatchFromItem,
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

    if (!item) {
      return jsonError(new Error("Request must include an item"), 400);
    }
    if (item.source !== "local") {
      return jsonError(new Error("Only local items can be created in Google Calendar"), 400);
    }
    if (item.type === "idea") {
      return jsonError(new Error("Ideas are not synced to Google Calendar"), 400);
    }
    if (!item.startAt) {
      return jsonError(new Error("Google Calendar sync requires a start time"), 400);
    }

    const config = googleCalendarConfigFromEnv();
    const token = await refreshGoogleCalendarAccessToken(config);
    const event = await createGoogleCalendarEvent({
      accessToken: token.access_token,
      calendarId: config.calendarId,
      event: googleCalendarPatchFromItem(item)
    });

    return jsonOk({
      calendarId: config.calendarId,
      eventId: event.id,
      etag: event.etag,
      htmlLink: event.htmlLink,
      ok: true
    });
  } catch (error) {
    return jsonError(error);
  }
}
