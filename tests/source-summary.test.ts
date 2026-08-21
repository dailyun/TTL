import assert from "node:assert/strict";
import test from "node:test";
import type { Item } from "../src/domain/types.js";
import { summarizeSourceFiles } from "../src/sync/source-summary.js";

test("summarizes imported github items by source path", () => {
  const items: Item[] = [
    githubItem({
      id: "root",
      title: "Plan",
      sourcePath: "findwork/product-plan.md",
      status: "wanted",
      writeBack: "frontmatter-only",
      updatedAt: "2026-07-07T10:00:00.000Z"
    }),
    githubItem({
      id: "child-1",
      title: "Research",
      sourcePath: "findwork/product-plan.md",
      status: "active",
      writeBack: "none",
      parentId: "root",
      updatedAt: "2026-07-07T11:00:00.000Z"
    }),
    githubItem({
      id: "child-2",
      title: "Done",
      sourcePath: "findwork/product-plan.md",
      status: "done",
      writeBack: "none",
      parentId: "root",
      updatedAt: "2026-07-07T09:00:00.000Z"
    }),
    githubItem({
      id: "calendar",
      title: "Calendar",
      sourcePath: "findwork/ideas/calendar-sync.md",
      status: "paused",
      writeBack: "frontmatter-only",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }),
    {
      ...githubItem({
        id: "deleted",
        title: "Deleted",
        sourcePath: "findwork/deleted.md",
        status: "wanted",
        writeBack: "frontmatter-only",
        updatedAt: "2026-07-07T12:00:00.000Z"
      }),
      deletedAt: "2026-07-07T12:30:00.000Z"
    }
  ];

  const summaries = summarizeSourceFiles(items);

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].sourcePath, "findwork/product-plan.md");
  assert.equal(summaries[0].itemCount, 3);
  assert.equal(summaries[0].rootItemCount, 1);
  assert.equal(summaries[0].childItemCount, 2);
  assert.equal(summaries[0].writableItemCount, 1);
  assert.equal(summaries[0].latestUpdatedAt, "2026-07-07T11:00:00.000Z");
  assert.deepEqual(summaries[0].statusCounts, {
    wanted: 1,
    active: 1,
    paused: 0,
    abandoned: 0,
    done: 1
  });
});

function githubItem(input: {
  id: string;
  title: string;
  sourcePath: string;
  status: Item["status"];
  writeBack: "none" | "frontmatter-only" | "full-file";
  updatedAt: string;
  parentId?: string;
}): Item {
  return {
    id: input.id,
    title: input.title,
    type: input.parentId ? "todo" : "idea",
    description: "",
    sectionId: "work",
    status: input.status,
    tags: [],
    source: "github",
    sourceLink: {
      provider: "github",
      sourceId: "findwork",
      sourcePath: input.sourcePath,
      bodyHash: "body",
      frontmatterHash: input.parentId ? undefined : "frontmatter",
      writeBack: input.writeBack
    },
    parentId: input.parentId,
    createdAt: "2026-07-07T08:00:00.000Z",
    updatedAt: input.updatedAt
  };
}
