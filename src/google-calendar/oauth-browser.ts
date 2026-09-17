const OAUTH_PATH = "/api/google-calendar/oauth";

/** Keep the browser's state cookie on the public site during a domain migration.
 * Google still exchanges the code using its registered redirect_uri. The old
 * callback only relays to the configured public site, never a URL from input.
 */
export function canonicalGoogleOAuthRedirect(request: Request): Response | undefined {
  const configured = process.env.TODOTODOLIST_PUBLIC_URL;
  if (!configured) return;
  const requestUrl = new URL(request.url);
  if (![`${OAUTH_PATH}/start`, `${OAUTH_PATH}/callback`].includes(requestUrl.pathname)) return;
  const publicUrl = new URL(configured);
  const registered = new URL(process.env.GOOGLE_REDIRECT_URI || configured);
  const host = (request.headers.get("host") || requestUrl.host).toLowerCase();
  if (host === publicUrl.host.toLowerCase()) return;
  if (host !== registered.host.toLowerCase()) {
    return oauthProblem("授权地址与当前网站不一致", "请从日常使用的 TodoTodoList 网站重新发起授权。", 400);
  }
  const destination = new URL(requestUrl.pathname, publicUrl.origin);
  // Do not relay arbitrary parameters or trust user-supplied return URLs.
  if (requestUrl.pathname.endsWith("/callback")) {
    for (const key of ["code", "state", "error"]) {
      const value = requestUrl.searchParams.get(key);
      if (value) destination.searchParams.set(key, value);
    }
  }
  return new Response(null, { status: 303, headers: {
    location: destination.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer"
  } });
}

export function oauthProblem(title: string, detail: string, status = 400): Response {
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Google 日历连接</title><style>body{margin:0;background:#f7f8f5;color:#1d2428;font-family:system-ui,sans-serif}main{max-width:560px;margin:12vh auto;padding:28px}h1{font-size:25px}p{line-height:1.8;color:#576366}a{display:inline-block;margin:12px 18px 0 0;color:#176452}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><p>请在同一个 Safari 或 Chrome 浏览器中完成授权，途中不要切换浏览器。</p><a href="${OAUTH_PATH}/start">重新连接 Google 日历</a><a href="/today">返回今日</a></main></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" }
  });
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
