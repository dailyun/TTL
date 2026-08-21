import path from "node:path";
import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { importHumanMarkdownFile } from "../src/github-human-files/importer.js";
import { writeBackFrontmatterOnly } from "../src/github-human-files/writeback.js";
import type { HumanSource } from "../src/domain/types.js";

const repoRoot = path.resolve(process.cwd(), "examples/github-repo");
const sourcePath = "findwork/product-plan.md";
const absolutePath = path.join(repoRoot, sourcePath);

const source: HumanSource = {
  id: "findwork",
  label: "Find Work",
  path: "findwork/**/*.md",
  mode: "read-write",
  defaultSectionId: "work",
  defaultType: "idea",
  defaultStatus: "wanted",
  importCheckboxes: true,
  writeBack: "frontmatter-only"
};

const original = await readFile(absolutePath, "utf8");
const imported = importHumanMarkdownFile({
  source,
  sourcePath,
  content: original
});

const updated = writeBackFrontmatterOnly(original, {
  id: imported.rootItem.id,
  status: "active",
  updatedAt: "2026-07-07T13:00:00.000Z"
});

const originalParsed = matter(original);
const updatedParsed = matter(updated);

console.log(
  JSON.stringify(
    {
      sourcePath,
      before: {
        status: originalParsed.data.status,
        updatedAt: originalParsed.data.updatedAt
      },
      after: {
        status: updatedParsed.data.status,
        updatedAt: updatedParsed.data.updatedAt
      },
      bodyPreserved: originalParsed.content.trim() === updatedParsed.content.trim(),
      updatedMarkdown: updated
    },
    null,
    2
  )
);
