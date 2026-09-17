import { assertCheckInOwner } from "../../../src/check-ins/auth.js";
import { listCheckIns } from "../../../src/check-ins/service.js";
import { idSchema } from "../../../src/check-ins/schema.js";
import { externalApiError, externalApiJson } from "../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await assertCheckInOwner(request);
    const id = new URL(request.url).searchParams.get("id");
    return externalApiJson(request, await listCheckIns(id ? idSchema.parse(id) : undefined));
  } catch (error) { return externalApiError(request, error); }
}
