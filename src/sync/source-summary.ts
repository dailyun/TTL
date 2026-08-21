import type { Item, ItemStatus } from "../domain/types.js";

export interface SourceFileSummary {
  sourceId: string;
  sourcePath: string;
  itemCount: number;
  rootItemCount: number;
  childItemCount: number;
  writableItemCount: number;
  statusCounts: Record<ItemStatus, number>;
  latestUpdatedAt: string;
  sourceSha?: string;
  frontmatterHash?: string;
  bodyHash?: string;
  writeBack: "none" | "frontmatter-only" | "full-file";
}

const EMPTY_STATUS_COUNTS: Record<ItemStatus, number> = {
  wanted: 0,
  active: 0,
  paused: 0,
  abandoned: 0,
  done: 0
};

export function summarizeSourceFiles(items: Item[]): SourceFileSummary[] {
  const summaries = new Map<string, SourceFileSummary>();

  for (const item of items) {
    if (item.deletedAt || item.source !== "github" || !item.sourceLink) {
      continue;
    }

    const sourceLink = item.sourceLink;
    const sourcePath = sourceLink.sourcePath;
    if (!sourcePath) {
      continue;
    }
    const key = `${sourceLink.sourceId}:${sourcePath}`;
    const existing = summaries.get(key);
    const summary =
      existing ??
      {
        sourceId: sourceLink.sourceId,
        sourcePath,
        itemCount: 0,
        rootItemCount: 0,
        childItemCount: 0,
        writableItemCount: 0,
        statusCounts: { ...EMPTY_STATUS_COUNTS },
        latestUpdatedAt: item.updatedAt,
        sourceSha: sourceLink.sourceSha,
        frontmatterHash: sourceLink.frontmatterHash,
        bodyHash: sourceLink.bodyHash,
        writeBack: sourceLink.writeBack
      };

    summary.itemCount += 1;
    if (item.parentId) {
      summary.childItemCount += 1;
    } else {
      summary.rootItemCount += 1;
    }
    if (sourceLink.writeBack !== "none") {
      summary.writableItemCount += 1;
    }
    summary.statusCounts[item.status] += 1;
    if (item.updatedAt > summary.latestUpdatedAt) {
      summary.latestUpdatedAt = item.updatedAt;
    }
    summary.sourceSha = summary.sourceSha ?? sourceLink.sourceSha;
    summary.frontmatterHash = summary.frontmatterHash ?? sourceLink.frontmatterHash;
    summary.bodyHash = summary.bodyHash ?? sourceLink.bodyHash;
    if (summary.writeBack === "none" && sourceLink.writeBack !== "none") {
      summary.writeBack = sourceLink.writeBack;
    }

    summaries.set(key, summary);
  }

  return Array.from(summaries.values()).sort((a, b) => {
    const timeOrder = b.latestUpdatedAt.localeCompare(a.latestUpdatedAt);
    return timeOrder || a.sourcePath.localeCompare(b.sourcePath);
  });
}
