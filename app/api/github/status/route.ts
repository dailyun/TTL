import { defaultHumanSource } from "../_shared.js";

export const runtime = "nodejs";

export function GET() {
  const owner = process.env.GITHUB_OWNER ?? "";
  const repo = process.env.GITHUB_REPO ?? "";
  const branch = process.env.GITHUB_BRANCH ?? "main";
  const hasToken = Boolean(process.env.GITHUB_TOKEN);

  return Response.json({
    configured: Boolean(owner && repo && hasToken),
    owner: owner || undefined,
    repo: repo || undefined,
    branch,
    hasToken,
    source: defaultHumanSource()
  }, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
