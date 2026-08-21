import path from "node:path";
import {
  writeBackLocalHumanFileFrontmatter,
  writebackRequestSchema
} from "../../../../src/index.js";
import { jsonError, jsonOk } from "../../github/_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = writebackRequestSchema.parse(await request.json());
    const repoRoot = path.join(process.cwd(), ".tmp", "local-git-repo");
    await writeBackLocalHumanFileFrontmatter({
      repoRoot,
      sourcePath: body.sourcePath,
      patch: body.patch
    });

    return jsonOk({
      sourcePath: body.sourcePath,
      writeBack: "frontmatter-only",
      ok: true
    });
  } catch (error) {
    return jsonError(error);
  }
}
