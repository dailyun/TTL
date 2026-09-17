import { assertCheckInOwner, readCheckInJson } from "../../../../../src/check-ins/auth.js";
import { answerCheckIn } from "../../../../../src/check-ins/service.js";
import { idSchema } from "../../../../../src/check-ins/schema.js";
import { externalApiError, externalApiJson } from "../../../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await assertCheckInOwner(request, true);
    const id = idSchema.parse((await context.params).id);
    return externalApiJson(request, { data: await answerCheckIn(id, await readCheckInJson(request)) });
  } catch (error) { return externalApiError(request, error); }
}
