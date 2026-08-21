import { Workspace, type ViewMode } from "./workspace/Workspace.js";

const VIEW_MODES = new Set<ViewMode>(["home", "notes", "list", "board", "calendar", "sync"]);

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialView = requestedView && VIEW_MODES.has(requestedView as ViewMode)
    ? requestedView as ViewMode
    : "home";

  return <Workspace initialView={initialView} />;
}
