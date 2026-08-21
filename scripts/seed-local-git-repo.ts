import path from "node:path";
import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const target = path.join(root, ".tmp", "local-git-repo");

await rm(target, { recursive: true, force: true });
await mkdir(path.join(target, "todotodolist"), { recursive: true });
await mkdir(path.join(target, "findwork", "ideas"), { recursive: true });

await cp(
  path.join(root, "examples", "github-repo", "todotodolist", "sources.json"),
  path.join(target, "todotodolist", "sources.json")
);
await cp(
  path.join(root, "examples", "github-repo", "findwork", "product-plan.md"),
  path.join(target, "findwork", "product-plan.md")
);
await cp(
  path.join(root, "examples", "github-repo", "findwork", "ideas", "calendar-sync.md"),
  path.join(target, "findwork", "ideas", "calendar-sync.md")
);

await execFileAsync("git", ["init", "--initial-branch=main", target]);
await execFileAsync("git", ["-C", target, "add", "."]);
await execFileAsync("git", [
  "-C",
  target,
  "-c",
  "user.name=TodoTodoList Demo",
  "-c",
  "user.email=demo@todotodolist.local",
  "commit",
  "-m",
  "Seed findwork human files"
]);

const { stdout } = await execFileAsync("git", [
  "-C",
  target,
  "log",
  "--oneline",
  "--decorate",
  "--stat",
  "-1"
]);

console.log(`Seeded local git repo at ${target}\n${stdout}`);
