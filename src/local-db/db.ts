import { Dexie, type Table } from "dexie";
import type { Item, ItemAttachment, ItemStatus, ItemType } from "../domain/types.js";
import { validateReverseTodoSchedule } from "../domain/reverse-todo.js";
import { isSupportedCaptureImageType } from "../domain/attachments.js";

export interface Section {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isInbox?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  id: "default";
  defaultSectionId: string;
  showDoneInCalendar: boolean;
  showAbandonedInBoard: boolean;
  autoPullGitHubSnapshotOnStart: boolean;
  autoPushGitHubSnapshotOnChange: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSnapshot {
  app: "todotodolist";
  version: 1;
  exportedAt: string;
  items: Item[];
  sections: Section[];
  settings: AppSettings[];
  syncMetadata: unknown[];
}

export type SnapshotImportMode = "replace" | "merge";

class TodoTodoListDatabase extends Dexie {
  items!: Table<Item, string>;
  sections!: Table<Section, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super("todotodolist");
    this.version(1).stores({
      items: "id, type, status, sectionId, startAt, updatedAt, source, deletedAt",
      sections: "id, sortOrder, archivedAt",
      settings: "id"
    });
  }
}

export const db = new TodoTodoListDatabase();

export const DEFAULT_SECTIONS: Section[] = [
  section("inbox", "收集箱", "#6b7280", 0, true),
  section("work", "工作", "#276c63", 1),
  section("life", "生活", "#b7532f", 2)
];

export async function ensureSeedData(): Promise<void> {
  const sectionCount = await db.sections.count();
  if (sectionCount === 0) {
    await db.sections.bulkPut(DEFAULT_SECTIONS);
  }

  const settings = await db.settings.get("default");
  if (!settings) {
    const now = new Date().toISOString();
    await db.settings.put({
      id: "default",
      defaultSectionId: "inbox",
      showDoneInCalendar: false,
      showAbandonedInBoard: false,
      autoPullGitHubSnapshotOnStart: false,
      autoPushGitHubSnapshotOnChange: false,
      createdAt: now,
      updatedAt: now
    });
  }

  const itemCount = await db.items.count();
  if (itemCount === 0) {
    await db.items.bulkPut(seedItems());
  }
}

export async function listActiveItems(): Promise<Item[]> {
  return db.items
    .filter((item) => !item.deletedAt)
    .toArray()
    .then((items) =>
      items.sort((a, b) => {
        const aTime = a.startAt ?? a.updatedAt;
        const bTime = b.startAt ?? b.updatedAt;
        return bTime.localeCompare(aTime);
      })
    );
}

export async function listSections(): Promise<Section[]> {
  return db.sections
    .filter((section) => !section.archivedAt)
    .toArray()
    .then((sections) => sections.sort((a, b) => a.sortOrder - b.sortOrder));
}

export async function listAllSections(): Promise<Section[]> {
  return db.sections
    .toArray()
    .then((sections) => sections.sort((a, b) => a.sortOrder - b.sortOrder));
}

export async function getAppSettings(): Promise<AppSettings> {
  await ensureSeedData();
  const settings = await db.settings.get("default");
  return settings ? normalizeAppSettings(settings) : defaultSettings();
}

export async function updateAppSettings(patch: Partial<Omit<AppSettings, "id" | "createdAt">>): Promise<AppSettings> {
  const current = await getAppSettings();
  const nextSettings: AppSettings = {
    ...current,
    ...patch,
    id: "default",
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  };
  await db.settings.put(nextSettings);
  return nextSettings;
}

export async function createItem(input: {
  title: string;
  type: ItemType;
  status: ItemStatus;
  sectionId: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  tags?: string[];
  attachments?: ItemAttachment[];
}): Promise<Item> {
  const reverseTodoError = validateReverseTodoSchedule(input);
  if (reverseTodoError) throw new Error(reverseTodoError);

  const now = new Date().toISOString();
  const item: Item = {
    id: crypto.randomUUID(),
    type: input.type,
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    sectionId: input.sectionId,
    status: input.status,
    tags: input.tags ?? [],
    attachments: input.attachments?.length ? input.attachments : undefined,
    startAt: input.startAt || undefined,
    endAt: input.endAt || undefined,
    allDay: input.allDay || undefined,
    source: "local",
    createdAt: now,
    updatedAt: now
  };
  await db.items.put(item);
  return item;
}

export async function updateItem(
  id: string,
  patch: Partial<Item>,
  updatedAt = new Date().toISOString()
): Promise<string> {
  await db.items.update(id, {
    ...patch,
    updatedAt
  });
  return updatedAt;
}

export async function softDeleteItem(id: string): Promise<void> {
  await db.items.update(id, {
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export async function importItems(items: Item[]): Promise<void> {
  await ensureSeedData();
  const existingItems = await db.items.bulkGet(items.map((item) => item.id));
  await db.items.bulkPut(filterItemsForImport(items, existingItems));
}

export async function reconcileHumanSourceItems(
  items: Item[],
  sourceIds: string[],
  now = new Date().toISOString()
): Promise<{ importedCount: number; deletedCount: number }> {
  const uniqueSourceIds = Array.from(new Set(sourceIds.filter(Boolean)));
  if (uniqueSourceIds.length === 0) {
    return { importedCount: 0, deletedCount: 0 };
  }

  await ensureSeedData();
  const sourceIdSet = new Set(uniqueSourceIds);
  const incoming = items.filter(
    (item) => item.source === "github" && item.sourceLink?.provider === "github" && sourceIdSet.has(item.sourceLink.sourceId)
  );

  return db.transaction("rw", db.items, async () => {
    const existing = await db.items
      .where("source")
      .equals("github")
      .filter((item) => Boolean(item.sourceLink?.sourceId && sourceIdSet.has(item.sourceLink.sourceId)))
      .toArray();
    const reconciled = buildHumanSourceReconciliation(existing, incoming, now);
    await db.items.bulkPut(reconciled.records);
    return {
      importedCount: incoming.length,
      deletedCount: reconciled.deletedCount
    };
  });
}

export function buildHumanSourceReconciliation(
  existing: Item[],
  incoming: Item[],
  now: string
): { records: Item[]; deletedCount: number } {
  const incomingIds = new Set(incoming.map((item) => item.id));
  const tombstones = existing
    .filter((item) => !incomingIds.has(item.id) && !item.deletedAt)
    .map((item) => ({
      ...item,
      deletedAt: now,
      updatedAt: now
    }));

  return {
    records: [...incoming, ...tombstones],
    deletedCount: tombstones.length
  };
}

export function filterItemsForImport(items: Item[], existingItems: Array<Item | undefined>): Item[] {
  return items.filter((item, index) => shouldImportByUpdatedAt(item, existingItems[index]));
}

export function mergeSnapshots(existing: AppSnapshot, incoming: AppSnapshot): AppSnapshot {
  return {
    app: "todotodolist",
    version: 1,
    exportedAt: incoming.exportedAt >= existing.exportedAt ? incoming.exportedAt : existing.exportedAt,
    items: mergeByUpdatedAt(existing.items, incoming.items),
    sections: mergeByUpdatedAt(existing.sections, incoming.sections),
    settings: mergeByUpdatedAt(existing.settings, incoming.settings),
    syncMetadata: incoming.syncMetadata.length ? incoming.syncMetadata : existing.syncMetadata
  };
}

export async function importSnapshot(
  snapshot: unknown,
  options: { mode: SnapshotImportMode }
): Promise<AppSnapshot> {
  const parsed = validateSnapshot(snapshot);
  await db.transaction("rw", db.items, db.sections, db.settings, async () => {
    if (options.mode === "replace") {
      await Promise.all([db.items.clear(), db.sections.clear(), db.settings.clear()]);
      await db.items.bulkPut(parsed.items);
      await db.sections.bulkPut(parsed.sections.length ? parsed.sections : DEFAULT_SECTIONS);
      await db.settings.bulkPut(parsed.settings.length ? parsed.settings : [defaultSettings()]);
      return;
    }

    const [existingItems, existingSections, existingSettings] = await Promise.all([
      db.items.bulkGet(parsed.items.map((item) => item.id)),
      db.sections.bulkGet(parsed.sections.map((section) => section.id)),
      db.settings.bulkGet(parsed.settings.map((setting) => setting.id))
    ]);

    await Promise.all([
      db.items.bulkPut(
        parsed.items.filter((item, index) => shouldImportByUpdatedAt(item, existingItems[index]))
      ),
      db.sections.bulkPut(
        parsed.sections.filter((section, index) => shouldImportByUpdatedAt(section, existingSections[index]))
      ),
      db.settings.bulkPut(
        parsed.settings.filter((setting, index) => shouldImportByUpdatedAt(setting, existingSettings[index]))
      )
    ]);
  });
  return parsed;
}

export async function createSection(name: string): Promise<Section> {
  const now = new Date().toISOString();
  const count = await db.sections.count();
  const baseId = slugify(name) || crypto.randomUUID();
  const newSection: Section = {
    id: await uniqueSectionId(baseId),
    name: name.trim(),
    color: "#5c6f82",
    sortOrder: count,
    createdAt: now,
    updatedAt: now
  };
  await db.sections.put(newSection);
  return newSection;
}

export async function updateSection(
  id: string,
  patch: Partial<Pick<Section, "name" | "color">>
): Promise<Section> {
  const current = await db.sections.get(id);
  if (!current) {
    throw new Error("版块不存在");
  }

  const nextSection: Section = {
    ...current,
    name: patch.name?.trim() || current.name,
    color: patch.color || current.color,
    updatedAt: new Date().toISOString()
  };
  await db.sections.put(nextSection);
  return nextSection;
}

export async function archiveSection(id: string): Promise<Section> {
  const current = await db.sections.get(id);
  if (!current) {
    throw new Error("版块不存在");
  }
  if (current.isInbox) {
    throw new Error("收集箱不能归档");
  }

  const now = new Date().toISOString();
  const nextSection: Section = {
    ...current,
    archivedAt: now,
    updatedAt: now
  };
  await db.sections.put(nextSection);
  return nextSection;
}

export async function exportSnapshot() {
  const [items, sections, settings] = await Promise.all([
    db.items.toArray(),
    db.sections.toArray(),
    db.settings.toArray()
  ]);
  return {
    app: "todotodolist",
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
    sections,
    settings: settings.map(normalizeAppSettings),
    syncMetadata: []
  } satisfies AppSnapshot;
}

export function validateSnapshot(snapshot: unknown): AppSnapshot {
  if (!isRecord(snapshot)) {
    throw new Error("导入文件不是有效的 JSON 对象");
  }
  if (snapshot.app !== "todotodolist") {
    throw new Error("导入文件不是 TodoTodoList 快照");
  }
  if (snapshot.version !== 1) {
    throw new Error("暂不支持该快照版本");
  }
  if (typeof snapshot.exportedAt !== "string") {
    throw new Error("快照缺少 exportedAt");
  }
  if (!Array.isArray(snapshot.items)) {
    throw new Error("快照缺少 items 数组");
  }
  if (!Array.isArray(snapshot.sections)) {
    throw new Error("快照缺少 sections 数组");
  }
  if (!Array.isArray(snapshot.settings)) {
    throw new Error("快照缺少 settings 数组");
  }

  const items = snapshot.items.map(validateSnapshotItem);
  const sections = snapshot.sections.map(validateSnapshotSection);
  const settings = snapshot.settings.map(validateSnapshotSettings);
  const syncMetadata = Array.isArray(snapshot.syncMetadata) ? snapshot.syncMetadata : [];

  return {
    app: "todotodolist",
    version: 1,
    exportedAt: snapshot.exportedAt,
    items,
    sections,
    settings,
    syncMetadata
  };
}

function validateSnapshotItem(value: unknown, index: number): Item {
  if (!isRecord(value)) {
    throw new Error(`items[${index}] 不是有效对象`);
  }
  assertString(value.id, `items[${index}].id`);
  assertString(value.title, `items[${index}].title`);
  assertString(value.description, `items[${index}].description`);
  assertString(value.sectionId, `items[${index}].sectionId`);
  assertString(value.createdAt, `items[${index}].createdAt`);
  assertString(value.updatedAt, `items[${index}].updatedAt`);
  if (!isItemType(value.type)) throw new Error(`items[${index}].type 无效`);
  if (!isItemStatus(value.status)) throw new Error(`items[${index}].status 无效`);
  if (!isItemSource(value.source)) throw new Error(`items[${index}].source 无效`);
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) {
    throw new Error(`items[${index}].tags 必须是字符串数组`);
  }
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) {
      throw new Error(`items[${index}].attachments 必须是数组`);
    }
    value.attachments.forEach((attachment, attachmentIndex) => {
      validateSnapshotAttachment(attachment, `items[${index}].attachments[${attachmentIndex}]`);
    });
  }
  return value as unknown as Item;
}

function validateSnapshotAttachment(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} 不是有效对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`);
  assertString(value.mimeType, `${path}.mimeType`);
  assertNumber(value.size, `${path}.size`);
  assertString(value.dataUrl, `${path}.dataUrl`);
  assertString(value.createdAt, `${path}.createdAt`);
  if (!isSupportedCaptureImageType(value.mimeType) || !value.dataUrl.startsWith(`data:${value.mimeType};`)) {
    throw new Error(`${path} 必须是支持的图片附件`);
  }
}

function validateSnapshotSection(value: unknown, index: number): Section {
  if (!isRecord(value)) {
    throw new Error(`sections[${index}] 不是有效对象`);
  }
  assertString(value.id, `sections[${index}].id`);
  assertString(value.name, `sections[${index}].name`);
  assertString(value.color, `sections[${index}].color`);
  assertNumber(value.sortOrder, `sections[${index}].sortOrder`);
  assertString(value.createdAt, `sections[${index}].createdAt`);
  assertString(value.updatedAt, `sections[${index}].updatedAt`);
  return value as unknown as Section;
}

function validateSnapshotSettings(value: unknown, index: number): AppSettings {
  if (!isRecord(value)) {
    throw new Error(`settings[${index}] 不是有效对象`);
  }
  if (value.id !== "default") throw new Error(`settings[${index}].id 无效`);
  assertString(value.defaultSectionId, `settings[${index}].defaultSectionId`);
  assertBoolean(value.showDoneInCalendar, `settings[${index}].showDoneInCalendar`);
  assertBoolean(value.showAbandonedInBoard, `settings[${index}].showAbandonedInBoard`);
  assertString(value.createdAt, `settings[${index}].createdAt`);
  assertString(value.updatedAt, `settings[${index}].updatedAt`);
  return normalizeAppSettings(value as unknown as AppSettings);
}

function shouldImportByUpdatedAt<T extends { updatedAt: string }>(incoming: T, existing?: T): boolean {
  return !existing || incoming.updatedAt >= existing.updatedAt;
}

function mergeByUpdatedAt<T extends { id: string; updatedAt: string }>(existing: T[], incoming: T[]): T[] {
  const merged = new Map(existing.map((record) => [record.id, record]));
  incoming.forEach((record) => {
    if (shouldImportByUpdatedAt(record, merged.get(record.id))) {
      merged.set(record.id, record);
    }
  });
  return Array.from(merged.values());
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    autoPullGitHubSnapshotOnStart:
      typeof settings.autoPullGitHubSnapshotOnStart === "boolean"
        ? settings.autoPullGitHubSnapshotOnStart
        : false,
    autoPushGitHubSnapshotOnChange:
      typeof settings.autoPushGitHubSnapshotOnChange === "boolean"
        ? settings.autoPushGitHubSnapshotOnChange
        : false
  };
}

function defaultSettings(): AppSettings {
  const now = new Date().toISOString();
  return {
    id: "default",
    defaultSectionId: "inbox",
    showDoneInCalendar: false,
    showAbandonedInBoard: false,
    autoPullGitHubSnapshotOnStart: false,
    autoPushGitHubSnapshotOnChange: false,
    createdAt: now,
    updatedAt: now
  };
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${path} 必须是字符串`);
  }
}

function assertNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${path} 必须是数字`);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} 必须是布尔值`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isItemType(value: unknown): value is ItemType {
  return value === "todo" || value === "idea" || value === "event" || value === "avoid" || value === "note";
}

function isItemStatus(value: unknown): value is ItemStatus {
  return value === "wanted" || value === "active" || value === "paused" || value === "abandoned" || value === "done";
}

function isItemSource(value: unknown): value is Item["source"] {
  return value === "local" || value === "github" || value === "google_calendar";
}

function section(
  id: string,
  name: string,
  color: string,
  sortOrder: number,
  isInbox = false
): Section {
  const now = new Date().toISOString();
  return {
    id,
    name,
    color,
    sortOrder,
    isInbox,
    createdAt: now,
    updatedAt: now
  };
}

function seedItems(): Item[] {
  const now = new Date();
  const todayAt = (hours: number, minutes = 0) => {
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  };
  const timestamp = now.toISOString();

  return [
    seedItem("idea-github-human-files", "研究 GitHub 人工文件同步", "idea", "wanted", "work", timestamp),
    seedItem("todo-product-plan", "完善产品方案和技术路线", "todo", "active", "work", timestamp),
    seedItem("event-sync-review", "同步方案评审", "event", "active", "work", timestamp, todayAt(15)),
    seedItem("idea-weekend-life", "周末整理生活计划", "idea", "wanted", "life", timestamp),
    seedItem("todo-expenses", "整理生活开销", "todo", "paused", "life", timestamp)
  ];
}

function seedItem(
  id: string,
  title: string,
  type: ItemType,
  status: ItemStatus,
  sectionId: string,
  timestamp: string,
  startAt?: string
): Item {
  return {
    id,
    title,
    type,
    status,
    sectionId,
    description: "",
    tags: [],
    startAt,
    source: "local",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSectionId(baseId: string): Promise<string> {
  if (!(await db.sections.get(baseId))) return baseId;
  let index = 2;
  while (await db.sections.get(`${baseId}-${index}`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}
