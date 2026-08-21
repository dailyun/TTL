import { githubClientFromEnv } from "../../github/_shared.js";
import { assertExternalApiAuthorized } from "../../../../src/external-api/auth.js";
import { externalApiError, externalApiJson, externalApiOptions } from "../../../../src/external-api/http.js";
import { createEmptySnapshot, readExternalApiSnapshot } from "../../../../src/external-api/snapshot-store.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    const stored = await readExternalApiSnapshot(githubClientFromEnv());
    const snapshot = stored?.snapshot ?? createEmptySnapshot();
    const sections = snapshot.sections
      .filter((section) => !section.archivedAt)
      .sort((left, right) => left.sortOrder - right.sortOrder);

    return externalApiJson(request, {
      data: sections,
      meta: { total: sections.length, snapshotSha: stored?.sha ?? null }
    });
  } catch (error) {
    return externalApiError(request, error);
  }
}

export function OPTIONS(request: Request) {
  return externalApiOptions(request);
}
