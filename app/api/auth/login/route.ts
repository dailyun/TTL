import { isIP } from "node:net";
import {
  createSimpleSessionToken,
  isSimpleAuthEnabled,
  SIMPLE_AUTH_COOKIE,
  SIMPLE_AUTH_MAX_AGE_SECONDS,
  verifySimplePassword
} from "../../../../src/auth/simple-auth.js";
import {
  checkLoginAttempt,
  clearLoginAttempts,
  recordFailedLoginAttempt
} from "../../../../src/auth/login-attempts.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSimpleAuthEnabled()) {
    return noStore(Response.json({ ok: true, auth: "disabled" }));
  }

  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const attemptKey = loginAttemptKey(request);
  const attemptStatus = checkLoginAttempt(attemptKey);
  if (!attemptStatus.allowed) {
    return lockedResponse(attemptStatus.retryAfterSeconds);
  }

  if (!body.password || !verifySimplePassword(body.password)) {
    const failedStatus = recordFailedLoginAttempt(attemptKey);
    if (!failedStatus.allowed) {
      return lockedResponse(failedStatus.retryAfterSeconds);
    }
    return noStore(Response.json({ error: "密码不正确" }, { status: 401 }));
  }

  clearLoginAttempts(attemptKey);
  const token = await createSimpleSessionToken();
  const response = Response.json({ ok: true });
  response.headers.set("cache-control", "no-store");
  response.headers.set(
    "set-cookie",
    [
      `${SIMPLE_AUTH_COOKIE}=${token}`,
      "Path=/",
      `Max-Age=${SIMPLE_AUTH_MAX_AGE_SECONDS}`,
      "HttpOnly",
      "SameSite=Lax",
      process.env.NODE_ENV === "production" ? "Secure" : ""
    ]
      .filter(Boolean)
      .join("; ")
  );

  return response;
}

function loginAttemptKey(request: Request): string {
  if (process.env.TODOTODOLIST_TRUST_PROXY !== "true") {
    return "global";
  }

  const addresses = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const proxyHops = trustedProxyHops();
  const forwardedAddress = addresses?.[Math.max(0, addresses.length - proxyHops)];
  const realIp = request.headers.get("x-real-ip")?.trim();
  const candidate = forwardedAddress || realIp;
  return candidate && isIP(candidate) ? candidate : "global";
}

function trustedProxyHops(): number {
  const parsed = Number.parseInt(process.env.TODOTODOLIST_PROXY_HOPS ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function lockedResponse(retryAfterSeconds: number): Response {
  return noStore(Response.json(
    { error: `登录失败次数过多，请 ${Math.ceil(retryAfterSeconds / 60)} 分钟后再试` },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds)
      }
    }
  ));
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}
