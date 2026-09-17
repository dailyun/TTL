import {
  acknowledgeGoogleCalendarDelivery,
  syncGoogleCalendarRealtime
} from "../../../../../src/google-calendar/realtime.js";
import { jsonError, jsonOk } from "../../../github/_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "sync" | "ack";
      deliveryVersion?: number;
      force?: boolean;
    };

    if (body.action === "ack") {
      if (!Number.isInteger(body.deliveryVersion) || (body.deliveryVersion ?? -1) < 0) {
        return jsonError(new Error("deliveryVersion must be a non-negative integer"), 400);
      }
      const acknowledged = await acknowledgeGoogleCalendarDelivery(body.deliveryVersion!);
      return jsonOk({ acknowledged, deliveryVersion: body.deliveryVersion });
    }

    return jsonOk(await syncGoogleCalendarRealtime({ force: body.force === true }));
  } catch (error) {
    return jsonError(error);
  }
}
