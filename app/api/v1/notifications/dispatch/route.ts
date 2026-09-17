import { assertExternalApiAuthorized } from "../../../../../src/external-api/auth.js";
import { dispatchCheckIns } from "../../../../../src/check-ins/service.js";
import { externalApiError, externalApiJson } from "../../../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    return externalApiJson(request, await dispatchCheckIns());
  } catch (error) { return externalApiError(request, error); }
}
