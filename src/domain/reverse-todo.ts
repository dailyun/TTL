import type { Item } from "./types.js";

export type ReverseTodoPhase = "unscheduled" | "invalid" | "upcoming" | "active" | "expired";

export function validateReverseTodoSchedule(
  item: Pick<Item, "type" | "startAt" | "endAt">
): string | null {
  if (item.type !== "avoid") return null;
  if (!item.startAt || !item.endAt) return "反向待办需要填写开始和结束时间";

  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "反向待办的时间格式无效";
  }
  if (end <= start) return "反向待办的结束时间必须晚于开始时间";
  return null;
}

export function getReverseTodoPhase(
  item: Pick<Item, "type" | "startAt" | "endAt">,
  now = new Date()
): ReverseTodoPhase {
  if (item.type !== "avoid" || !item.startAt || !item.endAt) {
    return "unscheduled";
  }

  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return "invalid";
  }

  if (now < start) return "upcoming";
  if (now >= end) return "expired";
  return "active";
}

export function isOpenReverseTodo(item: Item): boolean {
  return item.type === "avoid" && item.status !== "done" && item.status !== "abandoned";
}
