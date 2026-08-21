import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export interface LocalGitChangedFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  label: string;
}

export interface LocalGitStatus {
  repoRoot: string;
  branch: string;
  head: string;
  isClean: boolean;
  changedFiles: LocalGitChangedFile[];
  diffStat: string;
}

export interface LocalGitDiff {
  repoRoot: string;
  path?: string;
  diff: string;
}

export const localGitCommitRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .default("Update TodoTodoList human files")
});

export const localGitDiffRequestSchema = z.object({
  path: z.string().trim().min(1).max(500).optional()
});

export async function getLocalGitStatus(repoRoot: string): Promise<LocalGitStatus> {
  const [branch, head, porcelain, diffStat] = await Promise.all([
    git(repoRoot, ["branch", "--show-current"]),
    git(repoRoot, ["rev-parse", "--short", "HEAD"]).catch(() => ""),
    git(repoRoot, ["status", "--porcelain=v1"]),
    git(repoRoot, ["diff", "--stat"])
  ]);

  const changedFiles = parsePorcelainStatus(porcelain);

  return {
    repoRoot,
    branch: branch.trim() || "detached",
    head: head.trim(),
    isClean: changedFiles.length === 0,
    changedFiles,
    diffStat: diffStat.trim()
  };
}

export async function getLocalGitDiff(params: {
  repoRoot: string;
  path?: string;
}): Promise<LocalGitDiff> {
  const safePath = params.path ? validateRepoRelativePath(params.path) : undefined;
  const args = safePath ? ["diff", "--", safePath] : ["diff"];
  const diff = await git(params.repoRoot, args);

  return {
    repoRoot: params.repoRoot,
    path: safePath,
    diff
  };
}

export async function commitLocalGitChanges(params: {
  repoRoot: string;
  message: string;
}): Promise<{
  committed: boolean;
  commit?: string;
  status: LocalGitStatus;
}> {
  const before = await getLocalGitStatus(params.repoRoot);
  if (before.isClean) {
    return {
      committed: false,
      status: before
    };
  }

  await git(params.repoRoot, ["add", "."]);
  await git(params.repoRoot, [
    "-c",
    "user.name=TodoTodoList Local",
    "-c",
    "user.email=local@todotodolist.local",
    "commit",
    "-m",
    params.message
  ]);

  const [commit, status] = await Promise.all([
    git(params.repoRoot, ["rev-parse", "--short", "HEAD"]),
    getLocalGitStatus(params.repoRoot)
  ]);

  return {
    committed: true,
    commit: commit.trim(),
    status
  };
}

export function parsePorcelainStatus(value: string): LocalGitChangedFile[] {
  return value
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const indexStatus = line[0] ?? " ";
      const worktreeStatus = line[1] ?? " ";
      const path = parsePorcelainPath(line.slice(3));

      return {
        path,
        indexStatus,
        worktreeStatus,
        label: statusLabel(indexStatus, worktreeStatus)
      };
    });
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    maxBuffer: 1024 * 1024
  });
  return stdout;
}

function parsePorcelainPath(raw: string): string {
  const renameSeparator = " -> ";
  const path = raw.includes(renameSeparator)
    ? raw.slice(raw.indexOf(renameSeparator) + renameSeparator.length)
    : raw;
  return path.trim();
}

export function validateRepoRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error(`Invalid repo-relative path: ${value}`);
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error(`Invalid repo-relative path: ${value}`);
  }

  return normalized;
}

function statusLabel(indexStatus: string, worktreeStatus: string): string {
  const statuses = [indexStatus, worktreeStatus].filter((status) => status !== " ");

  if (statuses.includes("?")) return "未跟踪";
  if (statuses.includes("A")) return "新增";
  if (statuses.includes("D")) return "删除";
  if (statuses.includes("R")) return "重命名";
  if (statuses.includes("M")) return "修改";
  return "变更";
}
