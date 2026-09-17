import {
  acceptGoogleCalendarNotification,
  startGoogleCalendarWatch,
  syncGoogleCalendarRealtime
} from "../../../../src/google-calendar/realtime.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const notification = await acceptGoogleCalendarNotification(request.headers);
    if (!notification.accepted) return new Response(null, { status: 404 });
    if (notification.shouldSync) {
      await syncGoogleCalendarRealtime({ force: true });
    }
    await startGoogleCalendarWatch();
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 500 });
  }
}
