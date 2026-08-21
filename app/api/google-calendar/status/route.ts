import { readStoredGoogleCalendarRefreshToken } from "../../../../src/google-calendar/token-store.js";

export const runtime = "nodejs";

export function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  const refreshToken = readStoredGoogleCalendarRefreshToken() ?? process.env.GOOGLE_REFRESH_TOKEN ?? "";

  return Response.json({
    oauthConfigured: Boolean(clientId && clientSecret && redirectUri),
    importConfigured: Boolean(clientId && clientSecret && redirectUri && refreshToken),
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasRedirectUri: Boolean(redirectUri),
    hasRefreshToken: Boolean(refreshToken),
    redirectUri: redirectUri || undefined,
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    sectionId: process.env.GOOGLE_CALENDAR_SECTION || "work"
  }, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
