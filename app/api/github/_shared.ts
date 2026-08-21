import { GitHubContentsClient } from "../../../src/index.js";
import type { GitHubRepoConfig, HumanSource } from "../../../src/index.js";

export function githubConfigFromEnv(): GitHubRepoConfig {
  const token = requiredEnv("GITHUB_TOKEN");
  const owner = requiredEnv("GITHUB_OWNER");
  const repo = requiredEnv("GITHUB_REPO");
  const branch = process.env.GITHUB_BRANCH ?? "main";

  return {
    owner,
    repo,
    branch,
    token
  };
}

export function githubClientFromEnv(): GitHubContentsClient {
  return new GitHubContentsClient(githubConfigFromEnv());
}

export function defaultHumanSource(): HumanSource {
  return {
    id: process.env.HUMAN_SOURCE_ID ?? "findwork",
    label: process.env.HUMAN_SOURCE_ID ?? "findwork",
    path: process.env.HUMAN_SOURCE_PATH ?? "findwork/**/*.md",
    mode: "read-write",
    defaultSectionId: process.env.HUMAN_SOURCE_SECTION ?? "work",
    defaultType: "idea",
    defaultStatus: "wanted",
    importCheckboxes: true,
    writeBack: "frontmatter-only"
  };
}

export function jsonError(error: unknown, status = 500): Response {
  if (isZodErrorLike(error)) {
    return Response.json(
      {
        error: "Invalid request format",
        issues: error.issues
      },
      errorResponseInit(400)
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ error: message }, errorResponseInit(status));
}

export function jsonOk(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, noStoreResponseInit(init));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isZodErrorLike(error: unknown): error is { issues: unknown[] } {
  return typeof error === "object" && error !== null && "issues" in error;
}

function errorResponseInit(status: number): ResponseInit {
  return noStoreResponseInit({ status });
}

function noStoreResponseInit(init: ResponseInit): ResponseInit {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");

  return {
    ...init,
    headers
  };
}
