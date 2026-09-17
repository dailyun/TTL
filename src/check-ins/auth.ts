import { isSimpleAuthEnabled, SIMPLE_AUTH_COOKIE, verifySimpleSessionToken } from "../auth/simple-auth.js";
import { ExternalApiError } from "../external-api/errors.js";

export async function assertCheckInOwner(request: Request, write = false): Promise<void> {
  const url = new URL(request.url);
  const configuredOrigin = process.env.TODOTODOLIST_PUBLIC_URL;
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : url.origin;
  if (write && (request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json"))) {
    throw new ExternalApiError(403, "origin_required", "请从本站页面提交。");
  }
  if (!isSimpleAuthEnabled()) {
    if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new ExternalApiError(503, "login_required", "请先配置 TodoTodoList 的登录密码。");
    }
    return;
  }
  const cookies = request.headers.get("cookie") || "";
  const token = cookies.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${SIMPLE_AUTH_COOKIE}=`))?.slice(SIMPLE_AUTH_COOKIE.length + 1);
  if (!await verifySimpleSessionToken(token)) throw new ExternalApiError(401, "unauthorized", "请先登录。");
}

export async function readCheckInJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (body.length > 20_000) throw new ExternalApiError(413, "too_large", "请求内容过长。");
  try { return JSON.parse(body); }
  catch { throw new ExternalApiError(400, "invalid_json", "请求必须是 JSON。"); }
}
