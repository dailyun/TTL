import { redirect } from "next/navigation";
import { isSimpleAuthEnabled } from "../../src/auth/simple-auth.js";
import { LoginForm } from "./LoginForm.js";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  if (!isSimpleAuthEnabled()) {
    redirect("/");
  }

  const params = await searchParams;
  const nextPath = safeNextPath(params?.next);

  return (
    <main className="login-shell">
      <LoginForm nextPath={nextPath} />
    </main>
  );
}

function safeNextPath(value?: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }

  return value;
}
