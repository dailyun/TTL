import {
  exchangeGoogleCalendarCode,
  googleCalendarConfigFromEnv
} from "../../../../../src/index.js";
import { writeStoredGoogleCalendarRefreshToken } from "../../../../../src/google-calendar/token-store.js";
import { resetGoogleCalendarSyncState } from "../../../../../src/google-calendar/sync-state.js";
import { canonicalGoogleOAuthRedirect, oauthProblem } from "../../../../../src/google-calendar/oauth-browser.js";
import { withCheckInState } from "../../../../../src/check-ins/store.js";
import { execution } from "../../../../../src/execution/core.js";

export const runtime = "nodejs";

const STATE_COOKIE = "tdl_google_oauth_state";

export async function GET(request: Request) {
  try {
    const canonical = canonicalGoogleOAuthRedirect(request);
    if (canonical) return canonical;
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = cookieValue(request.headers.get("cookie"), STATE_COOKIE);

    if (url.searchParams.has("error")) return oauthProblem("Google 授权未完成", "你可以重新连接；现有事项和反馈仍保留。");
    if (!code) return oauthProblem("这不是完整的授权回调", "请从下面的入口重新连接 Google 日历。");
    if (!state || !expectedState || state !== expectedState) {
      return oauthProblem("本次授权已失效，请重新连接", expectedState
        ? "授权页面可能被重复打开，当前返回的请求与最新授权不一致。请关闭旧授权页面后重新开始。"
        : "没有收到发起授权时保存的浏览器状态。可能是授权已超时，或途中更换了浏览器。请重新开始。");
    }

    const token = await exchangeGoogleCalendarCode(googleCalendarConfigFromEnv(), code);
    const refreshToken = token.refresh_token;
    if (refreshToken) {
      writeStoredGoogleCalendarRefreshToken(refreshToken);
      await resetGoogleCalendarSyncState();
      if (process.env.TODOTODOLIST_STATE_PATH) await withCheckInState(s => { execution(s).calendar.retryAt = undefined; });
    }
    const body = refreshToken
      ? tokenHtml()
      : tokenHtml("", "Google did not return a refresh token. Re-open the authorization URL and approve consent again.");

    const response = new Response(body, {
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-type": "text/html; charset=utf-8"
      }
    });
    response.headers.set(
      "set-cookie",
      [
        `${STATE_COOKIE}=`,
        "Path=/api/google-calendar/oauth",
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Lax",
        process.env.NODE_ENV === "production" ? "Secure" : ""
      ]
        .filter(Boolean)
        .join("; ")
    );
    return response;
  } catch (error) {
    return oauthProblem("Google 日历连接暂未成功", "授权结果暂时未能保存，请重新连接。若仍失败，保留此提示以便检查服务器连接状态。", 502);
  }
}

function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function tokenHtml(refreshToken = "", warning?: string): string {
  const warningHtml = warning ? `<p class="warning">${escapeHtml(warning)}</p>` : "";
  const tokenHtml = refreshToken
    ? `<p>如果自动保存不可用，可以手动配置下面的 refresh token。</p><code>${escapeHtml(refreshToken)}</code>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Calendar 授权</title>
    <style>
      body { margin: 0; background: #f7f8f5; color: #1d2428; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { display: grid; min-height: 100vh; place-items: center; padding: 24px; }
      section { width: min(100%, 760px); border: 1px solid #dfe5df; border-radius: 8px; background: #fff; padding: 28px; }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { color: #687276; line-height: 1.65; }
      code { display: block; overflow-wrap: anywhere; border-radius: 6px; background: #f1f3ee; padding: 14px; color: #1d2428; }
      .warning { color: #a33d2c; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${warning ? "Google Calendar 授权尚未完成" : "Google Calendar 授权完成"}</h1>
        ${warningHtml}
        <p>${warning ? "未能自动保存 refresh token。" : "新的 refresh token 已自动保存到服务器。"}</p>
        <p>你可以回到 <a href="/today">今日</a> 查看连接状态。服务器会自动同步日历。</p>
        ${tokenHtml}
      </section>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
