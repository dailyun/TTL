import { githubClientFromEnv } from "../../../github/_shared.js";
import { assertExternalApiAuthorized } from "../../../../../src/external-api/auth.js";
import { externalApiError, externalApiJson, externalApiOptions } from "../../../../../src/external-api/http.js";
import {
  deleteExternalItem,
  findExternalItem,
  itemEtag,
  updateExternalItem
} from "../../../../../src/external-api/items.js";
import {
  externalItemIdSchema,
  externalItemPatchSchema
} from "../../../../../src/external-api/schema.js";
import {
  createEmptySnapshot,
  mutateExternalApiSnapshot,
  readExternalApiSnapshot
} from "../../../../../src/external-api/snapshot-store.js";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertExternalApiAuthorized(request);
    const id = externalItemIdSchema.parse((await context.params).id);
    const includeDeleted = new URL(request.url).searchParams.get("includeDeleted") === "true";
    const stored = await readExternalApiSnapshot(githubClientFromEnv());
    const item = findExternalItem(stored?.snapshot ?? createEmptySnapshot(), id, includeDeleted);

    return externalApiJson(
      request,
      { data: item, meta: { snapshotSha: stored?.sha ?? null } },
      { headers: { etag: itemEtag(item) } }
    );
  } catch (error) {
    return externalApiError(request, error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertExternalApiAuthorized(request);
    const id = externalItemIdSchema.parse((await context.params).id);
    const patch = externalItemPatchSchema.parse(await request.json());
    const mutation = await mutateExternalApiSnapshot({
      client: githubClientFromEnv(),
      message: `Update TodoTodoList item ${id}`,
      mutate(snapshot) {
        const result = updateExternalItem(snapshot, id, patch, request.headers.get("if-match") ?? undefined);
        return { result: result.item, snapshot: result.snapshot };
      }
    });

    return externalApiJson(
      request,
      {
        data: mutation.result,
        meta: { snapshotSha: mutation.sha ?? null, writeAttempts: mutation.writeAttempts }
      },
      { headers: { etag: itemEtag(mutation.result) } }
    );
  } catch (error) {
    return externalApiError(request, error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertExternalApiAuthorized(request);
    const id = externalItemIdSchema.parse((await context.params).id);
    const mutation = await mutateExternalApiSnapshot({
      client: githubClientFromEnv(),
      message: `Delete TodoTodoList item ${id}`,
      mutate(snapshot) {
        const result = deleteExternalItem(snapshot, id, request.headers.get("if-match") ?? undefined);
        return { result: result.item, snapshot: result.snapshot };
      }
    });

    return externalApiJson(
      request,
      {
        data: mutation.result,
        meta: { snapshotSha: mutation.sha ?? null, writeAttempts: mutation.writeAttempts }
      },
      { headers: { etag: itemEtag(mutation.result) } }
    );
  } catch (error) {
    return externalApiError(request, error);
  }
}

export function OPTIONS(request: Request) {
  return externalApiOptions(request);
}
