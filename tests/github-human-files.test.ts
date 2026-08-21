import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import matter from "gray-matter";
import {
  createLocalHumanMarkdownFile,
  importLocalHumanSources,
  readSourcesFile,
  writeBackLocalHumanFileFrontmatter
} from "../src/github-human-files/local-source.js";
import { importHumanMarkdownFile } from "../src/github-human-files/importer.js";
import { writeBackFrontmatterOnly } from "../src/github-human-files/writeback.js";
import type { HumanSource } from "../src/domain/types.js";

const repoRoot = path.resolve(process.cwd(), "examples/github-repo");

test("imports findwork markdown files into root items and checkbox todos", async () => {
  const sources = await readSourcesFile(path.join(repoRoot, "todotodolist", "sources.json"));
  const imported = await importLocalHumanSources(repoRoot, sources);
  const items = imported.flatMap((entry) => [entry.rootItem, ...entry.childItems]);

  assert.equal(imported.length, 2);
  assert.equal(items.length, 7);

  const productPlan = items.find((item) => item.id === "item_findwork_product_plan");
  assert.ok(productPlan);
  assert.equal(productPlan.type, "idea");
  assert.equal(productPlan.sectionId, "work");
  assert.equal(productPlan.sourceLink?.sourcePath, "findwork/product-plan.md");

  const checkboxTodo = items.find((item) => item.id === "item_research_github_contents");
  assert.ok(checkboxTodo);
  assert.equal(checkboxTodo.type, "todo");
  assert.equal(checkboxTodo.parentId, "item_findwork_product_plan");
  assert.equal(checkboxTodo.status, "wanted");

  const doneTodo = items.find((item) => item.title === "确认用户希望人工可读写");
  assert.ok(doneTodo);
  assert.equal(doneTodo.status, "done");
});

test("imports markdown without frontmatter using defaults and first heading", async () => {
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
  const content = await readFile(
    path.join(repoRoot, "findwork", "ideas", "calendar-sync.md"),
    "utf8"
  );

  const imported = importHumanMarkdownFile({
    source,
    sourcePath: "findwork/ideas/calendar-sync.md",
    content
  });

  assert.equal(imported.rootItem.title, "Google Calendar 双向同步");
  assert.equal(imported.rootItem.id, "item_7bab3319b20df73f");
  assert.equal(imported.childItems.length, 2);
});

test("frontmatter-only writeback updates metadata and preserves markdown body", async () => {
  const sourcePath = path.join(repoRoot, "findwork", "product-plan.md");
  const original = await readFile(sourcePath, "utf8");
  const originalParsed = matter(original);

  const updated = writeBackFrontmatterOnly(original, {
    status: "active",
    updatedAt: "2026-07-07T13:00:00.000Z"
  });
  const updatedParsed = matter(updated);

  assert.equal(updatedParsed.data.status, "active");
  assert.equal(updatedParsed.data.updatedAt, "2026-07-07T13:00:00.000Z");
  assert.equal(updatedParsed.content.trim(), originalParsed.content.trim());
});

test("frontmatter-only writeback can clear optional schedule fields", () => {
  const original = `---
title: Multi-day event
status: active
startAt: '2026-07-22T07:00:00.000Z'
endAt: '2026-07-23T07:00:00.000Z'
---

# Multi-day event

Body stays.
`;

  const updated = writeBackFrontmatterOnly(original, {
    endAt: null,
    updatedAt: "2026-07-07T14:00:00.000Z"
  });
  const updatedParsed = matter(updated);

  assert.equal(updatedParsed.data.endAt, null);
  assert.equal(updatedParsed.data.updatedAt, "2026-07-07T14:00:00.000Z");
  assert.equal(updatedParsed.content.trim(), "# Multi-day event\n\nBody stays.");
});

test("local frontmatter writeback updates a repo file and rejects path escapes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tdl-writeback-"));

  try {
    await writeFile(
      path.join(root, "note.md"),
      `---
title: Old
status: wanted
---

# Original

Body stays.
`,
      "utf8"
    );

    await writeBackLocalHumanFileFrontmatter({
      repoRoot: root,
      sourcePath: "note.md",
      patch: {
        title: "New",
        status: "active",
        updatedAt: "2026-07-07T12:00:00.000Z"
      }
    });

    const updated = await readFile(path.join(root, "note.md"), "utf8");
    assert.match(updated, /title: New/);
    assert.match(updated, /status: active/);
    assert.match(updated, /Body stays/);

    await assert.rejects(
      () =>
        writeBackLocalHumanFileFrontmatter({
          repoRoot: root,
          sourcePath: "../escape.md",
          patch: { status: "done" }
        }),
      /escapes repo root/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a local human markdown file and imports it as a github item", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tdl-create-human-"));
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

  try {
    const created = await createLocalHumanMarkdownFile({
      repoRoot: root,
      source,
      title: "Plan New Project",
      type: "todo",
      status: "active",
      sectionId: "work",
      tags: ["planning"],
      description: "- [ ] Draft outline"
    });
    const duplicate = await createLocalHumanMarkdownFile({
      repoRoot: root,
      source,
      title: "Plan New Project"
    });
    const chineseTitle = await createLocalHumanMarkdownFile({
      repoRoot: root,
      source,
      title: "研究 GitHub 同步",
      description: "中文文件名应该保持人工可读。"
    });

    assert.equal(created.sourcePath, "findwork/plan-new-project.md");
    assert.equal(duplicate.sourcePath, "findwork/plan-new-project-2.md");
    assert.equal(chineseTitle.sourcePath, "findwork/研究-github-同步.md");

    const content = await readFile(path.join(root, created.sourcePath), "utf8");
    const parsed = matter(content);
    assert.equal(parsed.data.title, "Plan New Project");
    assert.equal(parsed.data.type, "todo");
    assert.equal(parsed.data.status, "active");
    assert.equal(parsed.data.section, "work");
    assert.deepEqual(parsed.data.tags, ["planning"]);
    assert.match(parsed.content, /# Plan New Project/);
    assert.match(parsed.content, /Draft outline/);

    assert.equal(created.imported.rootItem.title, "Plan New Project");
    assert.equal(created.imported.rootItem.sourceLink?.sourcePath, created.sourcePath);
    assert.equal(created.imported.childItems.length, 1);
    assert.equal(chineseTitle.imported.rootItem.title, "研究 GitHub 同步");
    assert.equal(chineseTitle.imported.rootItem.sourceLink?.sourcePath, "findwork/研究-github-同步.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
