import {
  writeBackGitHubHumanFileFrontmatter,
  writebackRequestSchema
} from "../../../../src/index.js";
import { githubClientFromEnv, jsonError, jsonOk } from "../_shared.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = writebackRequestSchema.parse(await request.json());

    const result = await writeBackGitHubHumanFileFrontmatter({
      client: githubClientFromEnv(),
      sourcePath: body.sourcePath,
      patch: body.patch,
      expectedSha: body.expectedSha
    });

    return jsonOk({
      sourcePath: body.sourcePath,
      sha: result.sha,
      writeBack: "frontmatter-only",
      ok: true
    });
  } catch (error) {
    return jsonError(error);
  }
}
