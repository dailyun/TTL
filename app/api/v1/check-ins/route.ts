import { assertExternalApiAuthorized } from "../../../../src/external-api/auth.js";
import { readCheckInJson } from "../../../../src/check-ins/auth.js";
import { createCheckIn, listCheckIns } from "../../../../src/check-ins/service.js";
import { idSchema } from "../../../../src/check-ins/schema.js";
import { externalApiError, externalApiJson } from "../../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    const id = new URL(request.url).searchParams.get("id");
    return externalApiJson(request, await listCheckIns(id ? idSchema.parse(id) : undefined));
  } catch (error) { return externalApiError(request, error); }
}
export async function POST(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    return externalApiJson(request, { data: await createCheckIn(await readCheckInJson(request)) }, { status: 201 });
  } catch (error) { return externalApiError(request, error); }
}
