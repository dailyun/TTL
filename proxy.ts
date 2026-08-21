import { NextRequest, NextResponse } from "next/server";
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

export async function proxy(request: NextRequest) {
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
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
