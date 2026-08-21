import { externalApiJson, externalApiOptions } from "../../../src/external-api/http.js";

export const runtime = "nodejs";

export function GET(request: Request) {
  return externalApiJson(request, {
    name: "TodoTodoList External API",
    version: "v1",
    authentication: "Bearer token or X-API-Key",
    openapi: "/api/v1/openapi",
    resources: {
      items: "/api/v1/items",
      sections: "/api/v1/sections"
    }
  });
}

export function OPTIONS(request: Request) {
  return externalApiOptions(request);
}
