import { z } from "zod";
import { assertExternalApiAuthorized } from "../../../../src/external-api/auth.js";
import { feedbackFeed } from "../../../../src/check-ins/service.js";
import { idSchema } from "../../../../src/check-ins/schema.js";
import { externalApiError, externalApiJson } from "../../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    const { after, limit, id } = z.object({ after: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(200).default(100), id: idSchema.optional() }).parse(Object.fromEntries(new URL(request.url).searchParams));
    return externalApiJson(request, await feedbackFeed(after, limit, id));
  } catch (error) { return externalApiError(request, error); }
}
