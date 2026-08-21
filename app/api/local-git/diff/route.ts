import path from "node:path";
import { getLocalGitDiff, localGitDiffRequestSchema } from "../../../../src/index.js";
import { jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = localGitDiffRequestSchema.parse({
      path: url.searchParams.get("path") ?? undefined
    });
    const repoRoot = path.join(process.cwd(), ".tmp", "local-git-repo");
    const diff = await getLocalGitDiff({
      repoRoot,
      path: query.path
    });

    return jsonOk(diff);
  } catch (error) {
    return jsonError(error);
  }
}
