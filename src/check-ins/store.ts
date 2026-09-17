import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import type { CheckInState } from "./schema.js";

export function checkInStorePath(): string {
  if (process.env.VERCEL) throw new Error("Check-ins require a persistent Node/Docker volume; ephemeral serverless storage is unsupported.");
  if (process.env.NODE_ENV === "production" && !process.env.TODOTODOLIST_STATE_PATH && !process.env.TODOTODOLIST_CHECKIN_PATH) {
    throw new Error("Missing required environment variable: TODOTODOLIST_CHECKIN_PATH");
  }
  return path.resolve(/* turbopackIgnore: true */ process.env.TODOTODOLIST_STATE_PATH || process.env.TODOTODOLIST_CHECKIN_PATH || ".tmp/check-ins.json");
}

export async function withCheckInState<T>(task: (state: CheckInState) => T | Promise<T>, write = true): Promise<T> {
  const filename = checkInStorePath();
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const release = await lockfile.lock(filename, {
    realpath: false, stale: 30_000, update: 10_000,
    retries: { retries: 30, minTimeout: 30, maxTimeout: 250 }
  });
  try {
    let state: CheckInState;
    try {
      state = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ filename, "utf8")) as CheckInState;
      if (state.version !== 1 || !Number.isSafeInteger(state.sequence) || state.sequence < 0
        || ![state.checkIns, state.devices, state.deliveries, state.feedback].every(Array.isArray)) {
        throw new Error("Invalid check-in state; restore from a backup before continuing.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { version: 1, sequence: 0, checkIns: [], devices: [], deliveries: [], feedback: [] };
    }
    if (state.workspace && (state.workspace.version !== 1 || !Number.isSafeInteger(state.workspace.revision)
      || ![state.workspace.occurrences, state.workspace.jobs, state.workspace.conflicts, state.workspace.changes].every(Array.isArray)
      || !state.workspace.snapshot || !state.workspace.preferences)) throw new Error("Invalid execution state; restore from backup.");
    const result = await task(state);
    if (write) {
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        const file = await fs.open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(state, null, 2) + "\n"); await file.sync(); }
        finally { await file.close(); }
        await fs.rename(temporary, filename);
        const directory = await fs.open(path.dirname(filename), "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await fs.rm(temporary, { force: true }); }
    }
    return result;
  } finally { await release(); }
}
