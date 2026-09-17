import { assertCheckInOwner } from "../../../src/check-ins/auth.js";
import { pushConfiguration } from "../../../src/check-ins/service.js";
import { externalApiError, externalApiJson } from "../../../src/external-api/http.js";
import { withCheckInState } from "../../../src/check-ins/store.js";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await assertCheckInOwner(request);
    const { configured, publicKey } = pushConfiguration();
    const lastDispatchAt = await withCheckInState((state) => state.lastDispatchAt ?? null, false);
    return externalApiJson(request, { configured, publicKey: configured ? publicKey : null, lastDispatchAt });
  } catch (error) { return externalApiError(request, error); }
}
