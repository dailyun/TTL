import { assertCheckInOwner } from "../../../src/check-ins/auth.js";
import { canonicalEnabled, readWorkspace, mergeWorkspace, workspaceCommand } from "../../../src/execution/service.js";
import { externalApiError, externalApiJson } from "../../../src/external-api/http.js";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { await assertCheckInOwner(request); return externalApiJson(request, canonicalEnabled() ? await readWorkspace() : { mode: "legacy" }); }
  catch (error) { return externalApiError(request, error); }
}
export async function POST(request: Request) {
  try {
    await assertCheckInOwner(request, true);
    if (!canonicalEnabled()) return Response.json({ error: { message: "服务器工作区未配置" } }, { status: 503 });
    const text = await request.text();
    if (text.length > 30_000_000) return Response.json({ error: { message: "一次导入最多 30 MB，请分批导入" } }, { status: 413 });
    const body = JSON.parse(text);
    return externalApiJson(request, body.type ? await workspaceCommand(body) : await mergeWorkspace(body));
  } catch (error) { return externalApiError(request, error); }
}
