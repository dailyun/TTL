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
      version: "1.0.0",
      description: "CRUD API for TodoTodoList items. Data is persisted in the configured GitHub snapshot."
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths: {
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
