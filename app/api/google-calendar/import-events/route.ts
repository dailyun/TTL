import {
  googleCalendarConfigFromEnv,
  googleCalendarEventToItem,
  listGoogleCalendarEvents,
  refreshGoogleCalendarAccessToken
} from "../../../../src/index.js";
import { jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      daysBack?: number;
      daysForward?: number;
    };
    const config = googleCalendarConfigFromEnv();
    const now = new Date();
    const timeMin = addDays(now, -(body.daysBack ?? 14)).toISOString();
    const timeMax = addDays(now, body.daysForward ?? 90).toISOString();
    const token = await refreshGoogleCalendarAccessToken(config);
    const events = await listGoogleCalendarEvents({
      accessToken: token.access_token,
      calendarId: config.calendarId,
      timeMin,
      timeMax
    });
    const items = events
      .map((event) =>
        googleCalendarEventToItem({
          calendarId: config.calendarId,
          event,
          sectionId: config.sectionId
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return jsonOk({
      calendarId: config.calendarId,
      eventCount: events.length,
      itemCount: items.length,
      items,
      timeMax,
      timeMin
    });
  } catch (error) {
    return jsonError(error);
  }
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(value.getDate() + amount);
  return next;
}
