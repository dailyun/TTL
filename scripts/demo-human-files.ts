import path from "node:path";
import { importLocalHumanSources, readSourcesFile } from "../src/github-human-files/local-source.js";

const repoRoot = path.resolve(process.cwd(), "examples/github-repo");
const sourcesPath = path.join(repoRoot, "todotodolist", "sources.json");

const sources = await readSourcesFile(sourcesPath);
const imported = await importLocalHumanSources(repoRoot, sources);

const items = imported.flatMap((entry) => [entry.rootItem, ...entry.childItems]);

console.log(
  JSON.stringify(
    {
      sourceCount: sources.sources.length,
      fileCount: imported.length,
      itemCount: items.length,
      items
    },
    null,
    2
  )
);
