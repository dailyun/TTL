import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { GitHubContentsClient } from "../src/github-human-files/github-client.js";
import { validateSnapshot } from "../src/local-db/db.js";
import { importSnapshot } from "../src/execution/service.js";
import { checkInStorePath, withCheckInState } from "../src/check-ins/store.js";

if (!process.env.TODOTODOLIST_STATE_PATH) throw new Error("TODOTODOLIST_STATE_PATH is required");
const file = process.argv[2];
let raw: string;
if (file && file !== "--github") raw = await fs.readFile(file, "utf8");
else {
  const config = { token: process.env.GITHUB_TOKEN!, owner: process.env.GITHUB_OWNER!, repo: process.env.GITHUB_REPO!, branch: process.env.GITHUB_BRANCH || "main" };
  if (!config.token || !config.owner || !config.repo) throw new Error("GitHub source is not configured");
  raw = (await new GitHubContentsClient(config).readFile(process.env.GITHUB_SNAPSHOT_PATH || "todotodolist/snapshot.json")).content;
}
const snapshot = validateSnapshot(JSON.parse(raw));
const hash = createHash("sha256").update(raw).digest("hex");
const archive = path.join(path.dirname(checkInStorePath()), "migration-archive");
await fs.mkdir(archive, { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(archive, `${hash}.json`), raw, { mode: 0o600 });
const result = await importSnapshot(snapshot, file || "github-snapshot");
const report = { sourceSha256: hash, importedItems: snapshot.items.length, currentItems: result.snapshot.items.length,
  deleted: snapshot.items.filter(i => i.deletedAt).length, attachments: snapshot.items.reduce((n, i) => n + (i.attachments?.length ?? 0), 0),
  missingIds: snapshot.items.filter(i => !result.snapshot.items.some(r => r.id === i.id)).map(i => i.id),
  changedItems: snapshot.items.filter(i => JSON.stringify(result.snapshot.items.find(r => r.id === i.id)) !== JSON.stringify(i)).map(i => i.id),
  conflicts: result.conflicts.length, checkIns: await withCheckInState(s => s.checkIns.length, false) };
await fs.writeFile(path.join(archive, `${hash}-report.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
if (report.missingIds.length) process.exitCode = 1;
