import { NextRequest, NextResponse } from "next/server";
import { canonicalGoogleOAuthRedirect } from "./src/google-calendar/oauth-browser.js";
import {
  isSimpleAuthEnabled,
  SIMPLE_AUTH_COOKIE,
  verifySimpleSessionToken
} from "./src/auth/simple-auth.js";

const PUBLIC_PATH_PREFIXES = [
  "/_next",
  "/api/auth",
  "/api/health",
  "/api/v1",
  "/favicon.ico"
];
const PUBLIC_EXACT_PATHS = new Set(["/api/google-calendar/webhook"]);

export async function proxy(request: NextRequest) {
  // The legacy callback must reach the current site before checking cookies:
  // cookies from .win cannot be read at .club. Authentication still runs there.
  const oauthRedirect = canonicalGoogleOAuthRedirect(request);
  if (oauthRedirect) return oauthRedirect;
  if (!isSimpleAuthEnabled() || isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const isAuthenticated = await verifySimpleSessionToken(request.cookies.get(SIMPLE_AUTH_COOKIE)?.value);
  if (request.nextUrl.pathname === "/login") {
    return isAuthenticated ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (request.nextUrl.pathname === "/api/google-calendar/oauth/start" || request.nextUrl.pathname === "/api/google-calendar/oauth/callback") {
      const loginUrl = new URL("/login", process.env.TODOTODOLIST_PUBLIC_URL || request.url);
      loginUrl.searchParams.set("next", "/api/google-calendar/oauth/start");
      const response = NextResponse.redirect(loginUrl);
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
      return response;
    }
    return NextResponse.json(
      { error: "unauthorized" },
      {
        status: 401,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};

function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT_PATHS.has(pathname)
    || PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
