import { ZodError } from "zod";
import { GitHubApiError } from "../github-human-files/github-client.js";
import { ExternalApiError } from "./errors.js";

export function externalApiJson(
  request: Request,
  body: unknown,
  init: ResponseInit = {}
): Response {
  const headers = externalApiHeaders(request, init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function externalApiNoContent(request: Request, init: ResponseInit = {}): Response {
  return new Response(null, {
    ...init,
    status: init.status ?? 204,
    headers: externalApiHeaders(request, init.headers)
  });
}

export function externalApiError(request: Request, error: unknown): Response {
  if (error instanceof ZodError) {
    return externalApiJson(
      request,
      { error: { code: "invalid_request", message: "Invalid request format.", issues: error.issues } },
      { status: 400 }
    );
  }

  if (error instanceof ExternalApiError) {
    return externalApiJson(
      request,
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status, headers: error.status === 401 ? { "www-authenticate": "Bearer" } : undefined }
    );
  }

  if (error instanceof GitHubApiError) {
    const status = error.status === 401 || error.status === 403 ? 503 : error.status === 409 ? 409 : 502;
    return externalApiJson(
      request,
      {
        error: {
          code: status === 409 ? "write_conflict" : "storage_unavailable",
          message: status === 409
            ? "The snapshot changed while it was being written. Retry the request."
            : "GitHub snapshot storage is unavailable."
        }
      },
      { status }
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  const missingConfiguration = message.startsWith("Missing required environment variable:");
  return externalApiJson(
    request,
    {
      error: {
        code: missingConfiguration ? "storage_not_configured" : "internal_error",
        message: missingConfiguration ? message : "The server could not complete the request."
      }
    },
    { status: missingConfiguration ? 503 : 500 }
  );
}

export function externalApiOptions(request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return externalApiJson(
      request,
      { error: { code: "origin_not_allowed", message: "This browser origin is not allowed." } },
      { status: 403 }
    );
  }

  const headers = externalApiHeaders(request);
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type, If-Match, X-API-Key");
  headers.set("access-control-max-age", "86400");
  return new Response(null, { status: 204, headers });
}

function externalApiHeaders(request: Request, initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("cache-control", "no-store");
  headers.append("vary", "Origin");

  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-expose-headers", "ETag, Location");
  }

  return headers;
}

function isAllowedOrigin(origin: string): boolean {
  const configured = (process.env.TODOTODOLIST_API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(origin);
}
