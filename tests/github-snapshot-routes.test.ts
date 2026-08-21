import assert from "node:assert/strict";
import test from "node:test";
import { GET, PUT } from "../app/api/github/snapshot/route.js";
import type { AppSnapshot } from "../src/local-db/db.js";

test("GitHub snapshot route reads a remote snapshot without caching", async () => {
  const snapshot = validSnapshot();
  const restore = withGitHubEnv();
  const restoreFetch = mockFetch(async () =>
    jsonResponse({
      path: "todotodolist/snapshot.json",
      sha: "snapshot-sha",
      encoding: "base64",
      content: Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64")
    })
  );

  try {
    const response = await GET();
    const payload = (await response.json()) as {
      sha?: string;
      snapshot?: AppSnapshot;
      sourcePath?: string;
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.sourcePath, "todotodolist/snapshot.json");
    assert.equal(payload.sha, "snapshot-sha");
    assert.equal(payload.snapshot?.items.length, 1);
  } finally {
    restoreFetch();
    restore();
  }
});

test("GitHub snapshot route creates the snapshot file when missing", async () => {
  const snapshot = validSnapshot();
  const restore = withGitHubEnv();
  const calls: Array<{ body?: unknown; method: string; url: string }> = [];
  const restoreFetch = mockFetch(async (url, init) => {
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? "GET",
      url
    });

    if ((init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        statusText: "Not Found"
      });
    }

    return jsonResponse({ content: { sha: "created-sha" } });
  });

  try {
    const response = await PUT(
      new Request("http://127.0.0.1:3000/api/github/snapshot", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ snapshot })
      })
    );
    const payload = (await response.json()) as {
      itemCount?: number;
      mergeSummary?: { remoteItemsKept?: number; remoteSectionsKept?: number; remoteSettingsKept?: number };
      sha?: string;
      snapshot?: AppSnapshot;
    };
    const putCall = calls.find((call) => call.method === "PUT");

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.itemCount, 1);
    assert.equal(payload.sha, "created-sha");
    assert.equal(payload.mergeSummary?.remoteItemsKept, 0);
    assert.equal(payload.mergeSummary?.remoteSectionsKept, 0);
    assert.equal(payload.mergeSummary?.remoteSettingsKept, 0);
    assert.equal(payload.snapshot?.items.length, 1);
    assert.ok(putCall);
    assert.equal("sha" in (putCall.body as Record<string, unknown>), false);
  } finally {
    restoreFetch();
    restore();
  }
});

test("GitHub snapshot route merges existing remote records before writing", async () => {
  const incoming = validSnapshot({
    itemId: "shared-item",
    title: "Local older title",
    updatedAt: "2026-07-07T10:00:00.000Z"
  });
  incoming.items.push(snapshotItem("local-only", "Local only", "2026-07-07T12:00:00.000Z"));
  const remote = validSnapshot({
    itemId: "shared-item",
    title: "Remote newer title",
    updatedAt: "2026-07-07T11:00:00.000Z"
  });
  remote.items.push(snapshotItem("remote-only", "Remote only", "2026-07-07T09:00:00.000Z"));
  const restore = withGitHubEnv();
  const calls: Array<{ body?: unknown; method: string; url: string }> = [];
  const restoreFetch = mockFetch(async (url, init) => {
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? "GET",
      url
    });

    if ((init?.method ?? "GET") === "GET") {
      return jsonResponse({
        path: "todotodolist/snapshot.json",
        sha: "remote-sha",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(remote), "utf8").toString("base64")
      });
    }

    return jsonResponse({ content: { sha: "merged-sha" } });
  });

  try {
    const response = await PUT(
      new Request("http://127.0.0.1:3000/api/github/snapshot", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ snapshot: incoming })
      })
    );
    const payload = (await response.json()) as {
      itemCount?: number;
      mergeSummary?: { remoteItemsKept?: number; remoteSectionsKept?: number; remoteSettingsKept?: number };
      mergedRemote?: boolean;
      sha?: string;
      snapshot?: AppSnapshot;
    };
    const putCall = calls.find((call) => call.method === "PUT");
    const putBody = putCall?.body as { content?: string; sha?: string } | undefined;
    assert.ok(putBody?.content);
    const written = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf8")) as AppSnapshot;
    const titles = new Map(written.items.map((item) => [item.id, item.title]));
    const responseTitles = new Map(payload.snapshot?.items.map((item) => [item.id, item.title]) ?? []);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.itemCount, 3);
    assert.equal(payload.mergedRemote, true);
    assert.equal(payload.mergeSummary?.remoteItemsKept, 2);
    assert.equal(payload.mergeSummary?.remoteSectionsKept, 0);
    assert.equal(payload.mergeSummary?.remoteSettingsKept, 0);
    assert.equal(payload.sha, "merged-sha");
    assert.equal(putBody.sha, "remote-sha");
    assert.equal(titles.get("shared-item"), "Remote newer title");
    assert.equal(titles.get("local-only"), "Local only");
    assert.equal(titles.get("remote-only"), "Remote only");
    assert.equal(responseTitles.get("shared-item"), "Remote newer title");
    assert.equal(responseTitles.get("local-only"), "Local only");
    assert.equal(responseTitles.get("remote-only"), "Remote only");
  } finally {
    restoreFetch();
    restore();
  }
});

test("GitHub snapshot route retries once after a remote write conflict", async () => {
  const incoming = validSnapshot({
    itemId: "shared-item",
    title: "Local title",
    updatedAt: "2026-07-07T12:00:00.000Z"
  });
  const initialRemote = validSnapshot({
    itemId: "shared-item",
    title: "Initial remote title",
    updatedAt: "2026-07-07T10:00:00.000Z"
  });
  const latestRemote = validSnapshot({
    itemId: "shared-item",
    title: "Latest remote title",
    updatedAt: "2026-07-07T13:00:00.000Z"
  });
  latestRemote.items.push(snapshotItem("latest-only", "Latest only", "2026-07-07T13:30:00.000Z"));
  const restore = withGitHubEnv();
  const calls: Array<{ body?: unknown; method: string; url: string }> = [];
  let readCount = 0;
  let writeCount = 0;
  const restoreFetch = mockFetch(async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method,
      url
    });

    if (method === "GET") {
      readCount += 1;
      const remote = readCount === 1 ? initialRemote : latestRemote;
      return jsonResponse({
        path: "todotodolist/snapshot.json",
        sha: readCount === 1 ? "initial-sha" : "latest-sha",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(remote), "utf8").toString("base64")
      });
    }

    writeCount += 1;
    if (writeCount === 1) {
      return new Response(JSON.stringify({ message: "sha does not match" }), {
        status: 409,
        statusText: "Conflict"
      });
    }

    return jsonResponse({ content: { sha: "retry-sha" } });
  });

  try {
    const response = await PUT(
      new Request("http://127.0.0.1:3000/api/github/snapshot", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ snapshot: incoming })
      })
    );
    const payload = (await response.json()) as {
      itemCount?: number;
      mergeSummary?: { remoteItemsKept?: number };
      retriedAfterConflict?: boolean;
      sha?: string;
      snapshot?: AppSnapshot;
    };
    const putCalls = calls.filter((call) => call.method === "PUT");
    const retryPutBody = putCalls[1]?.body as { content?: string; sha?: string } | undefined;
    assert.ok(retryPutBody?.content);
    const written = JSON.parse(Buffer.from(retryPutBody.content, "base64").toString("utf8")) as AppSnapshot;
    const titles = new Map(written.items.map((item) => [item.id, item.title]));

    assert.equal(response.status, 200);
    assert.equal(payload.sha, "retry-sha");
    assert.equal(payload.retriedAfterConflict, true);
    assert.equal(payload.itemCount, 2);
    assert.equal(payload.mergeSummary?.remoteItemsKept, 2);
    assert.equal(putCalls.length, 2);
    assert.equal(retryPutBody.sha, "latest-sha");
    assert.equal(titles.get("shared-item"), "Latest remote title");
    assert.equal(titles.get("latest-only"), "Latest only");
    assert.equal(payload.snapshot?.items.length, 2);
  } finally {
    restoreFetch();
    restore();
  }
});

function validSnapshot(
  itemInput: { itemId?: string; title?: string; updatedAt?: string } = {}
): AppSnapshot {
  const now = "2026-07-07T00:00:00.000Z";
  return {
    app: "todotodolist",
    version: 1,
    exportedAt: now,
    items: [
      snapshotItem(
        itemInput.itemId ?? "item-one",
        itemInput.title ?? "Back up data",
        itemInput.updatedAt ?? now
      )
    ],
    sections: [
      {
        id: "work",
        name: "工作",
        color: "#276c63",
        sortOrder: 1,
        createdAt: now,
        updatedAt: now
      }
    ],
    settings: [
      {
        id: "default",
        defaultSectionId: "work",
        showDoneInCalendar: false,
        showAbandonedInBoard: false,
        autoPullGitHubSnapshotOnStart: false,
        autoPushGitHubSnapshotOnChange: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    syncMetadata: []
  };
}

function snapshotItem(id: string, title: string, updatedAt: string): AppSnapshot["items"][number] {
  const now = "2026-07-07T00:00:00.000Z";
  return {
    id,
    type: "todo",
    title,
    description: "",
    sectionId: "work",
    status: "active",
    tags: [],
    source: "local",
    createdAt: now,
    updatedAt
  };
}

function withGitHubEnv(): () => void {
  const original = {
    GITHUB_BRANCH: process.env.GITHUB_BRANCH,
    GITHUB_OWNER: process.env.GITHUB_OWNER,
    GITHUB_REPO: process.env.GITHUB_REPO,
    GITHUB_SNAPSHOT_PATH: process.env.GITHUB_SNAPSHOT_PATH,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN
  };

  process.env.GITHUB_BRANCH = "main";
  process.env.GITHUB_OWNER = "octo";
  process.env.GITHUB_REPO = "private";
  delete process.env.GITHUB_SNAPSHOT_PATH;
  process.env.GITHUB_TOKEN = "token";

  return () => {
    restoreEnv("GITHUB_BRANCH", original.GITHUB_BRANCH);
    restoreEnv("GITHUB_OWNER", original.GITHUB_OWNER);
    restoreEnv("GITHUB_REPO", original.GITHUB_REPO);
    restoreEnv("GITHUB_SNAPSHOT_PATH", original.GITHUB_SNAPSHOT_PATH);
    restoreEnv("GITHUB_TOKEN", original.GITHUB_TOKEN);
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
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
