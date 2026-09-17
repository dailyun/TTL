import { z } from "zod";
import { assertExternalApiAuthorized } from "../../../../../src/external-api/auth.js";
import { readCheckInJson } from "../../../../../src/check-ins/auth.js";
import { updateCheckIn } from "../../../../../src/check-ins/service.js";
import { idSchema } from "../../../../../src/check-ins/schema.js";
import { externalApiError, externalApiJson } from "../../../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertExternalApiAuthorized(request);
    const id = idSchema.parse((await context.params).id);
    const { version, ...change } = z.object({
      version: z.number().int().positive(), dueAt: z.string().datetime({ offset: true }).optional(), status: z.literal("cancelled").optional()
    }).strict().refine((v) => Boolean(v.dueAt || v.status)).parse(await readCheckInJson(request));
    return externalApiJson(request, { data: await updateCheckIn(id, version, change) });
  } catch (error) { return externalApiError(request, error); }
}
