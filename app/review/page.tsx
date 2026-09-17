import { ReviewWorkspace } from "./ReviewWorkspace.js";
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ checkIn?: string }> }) {
  const params = await searchParams;
  return <ReviewWorkspace selectedId={typeof params.checkIn === "string" ? params.checkIn : undefined} />;
}
