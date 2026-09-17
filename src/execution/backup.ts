import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { createHash } from "node:crypto";
import { checkInStorePath, withCheckInState } from "../check-ins/store.js";
import { execution, localDate } from "./core.js";
export async function backupDaily(now = new Date()) {
  const root = path.dirname(checkInStorePath());
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path.join(root, "daily-backup"), { realpath: false, stale: 30_000, retries: { retries: 30, minTimeout: 30, maxTimeout: 250 } });
  try {
  const date = localDate(now);
  const content = await withCheckInState(state => {
    const previous = execution(state).worker.lastBackupAt;
    if (previous && localDate(new Date(previous)) === date) return null;
    return JSON.stringify(state);
  }, false);
  if (content === null) return;
  const directory = path.join(path.dirname(checkInStorePath()), "backups", date);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const files: Record<string, string> = { "execution.json": content };
  for (const [name, configured] of [["google-calendar-token.json", process.env.GOOGLE_REFRESH_TOKEN_PATH], ["google-calendar-sync-state.json", process.env.GOOGLE_CALENDAR_SYNC_STATE_PATH]]) {
    if (!configured) continue;
    try { const raw = await fs.readFile(configured, "utf8"); JSON.parse(raw); files[name!] = raw; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const manifest: Record<string, string> = {};
  for (const [name, raw] of Object.entries(files)) {
    const temporary = path.join(directory, `${name}.tmp`), filename = path.join(directory, name);
    const handle = await fs.open(temporary, "w", 0o600);
    try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, filename);
    manifest[name] = createHash("sha256").update(raw).digest("hex");
  }
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await withCheckInState(state => { execution(state).worker.lastBackupAt = now.toISOString(); execution(state).worker.backupError = undefined; });
  } finally { await release(); }
}
