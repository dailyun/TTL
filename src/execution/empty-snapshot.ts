import type { AppSnapshot } from "../local-db/db.js";
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
        autoSyncGoogleCalendar: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    syncMetadata: []
  };
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
