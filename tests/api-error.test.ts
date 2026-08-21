import assert from "node:assert/strict";
import test from "node:test";
import { jsonError, jsonOk } from "../app/api/github/_shared.js";

test("jsonOk responses are not cached", async () => {
  const response = jsonOk({ ok: true });
  const payload = (await response.json()) as { ok?: boolean };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.ok, true);
});

test("jsonError responses are not cached", async () => {
  const response = jsonError(new Error("boom"), 503);
  const payload = (await response.json()) as { error?: string };

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.error, "boom");
});

test("jsonError zod-like responses are not cached", async () => {
  const response = jsonError({ issues: [{ path: ["title"], message: "Required" }] });
  const payload = (await response.json()) as { error?: string; issues?: unknown[] };

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.error, "Invalid request format");
  assert.ok(Array.isArray(payload.issues));
});
