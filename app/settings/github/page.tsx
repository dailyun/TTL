import { redirect } from "next/navigation";

export default function GitHubSettingsPage() {
  redirect("/?view=sync#github-source");
}
