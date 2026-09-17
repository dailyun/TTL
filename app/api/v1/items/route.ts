import { githubClientFromEnv } from "../../github/_shared.js";
import { assertExternalApiAuthorized } from "../../../../src/external-api/auth.js";
import { externalApiError, externalApiJson, externalApiOptions } from "../../../../src/external-api/http.js";
import { createExternalItem, itemEtag, listExternalItems } from "../../../../src/external-api/items.js";
import {
  externalItemCreateSchema,
  externalItemListQuerySchema
} from "../../../../src/external-api/schema.js";
import {
  createEmptySnapshot,
  mutateExternalApiSnapshot,
  readExternalApiSnapshot
} from "../../../../src/external-api/snapshot-store.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    const url = new URL(request.url);
    const query = externalItemListQuerySchema.parse(Object.fromEntries(url.searchParams));
    const stored = await readExternalApiSnapshot((process.env.TODOTODOLIST_STATE_PATH ? undefined : githubClientFromEnv()));
    const result = listExternalItems(stored?.snapshot ?? createEmptySnapshot(), query);

    return externalApiJson(request, {
      data: result.items,
      meta: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        snapshotSha: stored?.sha ?? null
      }
    });
  } catch (error) {
    return externalApiError(request, error);
  }
}

export async function POST(request: Request) {
  try {
    assertExternalApiAuthorized(request);
    const input = externalItemCreateSchema.parse(await request.json());
    const id = input.id ?? crypto.randomUUID();
    const mutation = await mutateExternalApiSnapshot({
      client: (process.env.TODOTODOLIST_STATE_PATH ? undefined : githubClientFromEnv()),
      message: `Create TodoTodoList item ${id}`,
      mutate(snapshot) {
        const result = createExternalItem(snapshot, input, id);
        return { result: result.item, snapshot: result.snapshot };
      }
    });

    return externalApiJson(
      request,
      {
        data: mutation.result,
        meta: { snapshotSha: mutation.sha ?? null, writeAttempts: mutation.writeAttempts }
      },
      {
        status: 201,
        headers: {
          etag: itemEtag(mutation.result),
          location: `/api/v1/items/${encodeURIComponent(mutation.result.id)}`
        }
      }
    );
  } catch (error) {
    return externalApiError(request, error);
  }
}

export function OPTIONS(request: Request) {
  return externalApiOptions(request);
}
