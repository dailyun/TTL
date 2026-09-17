import { setTimeout as delay } from "node:timers/promises";
const base = new URL(process.env.TODOTODOLIST_REMINDER_API_URL || "http://127.0.0.1:3000");
if (base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) throw new Error("Reminder API must use HTTPS or local loopback HTTP.");
const token = process.env.TODOTODOLIST_API_TOKEN;
if (!token) throw new Error("Set TODOTODOLIST_API_TOKEN for the reminder worker.");
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => controller.abort());
const once = process.argv.includes("--once");
do {
  try {
    const response = await fetch(new URL("/api/v1/notifications/dispatch", base), {
      method: "POST", headers: { authorization: `Bearer ${token}` }, redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
    });
    if (!response.ok) throw new Error(`Reminder endpoint returned HTTP ${response.status}`);
    const result = await response.json();
    if (result.processed || once) console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  } catch (error) {
    if (!controller.signal.aborted) console.error(`Reminder check failed: ${error.name === "TimeoutError" ? "timeout" : error.message}`);
    if (once) process.exitCode = 1;
  }
  if (once || controller.signal.aborted) break;
  try { await delay(10_000, undefined, { signal: controller.signal }); } catch { break; }
} while (!controller.signal.aborted);
