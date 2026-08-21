import { SIMPLE_AUTH_COOKIE } from "../../../../src/auth/simple-auth.js";

export const runtime = "nodejs";

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.set("cache-control", "no-store");
  response.headers.set(
    "set-cookie",
    [
      `${SIMPLE_AUTH_COOKIE}=`,
      "Path=/",
      "Max-Age=0",
      "HttpOnly",
      "SameSite=Lax",
      process.env.NODE_ENV === "production" ? "Secure" : ""
    ]
      .filter(Boolean)
      .join("; ")
  );
  return response;
}
