import { stopGoogleCalendarWatch } from "../../../../../src/google-calendar/realtime.js";
import { jsonError, jsonOk } from "../../../github/_shared.js";

export const runtime = "nodejs";

export async function POST() {
  try {
    return jsonOk(await stopGoogleCalendarWatch());
  } catch (error) {
    return jsonError(error);
  }
}
