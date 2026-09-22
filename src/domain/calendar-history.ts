import type { Item, ItemStatus } from "./types.js";

export type ItemDisplayStatus = ItemStatus | "history";

/** A past imported schedule is not evidence that work is still active or completed. */
export function itemDisplayStatus(item: Item, now = new Date()): ItemDisplayStatus {
  if (item.deletedAt || item.source !== "google_calendar" || item.type !== "event" ||
      item.goalTreeLink || item.status !== "active" || !item.endAt) return item.status;
  const end = new Date(item.endAt);
  if (!Number.isFinite(end.getTime())) return item.status;
  if (item.allDay) {
    // Workspace all-day dates include the final day; compare whole calendar days.
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return end.toISOString().slice(0, 10) < today ? "history" : item.status;
  }
  return end.getTime() <= now.getTime() ? "history" : item.status;
}
