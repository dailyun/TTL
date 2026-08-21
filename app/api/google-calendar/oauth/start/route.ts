import { NextResponse } from "next/server";
import {
  buildGoogleCalendarAuthUrl,
  googleCalendarConfigFromEnv
} from "../../../../../src/index.js";
import { jsonError } from "../../../github/_shared.js";

export const runtime = "nodejs";

const STATE_COOKIE = "tdl_google_oauth_state";

export function GET(request: Request) {
  try {
    const config = googleCalendarConfigFromEnv();
    const state = crypto.randomUUID();
    const response = NextResponse.redirect(buildGoogleCalendarAuthUrl(config, state));
    response.headers.set("cache-control", "no-store");
    response.headers.set(
      "set-cookie",
      [
        `${STATE_COOKIE}=${state}`,
        "Path=/api/google-calendar/oauth",
        "Max-Age=600",
        "HttpOnly",
        "SameSite=Lax",
        process.env.NODE_ENV === "production" ? "Secure" : ""
      ]
        .filter(Boolean)
        .join("; ")
    );
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
