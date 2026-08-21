import { GitHubApiError } from "../../../../src/github-human-files/github-client.js";
import { mergeSnapshots, validateSnapshot, type AppSnapshot } from "../../../../src/local-db/db.js";
import { githubClientFromEnv, jsonError, jsonOk } from "../_shared.js";

export const runtime = "nodejs";

const DEFAULT_SNAPSHOT_PATH = "todotodolist/snapshot.json";

export async function GET() {
  try {
    const sourcePath = githubSnapshotPath();
    const file = await githubClientFromEnv().readFile(sourcePath);
    const snapshot = validateSnapshot(JSON.parse(file.content));

    return jsonOk({
      sourcePath,
      sha: file.sha,
      snapshot
    });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return jsonError(new Error(`GitHub 快照不存在：${githubSnapshotPath()}`), 404);
    }
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { snapshot?: unknown };
    const snapshot = validateSnapshot(body.snapshot);
    const sourcePath = githubSnapshotPath();
    const client = githubClientFromEnv();
    const result = await writeMergedSnapshot(client, sourcePath, snapshot);

    return jsonOk({
      sourcePath,
      sha: result.sha,
      itemCount: result.snapshot.items.length,
      sectionCount: result.snapshot.sections.length,
      exportedAt: result.snapshot.exportedAt,
      mergedRemote: result.mergedRemote,
      mergeSummary: result.mergeSummary,
      retriedAfterConflict: result.retriedAfterConflict,
      snapshot: result.snapshot,
      ok: true
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function writeMergedSnapshot(
  client: ReturnType<typeof githubClientFromEnv>,
  sourcePath: string,
  incoming: AppSnapshot
): Promise<{
  sha?: string;
  snapshot: AppSnapshot;
  mergeSummary: ReturnType<typeof emptyMergeSummary>;
  mergedRemote: boolean;
  retriedAfterConflict: boolean;
}> {
  const existing = await readExistingSnapshot(client, sourcePath);
  const snapshot = existing ? mergeSnapshots(existing.snapshot, incoming) : incoming;
  const mergeSummary = existing ? summarizeRemoteMerge(existing.snapshot, incoming) : emptyMergeSummary();

  try {
    const result = await writeSnapshotFile(client, sourcePath, snapshot, existing?.sha);
    return {
      sha: result.sha,
      snapshot,
      mergeSummary,
      mergedRemote: Boolean(existing),
      retriedAfterConflict: false
    };
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 409) {
      throw error;
    }
  }

  const latest = await readExistingSnapshot(client, sourcePath);
  if (!latest) {
    throw new Error("GitHub 快照写入冲突后无法读取最新远端文件");
  }

  const retrySnapshot = mergeSnapshots(latest.snapshot, snapshot);
  const retryResult = await writeSnapshotFile(client, sourcePath, retrySnapshot, latest.sha);
  return {
    sha: retryResult.sha,
    snapshot: retrySnapshot,
    mergeSummary: summarizeRemoteMerge(latest.snapshot, incoming),
    mergedRemote: true,
    retriedAfterConflict: true
  };
}

async function writeSnapshotFile(
  client: ReturnType<typeof githubClientFromEnv>,
  sourcePath: string,
  snapshot: AppSnapshot,
  sha?: string
): Promise<{ sha?: string }> {
  return client.writeFile({
    filePath: sourcePath,
    content: `${JSON.stringify(snapshot, null, 2)}\n`,
    message: `Update TodoTodoList snapshot ${snapshot.exportedAt.slice(0, 10)}`,
    sha
  });
}

async function readExistingSnapshot(
  client: ReturnType<typeof githubClientFromEnv>,
  sourcePath: string
): Promise<{ sha: string; snapshot: AppSnapshot } | null> {
  try {
    const file = await client.readFile(sourcePath);
    return {
      sha: file.sha,
      snapshot: validateSnapshot(JSON.parse(file.content))
    };
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

function githubSnapshotPath(): string {
  return process.env.GITHUB_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
}

function summarizeRemoteMerge(existing: AppSnapshot, incoming: AppSnapshot) {
  return {
    remoteItemsKept: countRemoteRecordsKept(existing.items, incoming.items),
    remoteSectionsKept: countRemoteRecordsKept(existing.sections, incoming.sections),
    remoteSettingsKept: countRemoteRecordsKept(existing.settings, incoming.settings)
  };
}

function emptyMergeSummary() {
  return {
    remoteItemsKept: 0,
    remoteSectionsKept: 0,
    remoteSettingsKept: 0
  };
}

function countRemoteRecordsKept<T extends { id: string; updatedAt: string }>(existing: T[], incoming: T[]): number {
  const incomingById = new Map(incoming.map((record) => [record.id, record]));
  return existing.filter((record) => {
    const incomingRecord = incomingById.get(record.id);
    return !incomingRecord || record.updatedAt > incomingRecord.updatedAt;
  }).length;
}
