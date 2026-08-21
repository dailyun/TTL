import { timingSafeEqual } from "node:crypto";
import { ExternalApiError } from "./errors.js";

export function assertExternalApiAuthorized(request: Request): void {
  const expectedToken = process.env.TODOTODOLIST_API_TOKEN;
  if (!expectedToken) {
    throw new ExternalApiError(
      503,
      "api_not_configured",
      "External API is disabled. Set TODOTODOLIST_API_TOKEN on the server."
    );
  }

  const providedToken = bearerToken(request.headers.get("authorization"))
    ?? request.headers.get("x-api-key")?.trim();

  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    throw new ExternalApiError(401, "unauthorized", "A valid API token is required.");
  }
}

function bearerToken(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}
