import { GitHubContentsClient } from "./github-client.js";
import { importHumanMarkdownFile } from "./importer.js";
import { writeBackFrontmatterOnly, type FrontmatterWritebackPatch } from "./writeback.js";
import type { HumanSource, ImportedHumanFile } from "../domain/types.js";

export async function importGitHubHumanSource(
  client: GitHubContentsClient,
  source: HumanSource
): Promise<ImportedHumanFile[]> {
  const paths = await client.listFiles(source.path);
  const files = await Promise.all(paths.map((sourcePath) => client.readFile(sourcePath)));

  return files.map((file) =>
    importHumanMarkdownFile({
      source,
      sourcePath: file.path,
      content: file.content,
      sourceSha: file.sha
    })
  );
}

export async function writeBackGitHubHumanFileFrontmatter(params: {
  client: GitHubContentsClient;
  sourcePath: string;
  patch: FrontmatterWritebackPatch;
  expectedSha?: string;
  message?: string;
}): Promise<{ sha?: string }> {
  const current = await params.client.readFile(params.sourcePath);

  if (params.expectedSha && current.sha !== params.expectedSha) {
    throw new Error(
      `Cannot write back ${params.sourcePath}: expected sha ${params.expectedSha}, got ${current.sha}`
    );
  }

  const updated = writeBackFrontmatterOnly(current.content, params.patch);

  return params.client.writeFile({
    filePath: params.sourcePath,
    content: updated,
    sha: current.sha,
    message: params.message ?? `Update TodoTodoList metadata for ${params.sourcePath}`
  });
}
