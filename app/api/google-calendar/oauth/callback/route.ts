import {
  exchangeGoogleCalendarCode,
  googleCalendarConfigFromEnv
} from "../../../../../src/index.js";
import { writeStoredGoogleCalendarRefreshToken } from "../../../../../src/google-calendar/token-store.js";
import { jsonError } from "../../../github/_shared.js";

export const runtime = "nodejs";

const STATE_COOKIE = "tdl_google_oauth_state";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = cookieValue(request.headers.get("cookie"), STATE_COOKIE);

    if (!code) {
      throw new Error("Google callback missing code");
    }
    if (!state || !expectedState || state !== expectedState) {
      throw new Error("Google callback state mismatch");
    }

    const token = await exchangeGoogleCalendarCode(googleCalendarConfigFromEnv(), code);
    const refreshToken = token.refresh_token;
    if (refreshToken) {
      writeStoredGoogleCalendarRefreshToken(refreshToken);
    }
    const body = refreshToken
      ? tokenHtml()
      : tokenHtml("", "Google did not return a refresh token. Re-open the authorization URL and approve consent again.");

    const response = new Response(body, {
      headers: {
        "cache-control": "no-store",
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
    return jsonError(error);
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
        <h1>Google Calendar 授权完成</h1>
        ${warningHtml}
        <p>${warning ? "未能自动保存 refresh token。" : "新的 refresh token 已自动保存到服务器。"}</p>
        <p>你可以关闭这个页面，回到同步页刷新配置并导入日程。</p>
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
