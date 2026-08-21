import assert from "node:assert/strict";
import test from "node:test";
import {
  getReverseTodoPhase,
  isOpenReverseTodo,
  validateReverseTodoSchedule
} from "../src/domain/reverse-todo.js";
import type { Item } from "../src/domain/types.js";

const baseItem: Item = {
  id: "avoid-1",
  type: "avoid",
  title: "晚上不刷短视频",
  description: "",
  sectionId: "life",
  status: "active",
  tags: [],
  startAt: "2026-07-14T10:00:00.000Z",
  endAt: "2026-07-15T10:00:00.000Z",
  source: "local",
  createdAt: "2026-07-14T09:00:00.000Z",
  updatedAt: "2026-07-14T09:00:00.000Z"
};

test("classifies a reverse todo across its decision period", () => {
  assert.equal(getReverseTodoPhase(baseItem, new Date("2026-07-14T09:59:59.000Z")), "upcoming");
  assert.equal(getReverseTodoPhase(baseItem, new Date("2026-07-14T10:00:00.000Z")), "active");
  assert.equal(getReverseTodoPhase(baseItem, new Date("2026-07-15T10:00:00.000Z")), "expired");
});

test("requires a valid start and end for a reverse todo period", () => {
  assert.equal(getReverseTodoPhase({ ...baseItem, endAt: undefined }), "unscheduled");
  assert.equal(getReverseTodoPhase({ ...baseItem, endAt: baseItem.startAt }), "invalid");
  assert.equal(getReverseTodoPhase({ ...baseItem, type: "todo" }), "unscheduled");
  assert.match(validateReverseTodoSchedule({ ...baseItem, endAt: undefined }) ?? "", /开始和结束时间/);
  assert.match(validateReverseTodoSchedule({ ...baseItem, endAt: baseItem.startAt }) ?? "", /必须晚于/);
  assert.equal(validateReverseTodoSchedule(baseItem), null);
});

test("open reverse todos exclude completed and abandoned decisions", () => {
  assert.equal(isOpenReverseTodo(baseItem), true);
  assert.equal(isOpenReverseTodo({ ...baseItem, status: "done" }), false);
  assert.equal(isOpenReverseTodo({ ...baseItem, status: "abandoned" }), false);
});
