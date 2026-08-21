import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHumanSourceReconciliation,
  filterItemsForImport,
  mergeSnapshots,
  validateSnapshot
} from "../src/local-db/db.js";
import type { Item } from "../src/domain/types.js";

const validSnapshot = {
  app: "todotodolist",
  version: 1,
  exportedAt: "2026-07-07T10:00:00.000Z",
  items: [
    {
      id: "item-1",
      type: "todo",
      title: "恢复测试",
      description: "",
      sectionId: "inbox",
      status: "active",
      tags: ["backup"],
      source: "local",
      createdAt: "2026-07-07T09:00:00.000Z",
      updatedAt: "2026-07-07T09:30:00.000Z"
    }
  ],
  sections: [
    {
      id: "inbox",
      name: "收集箱",
      color: "#6b7280",
      sortOrder: 0,
      isInbox: true,
      createdAt: "2026-07-07T09:00:00.000Z",
      updatedAt: "2026-07-07T09:00:00.000Z"
    }
  ],
  settings: [
    {
      id: "default",
      defaultSectionId: "inbox",
      showDoneInCalendar: false,
      showAbandonedInBoard: false,
      autoPullGitHubSnapshotOnStart: false,
      autoPushGitHubSnapshotOnChange: false,
      createdAt: "2026-07-07T09:00:00.000Z",
      updatedAt: "2026-07-07T09:00:00.000Z"
    }
  ]
};

test("validates a TodoTodoList snapshot and normalizes missing sync metadata", () => {
  const snapshot = validateSnapshot(validSnapshot);
  assert.equal(snapshot.app, "todotodolist");
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(snapshot.syncMetadata, []);
});

test("accepts time-boxed reverse todos in snapshots", () => {
  const snapshot = validateSnapshot({
    ...validSnapshot,
    items: [
      {
        ...validSnapshot.items[0],
        id: "avoid-social-media",
        type: "avoid",
        title: "今晚不刷短视频",
        startAt: "2026-07-14T12:00:00.000Z",
        endAt: "2026-07-15T00:00:00.000Z"
      }
    ]
  });

  assert.equal(snapshot.items[0]?.type, "avoid");
  assert.equal(snapshot.items[0]?.endAt, "2026-07-15T00:00:00.000Z");
});

test("accepts captured notes with screenshot attachments in snapshots", () => {
  const snapshot = validateSnapshot({
    ...validSnapshot,
    items: [
      {
        ...validSnapshot.items[0],
        id: "note-fragment",
        type: "note",
        title: "页面灵感",
        description: "先把截图和一句话收下来。",
        attachments: [
          {
            id: "attachment-1",
            name: "idea.png",
            mimeType: "image/png",
            size: 68,
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            createdAt: "2026-07-15T01:00:00.000Z"
          }
        ]
      }
    ]
  });

  assert.equal(snapshot.items[0]?.type, "note");
  assert.equal(snapshot.items[0]?.attachments?.[0]?.name, "idea.png");
});

test("rejects malformed screenshot attachments in snapshots", () => {
  assert.throws(
    () => validateSnapshot({
      ...validSnapshot,
      items: [
        {
          ...validSnapshot.items[0],
          type: "note",
          attachments: [{ id: "bad", name: "bad.txt", mimeType: "text/plain", size: 2, dataUrl: "hi", createdAt: "now" }]
        }
      ]
    }),
    /必须是支持的图片附件/
  );
});

test("normalizes old snapshot settings without GitHub snapshot automation preferences", () => {
  const oldSnapshot = {
    ...validSnapshot,
    settings: [
      {
        id: "default",
        defaultSectionId: "inbox",
        showDoneInCalendar: false,
        showAbandonedInBoard: false,
        createdAt: "2026-07-07T09:00:00.000Z",
        updatedAt: "2026-07-07T09:00:00.000Z"
      }
    ]
  };

  const snapshot = validateSnapshot(oldSnapshot);
  assert.equal(snapshot.settings[0]?.autoPullGitHubSnapshotOnStart, false);
  assert.equal(snapshot.settings[0]?.autoPushGitHubSnapshotOnChange, false);
});

test("rejects snapshots from another app or unsupported versions", () => {
  assert.throws(
    () => validateSnapshot({ ...validSnapshot, app: "other" }),
    /不是 TodoTodoList 快照/
  );
  assert.throws(
    () => validateSnapshot({ ...validSnapshot, version: 2 }),
    /暂不支持该快照版本/
  );
});

test("rejects malformed snapshot item fields before import", () => {
  assert.throws(
    () =>
      validateSnapshot({
        ...validSnapshot,
        items: [{ ...validSnapshot.items[0], status: "later" }]
      }),
    /status 无效/
  );
});

test("filters imported items by updatedAt before writing to local cache", () => {
  const existingNewer = item({
    id: "same-id",
    title: "本地较新",
    updatedAt: "2026-07-07T11:00:00.000Z"
  });
  const incomingOlder = item({
    id: "same-id",
    title: "远端较旧",
    updatedAt: "2026-07-07T10:00:00.000Z"
  });
  const existingSameTime = item({
    id: "same-time",
    title: "本地同时间",
    updatedAt: "2026-07-07T12:00:00.000Z"
  });
  const incomingSameTime = item({
    id: "same-time",
    title: "远端同时间",
    updatedAt: "2026-07-07T12:00:00.000Z"
  });
  const incomingNew = item({
    id: "new-id",
    title: "远端新事项",
    updatedAt: "2026-07-07T09:00:00.000Z"
  });

  assert.deepEqual(
    filterItemsForImport(
      [incomingOlder, incomingSameTime, incomingNew],
      [existingNewer, existingSameTime, undefined]
    ),
    [incomingSameTime, incomingNew]
  );
});

test("merges snapshots by updatedAt without dropping remote-only records", () => {
  const existing = validateSnapshot({
    ...validSnapshot,
    exportedAt: "2026-07-07T10:00:00.000Z",
    items: [
      item({
        id: "same-id",
        title: "远端较新",
        updatedAt: "2026-07-07T12:00:00.000Z"
      }),
      item({
        id: "remote-only",
        title: "只在远端",
        updatedAt: "2026-07-07T09:00:00.000Z"
      })
    ]
  });
  const incoming = validateSnapshot({
    ...validSnapshot,
    exportedAt: "2026-07-07T11:00:00.000Z",
    items: [
      item({
        id: "same-id",
        title: "本地较旧",
        updatedAt: "2026-07-07T11:00:00.000Z"
      }),
      item({
        id: "local-only",
        title: "只在本地",
        updatedAt: "2026-07-07T13:00:00.000Z"
      })
    ]
  });

  const merged = mergeSnapshots(existing, incoming);
  const titles = new Map(merged.items.map((mergedItem) => [mergedItem.id, mergedItem.title]));
  assert.equal(titles.get("same-id"), "远端较新");
  assert.equal(titles.get("remote-only"), "只在远端");
  assert.equal(titles.get("local-only"), "只在本地");
  assert.equal(merged.exportedAt, "2026-07-07T11:00:00.000Z");
});

test("reconciles missing human-source records as soft deletes", () => {
  const existingRoot = humanItem("root", "findwork/note.md");
  const existingCheckbox = {
    ...humanItem("checkbox", "findwork/note.md"),
    parentId: existingRoot.id
  };
  const incomingRoot = {
    ...existingRoot,
    title: "Updated root",
    updatedAt: "2026-07-07T11:00:00.000Z"
  };
  const now = "2026-07-07T12:00:00.000Z";

  const result = buildHumanSourceReconciliation(
    [existingRoot, existingCheckbox],
    [incomingRoot],
    now
  );

  assert.equal(result.deletedCount, 1);
  assert.equal(result.records.find((record) => record.id === "root")?.title, "Updated root");
  assert.equal(result.records.find((record) => record.id === "checkbox")?.deletedAt, now);
});

function item(input: { id: string; title: string; updatedAt: string }): Item {
  return {
    id: input.id,
    type: "todo",
    title: input.title,
    description: "",
    sectionId: "inbox",
    status: "active",
    tags: [],
    source: "local",
    createdAt: "2026-07-07T09:00:00.000Z",
    updatedAt: input.updatedAt
  };
}

function humanItem(id: string, sourcePath: string): Item {
  return {
    ...item({ id, title: id, updatedAt: "2026-07-07T10:00:00.000Z" }),
    source: "github",
    sourceLink: {
      provider: "github",
      sourceId: "findwork",
      sourcePath,
      writeBack: "frontmatter-only"
    }
  };
}
