import { withCheckInState } from "../check-ins/store.js";
import { execution, changed, reconcileItems, reconcileOwnerEdits } from "../execution/core.js";
import { createEmptySnapshot } from "../execution/empty-snapshot.js";
export { createEmptySnapshot } from "../execution/empty-snapshot.js";
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
  client: GitHubContentsClient | undefined,
  sourcePath = externalApiSnapshotPath()
): Promise<SnapshotReadResult | null> {
  if (process.env.TODOTODOLIST_STATE_PATH) return withCheckInState(state => ({ sha: String(execution(state).revision), snapshot: execution(state).snapshot }), false);
  if (!client) throw new Error("GitHub snapshot client missing");
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
  client: GitHubContentsClient | undefined;
  mutate: (snapshot: AppSnapshot) => { result: T; snapshot: AppSnapshot };
  message: string;
  sourcePath?: string;
}): Promise<SnapshotMutationResult<T>> {
  if (process.env.TODOTODOLIST_STATE_PATH) return withCheckInState(state => {
    const w = execution(state);
    const beforeItems = structuredClone(w.snapshot.items);
    const mutation = params.mutate(structuredClone(w.snapshot));
    w.snapshot = validateSnapshot(mutation.snapshot);
    reconcileOwnerEdits(state, beforeItems); reconcileItems(state); changed(state, "external_api");
    return { result: mutation.result, sha: String(w.revision), snapshot: w.snapshot, writeAttempts: 1 };
  });
  if (!params.client) throw new Error("GitHub snapshot client missing");
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

export function externalApiSnapshotPath(): string {
  return process.env.GITHUB_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
}

export function nextTimestamp(previous?: string, now = new Date()): string {
  const nowMs = now.getTime();
  const previousMs = previous ? new Date(previous).getTime() : Number.NaN;
  return new Date(Number.isNaN(previousMs) ? nowMs : Math.max(nowMs, previousMs + 1)).toISOString();
}
