import { GitHubContentsClient, importGitHubHumanSource } from "../src/index.js";
import type { HumanSource } from "../src/index.js";

const token = requiredEnv("GITHUB_TOKEN");
const owner = requiredEnv("GITHUB_OWNER");
const repo = requiredEnv("GITHUB_REPO");
const branch = process.env.GITHUB_BRANCH ?? "main";

const source: HumanSource = {
  id: process.env.HUMAN_SOURCE_ID ?? "findwork",
  label: process.env.HUMAN_SOURCE_ID ?? "findwork",
  path: process.env.HUMAN_SOURCE_PATH ?? "findwork/**/*.md",
  mode: "read-write",
  defaultSectionId: process.env.HUMAN_SOURCE_SECTION ?? "work",
  defaultType: "idea",
  defaultStatus: "wanted",
  importCheckboxes: true,
  writeBack: "frontmatter-only"
};

const client = new GitHubContentsClient({
  owner,
  repo,
  branch,
  token
});

const imported = await importGitHubHumanSource(client, source);
const items = imported.flatMap((entry) => [entry.rootItem, ...entry.childItems]);

console.log(
  JSON.stringify(
    {
      repo: `${owner}/${repo}`,
      branch,
      source,
      fileCount: imported.length,
      itemCount: items.length,
      items
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
