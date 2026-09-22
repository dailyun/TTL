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
      sections: "/api/v1/sections",
      checkIns: "/api/v1/check-ins",
      feedback: "/api/v1/feedback",
      calendar: "/api/v1/calendar",
      actions: "/api/v1/actions",
      schedule: "/api/v1/schedule",
      reminderDispatch: "/api/v1/notifications/dispatch"
    }
  });
}

export function OPTIONS(request: Request) {
  return externalApiOptions(request);
}
