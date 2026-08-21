import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalHumanFileRequestSchema,
  frontmatterSchema,
  itemTypeSchema
} from "../src/github-human-files/schema.js";

test("human-readable sources accept the reverse-todo item type", () => {
  assert.equal(itemTypeSchema.parse("avoid"), "avoid");
  assert.equal(frontmatterSchema.parse({ type: "avoid" }).type, "avoid");

  const request = createLocalHumanFileRequestSchema.parse({
    title: "本周不临时接新需求",
    type: "avoid",
    status: "active",
    startAt: "2026-07-14T10:00:00.000Z",
    endAt: "2026-07-18T10:00:00.000Z"
  });
  assert.equal(request.type, "avoid");
  assert.equal(request.endAt, "2026-07-18T10:00:00.000Z");
  assert.equal(itemTypeSchema.parse("note"), "note");
  assert.equal(frontmatterSchema.parse({ type: "note" }).type, "note");
});
