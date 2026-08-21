import path from "node:path";
import {
  createLocalHumanFileRequestSchema,
  createLocalHumanMarkdownFile,
  readSourcesFile
} from "../../../../src/index.js";
import { jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = createLocalHumanFileRequestSchema.parse(await request.json());
    const repoRoot = path.join(process.cwd(), ".tmp", "local-git-repo");
    const sources = await readSourcesFile(path.join(repoRoot, "todotodolist", "sources.json"));
    const source = body.sourceId
      ? sources.sources.find((entry) => entry.id === body.sourceId)
      : sources.sources.find((entry) => entry.mode === "read-write");

    if (!source) {
      throw new Error(body.sourceId ? `Unknown source: ${body.sourceId}` : "No writable source configured");
    }

    const created = await createLocalHumanMarkdownFile({
      repoRoot,
      source,
      title: body.title,
      type: body.type,
      status: body.status,
      sectionId: body.sectionId,
      tags: body.tags,
      description: body.description,
      startAt: body.startAt,
      endAt: body.endAt,
      allDay: body.allDay
    });
    const items = [created.imported.rootItem, ...created.imported.childItems];

    return jsonOk({
      source,
      sourcePath: created.sourcePath,
      itemCount: items.length,
      items
    });
  } catch (error) {
    return jsonError(error);
  }
}
