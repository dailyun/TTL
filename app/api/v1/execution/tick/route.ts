import { z } from "zod";
import { assertExternalApiAuthorized } from "../../../../../src/external-api/auth.js";
import { externalApiError, externalApiJson } from "../../../../../src/external-api/http.js";
import { canonicalEnabled, readWorkspace, publishAction, executionChanges, saveBrief, plannerStatus } from "../../../../../src/execution/service.js";
import { runExecutionWorker } from "../../../../../src/execution/calendar.js";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    if (!canonicalEnabled()) return Response.json({ error: { message: "服务器工作区未配置" } }, { status: 503 });
    return externalApiJson(request, await runExecutionWorker());
  } catch (error) { return externalApiError(request, error); }
}
