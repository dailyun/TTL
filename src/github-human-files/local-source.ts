import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import fg from "fast-glob";
import matter from "gray-matter";
import { sourcesFileSchema } from "./schema.js";
import { importHumanMarkdownFile } from "./importer.js";
import { writeBackFrontmatterOnly, type FrontmatterWritebackPatch } from "./writeback.js";
import type { HumanSource, ImportedHumanFile, Item, SourcesFile } from "../domain/types.js";

export interface CreateLocalHumanMarkdownFileInput {
  repoRoot: string;
  source: HumanSource;
  title: string;
  type?: Item["type"];
  status?: Item["status"];
  sectionId?: string;
  tags?: string[];
  description?: string;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
}

export async function readSourcesFile(filePath: string): Promise<SourcesFile> {
  const raw = await readFile(filePath, "utf8");
  return sourcesFileSchema.parse(JSON.parse(raw));
}

export async function importLocalHumanSource(
  repoRoot: string,
  source: HumanSource
): Promise<ImportedHumanFile[]> {
  const files = await fg(source.path, {
    cwd: repoRoot,
    onlyFiles: true,
    dot: false
  });

  const imports = await Promise.all(
    files.sort().map(async (sourcePath) => {
      const absolutePath = path.join(repoRoot, sourcePath);
      const content = await readFile(absolutePath, "utf8");
      return importHumanMarkdownFile({
        source,
        sourcePath,
        content
      });
    })
  );

  return imports;
}

export async function importLocalHumanSources(
  repoRoot: string,
  sources: SourcesFile
): Promise<ImportedHumanFile[]> {
  const imported = await Promise.all(
    sources.sources.map((source) => importLocalHumanSource(repoRoot, source))
  );

  return imported.flat();
}

export async function createLocalHumanMarkdownFile(
  input: CreateLocalHumanMarkdownFileInput
): Promise<{ sourcePath: string; content: string; imported: ImportedHumanFile }> {
  if (input.source.mode !== "read-write") {
    throw new Error(`Source is not writable: ${input.source.id}`);
  }

  const now = new Date().toISOString();
  const sourceDirectory = sourceBaseDirectory(input.source.path);
  const slug = slugify(input.title) || "item";
  const id = `item_${slug.replace(/-/g, "_")}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const content = matter.stringify(markdownBody(input.title, input.description), compactFrontmatter({
    id,
    type: input.type ?? input.source.defaultType,
    status: input.status ?? input.source.defaultStatus,
    section: input.sectionId ?? input.source.defaultSectionId,
    title: input.title.trim(),
    tags: input.tags ?? [],
    startAt: input.startAt,
    endAt: input.endAt,
    allDay: input.allDay,
    createdAt: now,
    updatedAt: now,
    todotodolist: {
      sync: true,
      source: input.source.id
    }
  }));

  const sourcePath = await writeUniqueMarkdownFile({
    repoRoot: input.repoRoot,
    directory: sourceDirectory,
    slug,
    content
  });
  const imported = importHumanMarkdownFile({
    source: input.source,
    sourcePath,
    content
  });

  return {
    sourcePath,
    content,
    imported
  };
}

export async function writeBackLocalHumanFileFrontmatter(params: {
  repoRoot: string;
  sourcePath: string;
  patch: FrontmatterWritebackPatch;
}): Promise<{ sourcePath: string; content: string }> {
  const absolutePath = resolveRepoFile(params.repoRoot, params.sourcePath);
  const current = await readFile(absolutePath, "utf8");
  const updated = writeBackFrontmatterOnly(current, params.patch);
  await writeFile(absolutePath, updated, "utf8");

  return {
    sourcePath: params.sourcePath,
    content: updated
  };
}

function resolveRepoFile(repoRoot: string, sourcePath: string): string {
  const root = path.resolve(repoRoot);
  const filePath = path.resolve(root, sourcePath);
  const relative = path.relative(root, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Source path escapes repo root: ${sourcePath}`);
  }

  return filePath;
}

async function writeUniqueMarkdownFile(params: {
  repoRoot: string;
  directory: string;
  slug: string;
  content: string;
}): Promise<string> {
  const directory = validateRepoDirectory(params.directory);
  await mkdir(resolveRepoFile(params.repoRoot, directory), { recursive: true });

  for (let index = 0; index < 100; index += 1) {
    const filename = index === 0 ? `${params.slug}.md` : `${params.slug}-${index + 1}.md`;
    const sourcePath = path.posix.join(directory, filename);
    const absolutePath = resolveRepoFile(params.repoRoot, sourcePath);

    try {
      await writeFile(absolutePath, params.content, { encoding: "utf8", flag: "wx" });
      return sourcePath;
    } catch (error) {
      if (isFileExistsError(error)) continue;
      throw error;
    }
  }

  throw new Error(`Could not create unique markdown file for: ${params.slug}`);
}

function sourceBaseDirectory(globPath: string): string {
  const wildcardIndex = globPath.search(/[*?[\]{}]/);
  const stablePrefix = wildcardIndex === -1 ? path.posix.dirname(globPath) : globPath.slice(0, wildcardIndex);
  const normalized = stablePrefix.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized && normalized !== "." ? normalized : "items";
}

function validateRepoDirectory(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (!normalized || normalized.includes("\0")) {
    throw new Error(`Invalid repo directory: ${value}`);
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid repo directory: ${value}`);
  }

  return normalized;
}

function markdownBody(title: string, description?: string): string {
  const body = description?.trim();
  return body ? `# ${title.trim()}\n\n${body}\n` : `# ${title.trim()}\n`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}

function compactFrontmatter<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}

export { importHumanMarkdownFile } from "./importer.js";
export { writeBackFrontmatterOnly } from "./writeback.js";
