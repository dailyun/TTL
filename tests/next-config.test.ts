import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.js";

type HeaderRule = {
  headers: Array<{ key: string; value: string }>;
  source: string;
};

test("Next config applies baseline security headers", async () => {
  const headers = await nextConfig.headers?.();
  assert.ok(headers);

  const globalRule = (headers as HeaderRule[]).find((rule) => rule.source === "/(.*)");
  assert.ok(globalRule);
  const headerMap = new Map(globalRule.headers.map((header) => [header.key.toLowerCase(), header.value]));

  assert.equal(headerMap.get("x-frame-options"), "DENY");
  assert.equal(headerMap.get("x-content-type-options"), "nosniff");
  assert.equal(headerMap.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headerMap.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
});
