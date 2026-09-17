import { z } from "zod";
import { assertExternalApiAuthorized } from "../../../../src/external-api/auth.js";
import { externalApiError, externalApiJson } from "../../../../src/external-api/http.js";
import { canonicalEnabled, readWorkspace, publishAction, executionChanges, saveBrief, plannerStatus } from "../../../../src/execution/service.js";
import { runExecutionWorker } from "../../../../src/execution/calendar.js";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    if (!canonicalEnabled()) return Response.json({ error: { message: "服务器工作区未配置" } }, { status: 503 });
    const query = z.object({ after: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(Object.fromEntries(new URL(request.url).searchParams));
    return externalApiJson(request, await executionChanges(query.after, query.limit));
  } catch (error) { return externalApiError(request, error); }
}
