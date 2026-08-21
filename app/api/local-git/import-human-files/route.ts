import path from "node:path";
import {
  humanSourceSchema,
  importLocalHumanSource,
  importLocalHumanSources,
  readSourcesFile
} from "../../../../src/index.js";
import { defaultHumanSource, jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { source?: unknown };
    const repoRoot = path.join(process.cwd(), ".tmp", "local-git-repo");
    const sourcesPath = path.join(repoRoot, "todotodolist", "sources.json");

    if (!body.source) {
      const sources = await readSourcesFile(sourcesPath);
      const imported = await importLocalHumanSources(repoRoot, sources);
      const items = imported.flatMap((entry) => [entry.rootItem, ...entry.childItems]);

      return jsonOk({
        sources,
        repoRoot,
        fileCount: imported.length,
        itemCount: items.length,
        items
      });
    }

    const source = body.source ? humanSourceSchema.parse(body.source) : defaultHumanSource();
    const imported = await importLocalHumanSource(repoRoot, source);
    const items = imported.flatMap((entry) => [entry.rootItem, ...entry.childItems]);

    return jsonOk({
      source,
      repoRoot,
      fileCount: imported.length,
      itemCount: items.length,
      items
    });
  } catch (error) {
    return jsonError(error);
  }
}
