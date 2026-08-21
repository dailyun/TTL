import type { GitHubContentsClient } from "../github-human-files/github-client.js";
import { GitHubApiError } from "../github-human-files/github-client.js";
import { validateSnapshot, type AppSnapshot } from "../local-db/db.js";
import { ExternalApiError } from "./errors.js";

const DEFAULT_SNAPSHOT_PATH = "todotodolist/snapshot.json";
const MAX_WRITE_ATTEMPTS = 3;

export interface SnapshotReadResult {
  sha: string;
  snapshot: AppSnapshot;
}

export interface SnapshotMutationResult<T> {
  result: T;
  sha?: string;
  snapshot: AppSnapshot;
  writeAttempts: number;
}

export async function readExternalApiSnapshot(
  client: GitHubContentsClient,
  sourcePath = externalApiSnapshotPath()
): Promise<SnapshotReadResult | null> {
  try {
    const file = await client.readFile(sourcePath);
    return {
      sha: file.sha,
      snapshot: validateSnapshot(JSON.parse(file.content))
    };
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

export async function mutateExternalApiSnapshot<T>(params: {
  client: GitHubContentsClient;
  mutate: (snapshot: AppSnapshot) => { result: T; snapshot: AppSnapshot };
  message: string;
  sourcePath?: string;
}): Promise<SnapshotMutationResult<T>> {
  const sourcePath = params.sourcePath ?? externalApiSnapshotPath();

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readExternalApiSnapshot(params.client, sourcePath);
    const base = current?.snapshot ?? createEmptySnapshot();
    const mutation = params.mutate(structuredClone(base));
    const snapshot = validateSnapshot({
      ...mutation.snapshot,
      exportedAt: nextTimestamp(base.exportedAt)
    });

    try {
      const write = await params.client.writeFile({
        filePath: sourcePath,
        content: `${JSON.stringify(snapshot, null, 2)}\n`,
        message: params.message,
        sha: current?.sha
      });
      return {
        result: mutation.result,
        sha: write.sha,
        snapshot,
        writeAttempts: attempt
      };
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 409 || attempt === MAX_WRITE_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new ExternalApiError(409, "write_conflict", "Snapshot write conflict. Retry the request.");
}

export function createEmptySnapshot(now = new Date().toISOString()): AppSnapshot {
  return {
    app: "todotodolist",
    version: 1,
    exportedAt: now,
    items: [],
    sections: [
      section("inbox", "收集箱", "#6b7280", 0, now, true),
      section("work", "工作", "#276c63", 1, now),
      section("life", "生活", "#b7532f", 2, now)
    ],
    settings: [
      {
        id: "default",
        defaultSectionId: "inbox",
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

export function externalApiSnapshotPath(): string {
  return process.env.GITHUB_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
}

export function nextTimestamp(previous?: string, now = new Date()): string {
  const nowMs = now.getTime();
  const previousMs = previous ? new Date(previous).getTime() : Number.NaN;
  return new Date(Number.isNaN(previousMs) ? nowMs : Math.max(nowMs, previousMs + 1)).toISOString();
}

function section(
  id: string,
  name: string,
  color: string,
  sortOrder: number,
  now: string,
  isInbox = false
) {
  return {
    id,
    name,
    color,
    sortOrder,
    isInbox: isInbox || undefined,
    createdAt: now,
    updatedAt: now
  };
}
