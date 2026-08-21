import path from "node:path";
import matter from "gray-matter";
import { frontmatterSchema } from "./schema.js";
import { contentHash, stableCheckboxId, stableItemId } from "./ids.js";
import type { HumanSource, ImportedHumanFile, Item, ItemStatus } from "../domain/types.js";

export interface HumanMarkdownFileInput {
  source: HumanSource;
  sourcePath: string;
  content: string;
  sourceSha?: string;
}

interface CheckboxMatch {
  line: number;
  checked: boolean;
  title: string;
  id?: string;
}

export function importHumanMarkdownFile(input: HumanMarkdownFileInput): ImportedHumanFile {
  const parsed = matter(input.content);
  const frontmatter = frontmatterSchema.parse(parsed.data);
  const body = parsed.content.trim();
  const now = new Date().toISOString();
  const title = frontmatter.title ?? findFirstHeading(body) ?? titleFromPath(input.sourcePath);
  const id = frontmatter.id ?? stableItemId(input.sourcePath);
  const updatedAt = toIsoString(frontmatter.updatedAt) ?? now;
  const createdAt = toIsoString(frontmatter.createdAt) ?? updatedAt;
  const sectionId = frontmatter.sectionId ?? frontmatter.section ?? input.source.defaultSectionId;

  const rootItem: Item = {
    id,
    type: frontmatter.type ?? input.source.defaultType,
    title,
    description: body,
    sectionId,
    status: frontmatter.status ?? input.source.defaultStatus,
    tags: frontmatter.tags ?? [],
    startAt: toIsoString(frontmatter.startAt),
    endAt: toIsoString(frontmatter.endAt),
    allDay: frontmatter.allDay,
    source: "github",
    sourceLink: {
      provider: "github",
      sourceId: input.source.id,
      sourcePath: input.sourcePath,
      sourceSha: input.sourceSha,
      frontmatterHash: contentHash(JSON.stringify(parsed.data ?? {})),
      bodyHash: contentHash(body),
      writeBack: input.source.writeBack
    },
    createdAt,
    updatedAt
  };

  const childItems = input.source.importCheckboxes
    ? parseCheckboxes(body).map((checkbox) => checkboxToItem(checkbox, input, rootItem, now))
    : [];

  return {
    source: input.source,
    sourcePath: input.sourcePath,
    rootItem,
    childItems
  };
}

function checkboxToItem(
  checkbox: CheckboxMatch,
  input: HumanMarkdownFileInput,
  parent: Item,
  now: string
): Item {
  const status: ItemStatus = checkbox.checked ? "done" : "wanted";
  return {
    id: checkbox.id ?? stableCheckboxId(input.sourcePath, checkbox.line, checkbox.title),
    type: "todo",
    title: checkbox.title,
    description: "",
    sectionId: parent.sectionId,
    status,
    tags: parent.tags,
    source: "github",
    parentId: parent.id,
    sourceLink: {
      provider: "github",
      sourceId: input.source.id,
      sourcePath: input.sourcePath,
      sourceSha: input.sourceSha,
      bodyHash: contentHash(input.content),
      writeBack: "none",
      line: checkbox.line
    },
    createdAt: now,
    updatedAt: now
  };
}

function parseCheckboxes(markdown: string): CheckboxMatch[] {
  const lines = markdown.split(/\r?\n/);
  const matches: CheckboxMatch[] = [];
  const checkboxPattern =
    /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)(?:\s*<!--\s*tdl:id=([A-Za-z0-9_-]+)\s*-->)?\s*$/;

  lines.forEach((line, index) => {
    const match = checkboxPattern.exec(line);
    if (!match) return;

    matches.push({
      line: index + 1,
      checked: match[1].toLowerCase() === "x",
      title: match[2].trim(),
      id: match[3]
    });
  });

  return matches;
}

function findFirstHeading(markdown: string): string | undefined {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading?.[1]?.trim();
}

function titleFromPath(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  return parsed.name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function toIsoString(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}
