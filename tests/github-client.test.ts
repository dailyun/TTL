import assert from "node:assert/strict";
import test from "node:test";
import { GitHubContentsClient } from "../src/github-human-files/github-client.js";

test("GitHubContentsClient lists files through git tree and filters by glob", async () => {
  const calls: string[] = [];
  const restore = mockFetch(async (url) => {
    calls.push(url);
    return jsonResponse({
      tree: [
        { path: "findwork/product-plan.md", type: "blob" },
        { path: "findwork/ideas/calendar-sync.md", type: "blob" },
        { path: "notes/private.txt", type: "blob" },
        { path: "findwork", type: "tree" }
      ]
    });
  });

  try {
    const client = testClient();
    const files = await client.listFiles("findwork/**/*.md");

    assert.deepEqual(files, ["findwork/ideas/calendar-sync.md", "findwork/product-plan.md"]);
    assert.equal(
      calls[0],
      "https://api.github.com/repos/octo/private/git/trees/main?recursive=1"
    );
  } finally {
    restore();
  }
});

test("GitHubContentsClient reads base64 encoded file contents", async () => {
  const restore = mockFetch(async () =>
    jsonResponse({
      path: "findwork/product-plan.md",
      sha: "abc123",
      encoding: "base64",
      content: Buffer.from("# Plan", "utf8").toString("base64")
    })
  );

  try {
    const client = testClient();
    const file = await client.readFile("findwork/product-plan.md");

    assert.equal(file.path, "findwork/product-plan.md");
    assert.equal(file.sha, "abc123");
    assert.equal(file.content, "# Plan");
  } finally {
    restore();
  }
});

test("GitHubContentsClient writes file using sha, branch, and base64 content", async () => {
  let capturedBody: unknown;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return jsonResponse({ content: { sha: "def456" } });
  });

  try {
    const client = testClient();
    const result = await client.writeFile({
      filePath: "findwork/product-plan.md",
      content: "---\nstatus: active\n---\n",
      sha: "abc123",
      message: "Update metadata"
    });

    assert.deepEqual(result, { sha: "def456" });
    assert.deepEqual(capturedBody, {
      message: "Update metadata",
      content: Buffer.from("---\nstatus: active\n---\n", "utf8").toString("base64"),
      sha: "abc123",
      branch: "main"
    });
  } finally {
    restore();
  }
});

test("GitHubContentsClient can create a file without sha", async () => {
  let capturedBody: unknown;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return jsonResponse({ content: { sha: "new-file-sha" } });
  });

  try {
    const client = testClient();
    const result = await client.writeFile({
      filePath: "todotodolist/snapshot.json",
      content: "{\"app\":\"todotodolist\"}",
      message: "Create snapshot"
    });

    assert.deepEqual(result, { sha: "new-file-sha" });
    assert.deepEqual(capturedBody, {
      message: "Create snapshot",
      content: Buffer.from("{\"app\":\"todotodolist\"}", "utf8").toString("base64"),
      branch: "main"
    });
  } finally {
    restore();
  }
});

function testClient(): GitHubContentsClient {
  return new GitHubContentsClient({
    owner: "octo",
    repo: "private",
    branch: "main",
    token: "token"
  });
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
