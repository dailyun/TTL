import { z } from "zod";
import { assertCheckInOwner, readCheckInJson } from "../../../../src/check-ins/auth.js";
import { subscribeDevice, unsubscribeDevice } from "../../../../src/check-ins/service.js";
import { externalApiError, externalApiJson } from "../../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await assertCheckInOwner(request, true);
    return externalApiJson(request, await subscribeDevice(await readCheckInJson(request)));
  } catch (error) { return externalApiError(request, error); }
}
export async function DELETE(request: Request) {
  try {
    await assertCheckInOwner(request, true);
    const { id } = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await readCheckInJson(request));
    return externalApiJson(request, await unsubscribeDevice(id));
  } catch (error) { return externalApiError(request, error); }
}
