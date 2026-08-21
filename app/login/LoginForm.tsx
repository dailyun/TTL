"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{
    status: "idle" | "loading" | "error";
    message?: string;
  }>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setState({ status: "error", message: "请输入密码" });
      return;
    }

    setState({ status: "loading" });
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ password })
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setState({ status: "error", message: payload.error ?? "登录失败" });
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-icon">
        <LockKeyhole size={22} />
      </div>
      <div>
        <p className="brand-mark">TodoTodoList</p>
        <h1>登录工作台</h1>
        <p className="login-copy">输入部署密码后继续管理想法、Todo 和日程。</p>
      </div>
      <label>
        密码
        <input
          autoComplete="current-password"
          autoFocus
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button className="primary-button" type="submit" disabled={state.status === "loading"}>
        {state.status === "loading" ? "登录中..." : "登录"}
      </button>
      {state.message ? <p className="login-error">{state.message}</p> : null}
    </form>
  );
}
