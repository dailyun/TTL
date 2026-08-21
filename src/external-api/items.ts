import type { Item } from "../domain/types.js";
import { validateReverseTodoSchedule } from "../domain/reverse-todo.js";
import type { AppSnapshot } from "../local-db/db.js";
import { ExternalApiError } from "./errors.js";
import type {
  ExternalItemCreateInput,
  ExternalItemListQuery,
  ExternalItemPatchInput
} from "./schema.js";
import { nextTimestamp } from "./snapshot-store.js";

export function listExternalItems(snapshot: AppSnapshot, query: ExternalItemListQuery) {
  const search = query.q?.toLocaleLowerCase();
  const filtered = snapshot.items
    .filter((item) => query.includeDeleted === "true" || !item.deletedAt)
    .filter((item) => !query.type || item.type === query.type)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.sectionId || item.sectionId === query.sectionId)
    .filter((item) => !query.source || item.source === query.source)
    .filter(
      (item) =>
        !query.updatedSince ||
        new Date(item.updatedAt).getTime() >= new Date(query.updatedSince).getTime()
    )
    .filter((item) => {
      if (!search) return true;
      return [item.title, item.description, ...item.tags]
        .join("\n")
        .toLocaleLowerCase()
        .includes(search);
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    items: filtered.slice(query.offset, query.offset + query.limit),
    total: filtered.length
  };
}

export function findExternalItem(snapshot: AppSnapshot, id: string, includeDeleted = false): Item {
  const item = snapshot.items.find((candidate) => candidate.id === id);
  if (!item || (item.deletedAt && !includeDeleted)) {
    throw new ExternalApiError(404, "item_not_found", `Item '${id}' was not found.`);
  }
  return item;
}

export function createExternalItem(
  snapshot: AppSnapshot,
  input: ExternalItemCreateInput,
  id = input.id ?? crypto.randomUUID()
): { item: Item; snapshot: AppSnapshot } {
  if (snapshot.items.some((item) => item.id === id)) {
    throw new ExternalApiError(409, "item_already_exists", `Item '${id}' already exists.`);
  }
  assertSectionExists(snapshot, input.sectionId);

  const now = nextTimestamp(snapshot.exportedAt);
  const item: Item = {
    id,
    type: input.type,
    title: input.title,
    description: input.description,
    sectionId: input.sectionId,
    status: input.status,
    tags: normalizeTags(input.tags),
    startAt: input.startAt,
    endAt: input.endAt,
    allDay: input.allDay,
    source: "local",
    createdAt: now,
    updatedAt: now
  };
  assertValidSchedule(item);

  return {
    item,
    snapshot: { ...snapshot, items: [...snapshot.items, item] }
  };
}

export function updateExternalItem(
  snapshot: AppSnapshot,
  id: string,
  patch: ExternalItemPatchInput,
  ifMatch?: string
): { item: Item; snapshot: AppSnapshot } {
  const index = snapshot.items.findIndex((item) => item.id === id);
  if (index < 0) throw new ExternalApiError(404, "item_not_found", `Item '${id}' was not found.`);

  const current = snapshot.items[index]!;
  assertMutableItem(current);
  assertItemVersion(current, ifMatch);
  if (patch.sectionId) assertSectionExists(snapshot, patch.sectionId);

  const next: Item = {
    ...current,
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.sectionId !== undefined ? { sectionId: patch.sectionId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    updatedAt: nextTimestamp(current.updatedAt)
  };

  applyNullableField(next, "startAt", patch.startAt);
  applyNullableField(next, "endAt", patch.endAt);
  applyNullableField(next, "allDay", patch.allDay);
  if (patch.deletedAt === null) delete next.deletedAt;
  assertValidSchedule(next);

  const items = [...snapshot.items];
  items[index] = next;
  return { item: next, snapshot: { ...snapshot, items } };
}

export function deleteExternalItem(
  snapshot: AppSnapshot,
  id: string,
  ifMatch?: string
): { item: Item; snapshot: AppSnapshot } {
  const index = snapshot.items.findIndex((item) => item.id === id);
  if (index < 0) throw new ExternalApiError(404, "item_not_found", `Item '${id}' was not found.`);

  const current = snapshot.items[index]!;
  assertMutableItem(current);
  assertItemVersion(current, ifMatch);
  if (current.deletedAt) return { item: current, snapshot };

  const deletedAt = nextTimestamp(current.updatedAt);
  const next: Item = { ...current, deletedAt, updatedAt: deletedAt };
  const items = [...snapshot.items];
  items[index] = next;
  return { item: next, snapshot: { ...snapshot, items } };
}

export function itemEtag(item: Item): string {
  return `"${item.updatedAt}"`;
}

function assertMutableItem(item: Item): void {
  if (item.source !== "local") {
    throw new ExternalApiError(
      409,
      "provider_writeback_required",
      `Item '${item.id}' is owned by ${item.source}; update it through that provider-specific sync path.`
    );
  }
}

function assertItemVersion(item: Item, ifMatch?: string): void {
  if (!ifMatch || ifMatch === "*") return;
  const candidates = ifMatch.split(",").map((value) => value.trim().replace(/^W\//, ""));
  if (!candidates.includes(itemEtag(item))) {
    throw new ExternalApiError(
      412,
      "item_changed",
      `Item '${item.id}' changed after it was read. Fetch it again before updating.`,
      { currentUpdatedAt: item.updatedAt }
    );
  }
}

function assertSectionExists(snapshot: AppSnapshot, sectionId: string): void {
  const section = snapshot.sections.find((candidate) => candidate.id === sectionId && !candidate.archivedAt);
  if (!section) {
    throw new ExternalApiError(400, "unknown_section", `Active section '${sectionId}' does not exist.`);
  }
}

function assertValidSchedule(item: Item): void {
  const error = validateReverseTodoSchedule(item);
  if (error) throw new ExternalApiError(400, "invalid_schedule", error);
  if (item.startAt && item.endAt && new Date(item.endAt) < new Date(item.startAt)) {
    throw new ExternalApiError(400, "invalid_schedule", "endAt must not be earlier than startAt.");
  }
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function applyNullableField<K extends "startAt" | "endAt" | "allDay">(
  item: Item,
  key: K,
  value: Item[K] | null | undefined
): void {
  if (value === undefined) return;
  if (value === null) {
    delete item[key];
  } else {
    item[key] = value;
  }
}
