import { runExecutionWorker } from "../src/execution/calendar.js";
import { setTimeout as delay } from "node:timers/promises";
import { backupDaily } from "../src/execution/backup.js";
import { withCheckInState } from "../src/check-ins/store.js";
import { execution } from "../src/execution/core.js";
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => controller.abort());
const once = process.argv.includes("--once");
do {
  try {
    const result = await runExecutionWorker();
    try { await backupDaily(); } catch { await withCheckInState(s => { execution(s).worker.backupError = "每日备份未成功，请检查磁盘与私密目录权限"; }); }
    if (once || result.calendarError) console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  }
  catch { console.error("Execution worker failed; persisted operations will retry."); if (once) process.exitCode = 1; }
  if (once || controller.signal.aborted) break;
  try { await delay(30_000, undefined, { signal: controller.signal }); } catch { break; }
} while (!controller.signal.aborted);
