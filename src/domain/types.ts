export type ItemType = "todo" | "idea" | "event" | "avoid" | "note";
export type ItemStatus = "wanted" | "active" | "paused" | "abandoned" | "done";

export interface ItemSourceLink {
  provider: "github" | "google_calendar";
  sourceId: string;
  sourcePath?: string;
  sourceSha?: string;
  frontmatterHash?: string;
  bodyHash?: string;
  writeBack: "none" | "frontmatter-only" | "full-file";
  line?: number;
  calendarId?: string;
  eventId?: string;
  etag?: string;
}

export interface ItemAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  createdAt: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  sectionId: string;
  status: ItemStatus;
  tags: string[];
  attachments?: ItemAttachment[];
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  source: "local" | "github" | "google_calendar";
  sourceLink?: ItemSourceLink;
  parentId?: string;
  goalTreeLink?: { treeId: string; nodeId: string };
  durationMinutes?: number;
  autoSchedule?: boolean;
  recurrence?: "daily" | "weekdays";
  calendarPlanId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface HumanSource {
  id: string;
  label: string;
  path: string;
  mode: "read-only" | "read-write";
  defaultSectionId: string;
  defaultType: ItemType;
  defaultStatus: ItemStatus;
  importCheckboxes: boolean;
  writeBack: "none" | "frontmatter-only" | "full-file";
}

export interface SourcesFile {
  version: 1;
  sources: HumanSource[];
}

export interface ImportedHumanFile {
  source: HumanSource;
  sourcePath: string;
  rootItem: Item;
  childItems: Item[];
}
