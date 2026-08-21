import path from "node:path";
import { getLocalGitStatus } from "../../../../src/index.js";
import { jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function GET() {
  try {
    const repoRoot = path.join(process.cwd(), ".tmp", "local-git-repo");
    const status = await getLocalGitStatus(repoRoot);
    return jsonOk(status);
  } catch (error) {
    return jsonError(error);
  }
}
