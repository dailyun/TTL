import path from "node:path";
import {
  commitLocalGitChanges,
  localGitCommitRequestSchema
} from "../../../../src/index.js";
import { jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = localGitCommitRequestSchema.parse(await request.json().catch(() => ({})));
    const repoRoot = path.join(process.cwd(), ".tmp", "local-git-repo");
    const result = await commitLocalGitChanges({
      repoRoot,
      message: body.message
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
