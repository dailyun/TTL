import assert from "node:assert/strict";
import test from "node:test";
import { parsePorcelainStatus, validateRepoRelativePath } from "../src/local-git/repo.js";

test("parses porcelain status into readable changed files", () => {
  const files = parsePorcelainStatus(
    [
      " M findwork/product-plan.md",
      "A  findwork/new-note.md",
      "?? findwork/draft.md",
      "R  findwork/old.md -> findwork/new.md"
    ].join("\n")
  );

  assert.deepEqual(files, [
    {
      path: "findwork/product-plan.md",
      indexStatus: " ",
      worktreeStatus: "M",
      label: "修改"
    },
    {
      path: "findwork/new-note.md",
      indexStatus: "A",
      worktreeStatus: " ",
      label: "新增"
    },
    {
      path: "findwork/draft.md",
      indexStatus: "?",
      worktreeStatus: "?",
      label: "未跟踪"
    },
    {
      path: "findwork/new.md",
      indexStatus: "R",
      worktreeStatus: " ",
      label: "重命名"
    }
  ]);
});

test("validates repo-relative diff paths", () => {
  assert.equal(validateRepoRelativePath("findwork/product-plan.md"), "findwork/product-plan.md");
  assert.equal(validateRepoRelativePath("findwork\\product-plan.md"), "findwork/product-plan.md");

  assert.throws(() => validateRepoRelativePath("../secret.md"), /Invalid repo-relative path/);
  assert.throws(() => validateRepoRelativePath("/tmp/secret.md"), /Invalid repo-relative path/);
  assert.throws(() => validateRepoRelativePath("findwork//note.md"), /Invalid repo-relative path/);
});
