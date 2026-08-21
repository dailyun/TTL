import assert from "node:assert/strict";
import test from "node:test";
import { DELETE, GET as getItem, PATCH } from "../app/api/v1/items/[id]/route.js";
import { GET as listItems, POST } from "../app/api/v1/items/route.js";
import { GET as listSections } from "../app/api/v1/sections/route.js";
import { createEmptySnapshot } from "../src/external-api/snapshot-store.js";
import type { AppSnapshot } from "../src/local-db/db.js";

const API_URL = "http://127.0.0.1:3000/api/v1/items";

test("external API rejects missing tokens before accessing storage", async () => {
  const restore = withApiEnv();
  let fetchCalled = false;
  const restoreFetch = mockFetch(async () => {
    fetchCalled = true;
    return new Response(null, { status: 500 });
  });

  try {
    const response = await listItems(new Request(API_URL));
    const payload = await response.json() as { error?: { code?: string } };

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(payload.error?.code, "unauthorized");
    assert.equal(fetchCalled, false);
  } finally {
    restoreFetch();
    restore();
  }
});

test("external API creates snapshot storage and supports item CRUD", async () => {
  const restore = withApiEnv();
  const remote = inMemorySnapshotRemote(null);
  const restoreFetch = mockFetch(remote.fetch);

  try {
    const createResponse = await POST(apiRequest(API_URL, {
      method: "POST",
      body: JSON.stringify({
        id: "ai-task-1",
        title: "让 AI 创建一条待办",
        sectionId: "inbox",
        tags: ["ai", "ai"]
      })
    }));
    const created = await createResponse.json() as { data?: { id?: string; tags?: string[]; updatedAt?: string } };

    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.headers.get("location"), "/api/v1/items/ai-task-1");
    assert.match(createResponse.headers.get("etag") ?? "", /^".+"$/);
    assert.equal(created.data?.id, "ai-task-1");
    assert.deepEqual(created.data?.tags, ["ai"]);
    assert.equal(remote.snapshot?.items.length, 1);
    assert.equal(remote.lastPutIncludedSha, false);

    const listResponse = await listItems(apiRequest(`${API_URL}?q=AI&status=wanted&limit=10`));
    const listed = await listResponse.json() as { data?: Array<{ id?: string }>; meta?: { total?: number } };
    assert.equal(listResponse.status, 200);
    assert.equal(listed.meta?.total, 1);
    assert.equal(listed.data?.[0]?.id, "ai-task-1");

    const itemResponse = await getItem(
      apiRequest(`${API_URL}/ai-task-1`),
      routeContext("ai-task-1")
    );
    const etag = itemResponse.headers.get("etag");
    assert.ok(etag);

    const updateResponse = await PATCH(
      apiRequest(`${API_URL}/ai-task-1`, {
        method: "PATCH",
        headers: { "if-match": etag },
        body: JSON.stringify({ status: "active", description: "由外部平台更新" })
      }),
      routeContext("ai-task-1")
    );
    const updated = await updateResponse.json() as { data?: { status?: string; description?: string } };
    assert.equal(updateResponse.status, 200);
    assert.equal(updated.data?.status, "active");
    assert.equal(updated.data?.description, "由外部平台更新");
    assert.equal(remote.lastPutIncludedSha, true);

    const staleResponse = await PATCH(
      apiRequest(`${API_URL}/ai-task-1`, {
        method: "PATCH",
        headers: { "if-match": etag },
        body: JSON.stringify({ status: "done" })
      }),
      routeContext("ai-task-1")
    );
    const stale = await staleResponse.json() as { error?: { code?: string } };
    assert.equal(staleResponse.status, 412);
    assert.equal(stale.error?.code, "item_changed");

    const deleteResponse = await DELETE(
      apiRequest(`${API_URL}/ai-task-1`, { method: "DELETE" }),
      routeContext("ai-task-1")
    );
    const deleted = await deleteResponse.json() as { data?: { deletedAt?: string } };
    assert.equal(deleteResponse.status, 200);
    assert.ok(deleted.data?.deletedAt);

    const hiddenResponse = await getItem(
      apiRequest(`${API_URL}/ai-task-1`),
      routeContext("ai-task-1")
    );
    assert.equal(hiddenResponse.status, 404);

    const restoreResponse = await PATCH(
      apiRequest(`${API_URL}/ai-task-1`, {
        method: "PATCH",
        body: JSON.stringify({ deletedAt: null })
      }),
      routeContext("ai-task-1")
    );
    const restored = await restoreResponse.json() as { data?: { deletedAt?: string } };
    assert.equal(restoreResponse.status, 200);
    assert.equal(restored.data?.deletedAt, undefined);
  } finally {
    restoreFetch();
    restore();
  }
});

test("external API does not mutate provider-owned items without provider writeback", async () => {
  const restore = withApiEnv();
  const snapshot = createEmptySnapshot("2026-07-17T00:00:00.000Z");
  snapshot.items.push({
    id: "calendar-event-1",
    type: "event",
    title: "Provider event",
    description: "",
    sectionId: "work",
    status: "active",
    tags: [],
    source: "google_calendar",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z"
  });
  const remote = inMemorySnapshotRemote(snapshot);
  const restoreFetch = mockFetch(remote.fetch);

  try {
    const response = await PATCH(
      apiRequest(`${API_URL}/calendar-event-1`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Unsafe local-only change" })
      }),
      routeContext("calendar-event-1")
    );
    const payload = await response.json() as { error?: { code?: string } };
    assert.equal(response.status, 409);
    assert.equal(payload.error?.code, "provider_writeback_required");
  } finally {
    restoreFetch();
    restore();
  }
});

test("external API lists active sections and validates reverse-todo schedules", async () => {
  const restore = withApiEnv();
  const remote = inMemorySnapshotRemote(createEmptySnapshot("2026-07-17T00:00:00.000Z"));
  const restoreFetch = mockFetch(remote.fetch);

  try {
    const sectionsResponse = await listSections(apiRequest("http://127.0.0.1:3000/api/v1/sections"));
    const sections = await sectionsResponse.json() as { data?: Array<{ id?: string }> };
    assert.equal(sectionsResponse.status, 200);
    assert.deepEqual(sections.data?.map((section) => section.id), ["inbox", "work", "life"]);

    const invalidResponse = await POST(apiRequest(API_URL, {
      method: "POST",
      body: JSON.stringify({ title: "不要刷视频", type: "avoid" })
    }));
    const invalid = await invalidResponse.json() as { error?: { code?: string } };
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalid.error?.code, "invalid_schedule");
  } finally {
    restoreFetch();
    restore();
  }
});

function apiRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer external-secret");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function withApiEnv(): () => void {
  const original = {
    GITHUB_BRANCH: process.env.GITHUB_BRANCH,
    GITHUB_OWNER: process.env.GITHUB_OWNER,
    GITHUB_REPO: process.env.GITHUB_REPO,
    GITHUB_SNAPSHOT_PATH: process.env.GITHUB_SNAPSHOT_PATH,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    TODOTODOLIST_API_TOKEN: process.env.TODOTODOLIST_API_TOKEN
  };
  process.env.GITHUB_BRANCH = "main";
  process.env.GITHUB_OWNER = "octo";
  process.env.GITHUB_REPO = "private";
  delete process.env.GITHUB_SNAPSHOT_PATH;
  process.env.GITHUB_TOKEN = "github-secret";
  process.env.TODOTODOLIST_API_TOKEN = "external-secret";

  return () => Object.entries(original).forEach(([key, value]) => restoreEnv(key, value));
}

function inMemorySnapshotRemote(initial: AppSnapshot | null) {
  let snapshot = initial;
  let sha = initial ? "sha-1" : null;
  let revision = 1;
  let lastPutIncludedSha = false;

  return {
    get snapshot() {
      return snapshot;
    },
    get lastPutIncludedSha() {
      return lastPutIncludedSha;
    },
    async fetch(_url: string, init?: RequestInit): Promise<Response> {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        if (!snapshot || !sha) {
          return new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            statusText: "Not Found"
          });
        }
        return jsonResponse({
          path: "todotodolist/snapshot.json",
          sha,
          encoding: "base64",
          content: Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64")
        });
      }

      const body = JSON.parse(String(init?.body)) as { content: string; sha?: string };
      lastPutIncludedSha = Boolean(body.sha);
      if (sha && body.sha !== sha) {
        return new Response(JSON.stringify({ message: "Conflict" }), {
          status: 409,
          statusText: "Conflict"
        });
      }
      snapshot = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) as AppSnapshot;
      revision += 1;
      sha = `sha-${revision}`;
      return jsonResponse({ content: { sha } });
    }
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function mockFetch(
  implementation: (url: string, init?: RequestInit) => Promise<Response>
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    implementation(String(input), init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
