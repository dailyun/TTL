import { externalApiJson, externalApiOptions } from "../../../../src/external-api/http.js";

export const runtime = "nodejs";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return externalApiJson(request, openApiDocument(origin));
}

export function OPTIONS(request: Request) {
  return externalApiOptions(request);
}

function openApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "TodoTodoList External API",
      version: "1.1.0",
      description: "Canonical server file stores items, occurrences, calendar jobs and owner feedback. GitHub snapshots remain optional imports/exports. See docs/execution-operations.md."
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/actions": {
        get: { operationId: "readExecutionWorkspace", summary: "Read canonical snapshot, occurrences, reviews, jobs and connection status", responses: { "200": jsonResponse({ type: "object" }), "401": errorResponse(), "503": errorResponse() } },
        post: { operationId: "publishSelectedAction", summary: "Publish an already selected action; durable steps reported separately", requestBody: jsonRequest({ $ref: "#/components/schemas/PublishAction" }), responses: { "200": jsonResponse({ type: "object" }), "400": errorResponse(), "409": errorResponse(), "412": errorResponse() } }
      },
      "/schedule": { get: { operationId: "readExecutionSchedule", summary: "Read daily schedule, waiting actions and calendar write status", responses: { "200": jsonResponse({ type: "object" }), "401": errorResponse() } } },
      "/changes": { get: { operationId: "readExecutionChanges", summary: "Read ordered durable change feed", parameters: [queryParameter("after", { type: "integer", minimum: 0, default: 0 }), queryParameter("limit", { type: "integer", minimum: 1, maximum: 200, default: 100 })], responses: { "200": jsonResponse({ type: "object" }), "401": errorResponse() } } },
      "/daily": {
        get: { operationId: "readDailyWorkspace", summary: "Read daily view including latest AI suggestions and their real timestamps", responses: { "200": jsonResponse({ type: "object" }) } },
        post: { operationId: "saveValidatedDailyBrief", summary: "Save local Codex summary referencing only active selected actions", requestBody: jsonRequest({ type: "object", additionalProperties: false, required: ["id", "date", "summary", "actionIds", "createdAt"], properties: { id: { type: "string" }, date: { type: "string", format: "date" }, summary: { type: "string", minLength: 1, maxLength: 4000 }, actionIds: { type: "array", maxItems: 100, items: { type: "string" } }, createdAt: { type: "string", format: "date-time" }, usage: {} } }), responses: { "200": jsonResponse({ type: "object" }), "409": errorResponse() } }
      },
      "/planner-status": { post: { operationId: "recordLocalPlannerHeartbeat", summary: "Record local bridge availability without claiming a new analysis", requestBody: jsonRequest({ type: "object", additionalProperties: false, properties: { lastError: { type: ["string", "null"], maxLength: 500 } } }), responses: { "200": jsonResponse({ type: "object" }) } } },
      "/execution/tick": { post: { operationId: "runExecutionWorker", summary: "Process sync, selected schedules, durable jobs and nonempty daily digests", responses: { "200": jsonResponse({ type: "object" }) } } },
      "/check-ins": {
        get: { operationId: "listCheckIns", summary: "List latest 200 check-ins (optionally one ID)", parameters: [queryParameter("id", { type: "string" })], responses: { "200": jsonResponse({ type: "object" }), "401": errorResponse() } },
        post: { operationId: "createCheckIn", summary: "Publish one selected check-in; same ID and payload are idempotent", requestBody: jsonRequest({ $ref: "#/components/schemas/CreateCheckIn" }), responses: { "201": jsonResponse({ type: "object" }), "400": errorResponse(), "409": errorResponse() } }
      },
      "/check-ins/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        patch: { operationId: "updateCheckIn", summary: "Reschedule or cancel a pending check-in with its current version", requestBody: jsonRequest({ type: "object", additionalProperties: false, required: ["version"], properties: { version: { type: "integer", minimum: 1 }, dueAt: { type: "string", format: "date-time" }, status: { const: "cancelled" } }, anyOf: [{ required: ["dueAt"] }, { required: ["status"] }] }), responses: { "200": jsonResponse({ type: "object" }), "404": errorResponse(), "409": errorResponse(), "412": errorResponse() } }
      },
      "/feedback": {
        get: { operationId: "listOwnerFeedback", summary: "Read owner-submitted feedback in ascending sequence order", parameters: [queryParameter("after", { type: "integer", minimum: 0, default: 0 }), queryParameter("limit", { type: "integer", minimum: 1, maximum: 200, default: 100 }), queryParameter("id", { type: "string" })], responses: { "200": jsonResponse({ type: "object", properties: { data: { type: "array", items: { type: "object" } }, nextCursor: { type: "integer" }, hasMore: { type: "boolean" } } }), "401": errorResponse() } }
      },
      "/notifications/dispatch": {
        post: { operationId: "dispatchDueCheckIns", summary: "Worker: dispatch due notifications; does not create plans or feedback", responses: { "200": jsonResponse({ type: "object" }), "401": errorResponse(), "503": errorResponse() } }
      },
      "/items": {
        get: {
          operationId: "listItems",
          summary: "List and search items",
          parameters: [
            queryParameter("type", { $ref: "#/components/schemas/ItemType" }),
            queryParameter("status", { $ref: "#/components/schemas/ItemStatus" }),
            queryParameter("sectionId", { type: "string" }),
            queryParameter("source", { type: "string", enum: ["local", "github", "google_calendar"] }),
            queryParameter("q", { type: "string" }),
            queryParameter("updatedSince", { type: "string", format: "date-time" }),
            queryParameter("includeDeleted", { type: "boolean", default: false }),
            queryParameter("limit", { type: "integer", minimum: 1, maximum: 200, default: 50 }),
            queryParameter("offset", { type: "integer", minimum: 0, default: 0 })
          ],
          responses: {
            "200": jsonResponse({
              type: "object",
              properties: {
                data: { type: "array", items: { $ref: "#/components/schemas/Item" } },
                meta: { $ref: "#/components/schemas/ListMeta" }
              },
              required: ["data", "meta"]
            }),
            "401": errorResponse(),
            "503": errorResponse()
          }
        },
        post: {
          operationId: "createItem",
          summary: "Create an item",
          requestBody: jsonRequest({ $ref: "#/components/schemas/CreateItem" }),
          responses: {
            "201": jsonResponse(itemEnvelope()),
            "400": errorResponse(),
            "401": errorResponse(),
            "409": errorResponse()
          }
        }
      },
      "/items/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        get: {
          operationId: "getItem",
          summary: "Get one item",
          parameters: [queryParameter("includeDeleted", { type: "boolean", default: false })],
          responses: { "200": jsonResponse(itemEnvelope()), "404": errorResponse() }
        },
        patch: {
          operationId: "updateItem",
          summary: "Update or restore an item",
          description: "Updates source=local items. Send the ETag returned by GET as If-Match to prevent overwriting newer changes. Set deletedAt to null to restore a soft-deleted item.",
          parameters: [ifMatchParameter()],
          requestBody: jsonRequest({ $ref: "#/components/schemas/UpdateItem" }),
          responses: {
            "200": jsonResponse(itemEnvelope()),
            "400": errorResponse(),
            "404": errorResponse(),
            "412": errorResponse()
          }
        },
        delete: {
          operationId: "deleteItem",
          summary: "Soft-delete a source=local item",
          parameters: [ifMatchParameter()],
          responses: {
            "200": jsonResponse(itemEnvelope()),
            "404": errorResponse(),
            "412": errorResponse()
          }
        }
      },
      "/sections": {
        get: {
          operationId: "listSections",
          summary: "List active sections",
          responses: {
            "200": jsonResponse({
              type: "object",
              properties: {
                data: { type: "array", items: { $ref: "#/components/schemas/Section" } },
                meta: { type: "object" }
              },
              required: ["data", "meta"]
            })
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API token" }
      },
      schemas: {
        PublishAction: { type: "object", additionalProperties: false, required: ["operationId", "id", "title", "goalTreeLink"], properties: {
          operationId: { type: "string", description: "Stable retry ID; reusing it with different content returns 409." }, id: { type: "string" }, title: { type: "string", minLength: 1, maxLength: 200 }, description: { type: "string", maxLength: 5000 },
          goalTreeLink: { type: "object", additionalProperties: false, required: ["treeId", "nodeId"], properties: { treeId: { type: "string" }, nodeId: { type: "string" } } },
          durationMinutes: { type: "integer", minimum: 5, maximum: 600 }, autoSchedule: { type: "boolean", default: true }, recurrence: { type: "string", enum: ["daily", "weekdays"] }, status: { $ref: "#/components/schemas/ItemStatus" }, expectedUpdatedAt: { type: "string", description: "Required when updating an existing action; use its latest updatedAt." }
        } },
        CreateCheckIn: { type: "object", additionalProperties: false, required: ["id", "title", "prompt", "dueAt"], properties: {
          id: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" }, title: { type: "string", minLength: 1, maxLength: 200 }, prompt: { type: "string", minLength: 1, maxLength: 1000 }, dueAt: { type: "string", format: "date-time" }, itemId: { type: "string" }, occurrenceId: { type: "string" },
          goalTreeLink: { type: "object", additionalProperties: false, required: ["treeId", "nodeId"], properties: { treeId: { type: "string" }, nodeId: { type: "string" } } }
        } },
        ItemType: { type: "string", enum: ["todo", "idea", "event", "avoid", "note"] },
        ItemStatus: { type: "string", enum: ["wanted", "active", "paused", "abandoned", "done"] },
        Item: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { $ref: "#/components/schemas/ItemType" },
            title: { type: "string" },
            description: { type: "string" },
            sectionId: { type: "string" },
            status: { $ref: "#/components/schemas/ItemStatus" },
            tags: { type: "array", items: { type: "string" } },
            startAt: { type: "string", format: "date-time" },
            endAt: { type: "string", format: "date-time" },
            allDay: { type: "boolean" },
            source: { type: "string", enum: ["local", "github", "google_calendar"] },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            deletedAt: { type: "string", format: "date-time" }
          },
          required: ["id", "type", "title", "description", "sectionId", "status", "tags", "source", "createdAt", "updatedAt"]
        },
        CreateItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", description: "Optional stable id for idempotent integrations." },
            type: { $ref: "#/components/schemas/ItemType" },
            title: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 100000 },
            sectionId: { type: "string", default: "inbox" },
            status: { $ref: "#/components/schemas/ItemStatus" },
            tags: { type: "array", maxItems: 50, items: { type: "string" } },
            startAt: { type: "string", format: "date-time" },
            endAt: { type: "string", format: "date-time" },
            allDay: { type: "boolean" }
          },
          required: ["title"]
        },
        UpdateItem: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            type: { $ref: "#/components/schemas/ItemType" },
            title: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 100000 },
            sectionId: { type: "string" },
            status: { $ref: "#/components/schemas/ItemStatus" },
            tags: { type: "array", maxItems: 50, items: { type: "string" } },
            startAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
            endAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
            allDay: { anyOf: [{ type: "boolean" }, { type: "null" }] },
            deletedAt: { type: "null", description: "Restore a soft-deleted item." }
          }
        },
        Section: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            color: { type: "string" },
            sortOrder: { type: "integer" },
            isInbox: { type: "boolean" }
          },
          required: ["id", "name", "color", "sortOrder"]
        },
        ListMeta: {
          type: "object",
          properties: {
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
            snapshotSha: { anyOf: [{ type: "string" }, { type: "null" }] }
          },
          required: ["total", "limit", "offset", "snapshotSha"]
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: { code: { type: "string" }, message: { type: "string" } },
              required: ["code", "message"]
            }
          },
          required: ["error"]
        }
      }
    }
  };
}

function queryParameter(name: string, schema: object) {
  return { name, in: "query", required: false, schema };
}

function ifMatchParameter() {
  return {
    name: "If-Match",
    in: "header",
    required: false,
    description: "ETag returned by GET /items/{id}",
    schema: { type: "string" }
  };
}

function jsonRequest(schema: object) {
  return { required: true, content: { "application/json": { schema } } };
}

function jsonResponse(schema: object) {
  return { description: "Success", content: { "application/json": { schema } } };
}

function errorResponse() {
  return jsonResponse({ $ref: "#/components/schemas/Error" });
}

function itemEnvelope() {
  return {
    type: "object",
    properties: { data: { $ref: "#/components/schemas/Item" }, meta: { type: "object" } },
    required: ["data", "meta"]
  };
}
