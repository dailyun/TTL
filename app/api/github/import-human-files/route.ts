import { humanSourceSchema, importGitHubHumanSource } from "../../../../src/index.js";
import { defaultHumanSource, githubClientFromEnv, jsonError, jsonOk } from "../_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { source?: unknown };
    const source = body.source ? humanSourceSchema.parse(body.source) : defaultHumanSource();
    const imported = await importGitHubHumanSource(githubClientFromEnv(), source);
    const items = imported.flatMap((entry) => [entry.rootItem, ...entry.childItems]);

    return jsonOk({
      source,
      fileCount: imported.length,
      itemCount: items.length,
      items
    });
  } catch (error) {
    return jsonError(error);
  }
}
