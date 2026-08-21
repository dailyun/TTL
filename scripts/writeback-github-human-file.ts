import { GitHubContentsClient, writeBackGitHubHumanFileFrontmatter } from "../src/index.js";
import type { ItemStatus } from "../src/index.js";

const token = requiredEnv("GITHUB_TOKEN");
const owner = requiredEnv("GITHUB_OWNER");
const repo = requiredEnv("GITHUB_REPO");
const branch = process.env.GITHUB_BRANCH ?? "main";
const sourcePath = requiredEnv("HUMAN_WRITEBACK_PATH");
const status = (process.env.HUMAN_WRITEBACK_STATUS ?? "active") as ItemStatus;
const updatedAt = process.env.HUMAN_WRITEBACK_UPDATED_AT ?? new Date().toISOString();

const client = new GitHubContentsClient({
  owner,
  repo,
  branch,
  token
});

await writeBackGitHubHumanFileFrontmatter({
  client,
  sourcePath,
  patch: {
    status,
    updatedAt
  },
  message: `Update TodoTodoList metadata for ${sourcePath}`
});

console.log(
  JSON.stringify(
    {
      repo: `${owner}/${repo}`,
      branch,
      sourcePath,
      status,
      updatedAt,
      writeBack: "frontmatter-only"
    },
    null,
    2
  )
);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
