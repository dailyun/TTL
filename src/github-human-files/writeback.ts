import matter from "gray-matter";
import type { Item } from "../domain/types.js";

export interface FrontmatterWritebackPatch {
  id?: string;
  type?: Item["type"];
  status?: Item["status"];
  section?: string;
  sectionId?: string;
  title?: string;
  tags?: string[];
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
  updatedAt?: string;
}

export function frontmatterPatchFromItem(item: Item): FrontmatterWritebackPatch {
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    section: item.sectionId,
    title: item.title,
    tags: item.tags,
    startAt: item.startAt,
    endAt: item.endAt,
    allDay: item.allDay,
    updatedAt: item.updatedAt
  };
}

export function writeBackFrontmatterOnly(
  markdown: string,
  patch: FrontmatterWritebackPatch
): string {
  const parsed = matter(markdown);
  const nextData = compactObject({
    ...parsed.data,
    ...patch
  });

  return matter.stringify(parsed.content, nextData);
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}
