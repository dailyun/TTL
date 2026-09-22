import { assertExternalApiAuthorized } from "../../../../src/external-api/auth.js";
import { externalApiError, externalApiJson } from "../../../../src/external-api/http.js";
import { calendarCommand, readCalendar } from "../../../../src/execution/calendar-api.js";
import { canonicalEnabled } from "../../../../src/execution/service.js";

export const runtime = "nodejs";
function authorize(request: Request) {
  assertExternalApiAuthorized(request);
  if (!canonicalEnabled()) throw new Error("Missing required environment variable: TODOTODOLIST_STATE_PATH");
}
export async function GET(request: Request) {
  try { authorize(request); return externalApiJson(request, await readCalendar(Object.fromEntries(new URL(request.url).searchParams))); }
  catch (error) { return externalApiError(request, error); }
}
export async function POST(request: Request) {
  try { authorize(request); return externalApiJson(request, await calendarCommand(await request.json())); }
  catch (error) { return externalApiError(request, error); }
}
