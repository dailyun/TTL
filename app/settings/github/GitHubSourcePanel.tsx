"use client";

import { useEffect, useMemo, useState } from "react";
import type { HumanSource, Item } from "../../../src/domain/types.js";
import { reconcileHumanSourceItems } from "../../../src/local-db/db.js";

type RequestState = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  payload?: unknown;
};

type GitHubStatus = {
  configured: boolean;
  owner?: string;
  repo?: string;
  branch: string;
  hasToken: boolean;
  source: HumanSource;
};

export function GitHubSourcePanel({ embedded = false }: { embedded?: boolean }) {
  const [sourcePath, setSourcePath] = useState("findwork/**/*.md");
  const [sectionId, setSectionId] = useState("work");
  const [writebackPath, setWritebackPath] = useState("findwork/product-plan.md");
  const [writebackStatus, setWritebackStatus] = useState("active");
  const [state, setState] = useState<RequestState>({ status: "idle" });
  const [status, setStatus] = useState<RequestState & { payload?: GitHubStatus }>({ status: "idle" });

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setStatus({ status: "loading", message: "正在读取 GitHub 配置..." });
    try {
      const response = await fetch("/api/github/status");
      const payload = (await response.json()) as GitHubStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "读取 GitHub 配置失败");
      }
      setSourcePath(payload.source.path);
      setSectionId(payload.source.defaultSectionId);
      setStatus({
        status: "success",
        message: payload.configured ? "GitHub 远端已配置。" : "GitHub 远端还缺少环境变量。",
        payload
      });
    } catch (error) {
      setStatus({
        status: "error",
        message: error instanceof Error ? error.message : "读取 GitHub 配置失败"
      });
    }
  }

  const sourcePayload = useMemo(
    () => ({
      id: "findwork",
      label: "Find Work",
      path: sourcePath,
      mode: "read-write",
      defaultSectionId: sectionId,
      defaultType: "idea",
      defaultStatus: "wanted",
      importCheckboxes: true,
      writeBack: "frontmatter-only"
    }),
    [sectionId, sourcePath]
  );

  async function importFiles() {
    setState({ status: "loading", message: "正在从 GitHub 导入并写入系统..." });
    const result = await postJson("/api/github/import-human-files", { source: sourcePayload });
    await handleImportResult(result, "GitHub");
  }

  async function importLocalFiles() {
    setState({ status: "loading", message: "正在从本地 Git 模拟库导入并写入系统..." });
    const result = await postJson("/api/local-git/import-human-files", { source: sourcePayload });
    await handleImportResult(result, "本地模拟库");
  }

  async function handleImportResult(result: RequestState, sourceLabel: string) {
    if (result.status === "success" && isImportPayload(result.payload)) {
      const reconciliation = await reconcileHumanSourceItems(
        result.payload.items,
        [result.payload.source.id]
      );
      setState({
        ...result,
        message: `已从${sourceLabel}导入 ${result.payload.fileCount} 个文件、${result.payload.itemCount} 条事项${reconciliation.deletedCount ? `，清理 ${reconciliation.deletedCount} 条已移除事项` : ""}。`
      });
      return;
    }
    if (result.status === "success") {
      setState({
        ...result,
        status: "error",
        message: `${sourceLabel}导入结果缺少事项数据，未写入本地缓存。`
      });
      return;
    }
    setState(result);
  }

  async function writeBack() {
    setState({ status: "loading", message: "正在回写 frontmatter..." });
    const result = await postJson("/api/github/writeback-human-file", {
      sourcePath: writebackPath,
      patch: {
        status: writebackStatus,
        updatedAt: new Date().toISOString()
      }
    });
    setState(result);
  }

  return (
    <div className="settings-stack">
      <GitHubStatusCard state={status} />

      <div className="form-row">
        <label>
          文件源 glob
          <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} />
        </label>
        <label>
          默认版块
          <input value={sectionId} onChange={(event) => setSectionId(event.target.value)} />
        </label>
      </div>

      <div className="button-row">
        {!embedded ? (
          <button className="button" type="button" onClick={importLocalFiles} disabled={state.status === "loading"}>
            导入本地模拟库
          </button>
        ) : null}
        <button
          className="button"
          type="button"
          onClick={importFiles}
          disabled={state.status === "loading" || status.status === "loading" || status.payload?.configured === false}
        >
          从 GitHub 导入
        </button>
        {!embedded ? (
          <a className="button ghost" href="/">
            返回首页
          </a>
        ) : null}
      </div>

      <details className="advanced-settings">
        <summary>高级：手动回写指定文件</summary>
        <div className="advanced-settings-body">
          <div className="form-row">
            <label>
              回写文件
              <input value={writebackPath} onChange={(event) => setWritebackPath(event.target.value)} />
            </label>
            <label>
              新状态
              <select
                value={writebackStatus}
                onChange={(event) => setWritebackStatus(event.target.value)}
              >
                <option value="wanted">想要</option>
                <option value="active">正在</option>
                <option value="paused">搁置</option>
                <option value="abandoned">放弃</option>
                <option value="done">完成</option>
              </select>
            </label>
          </div>

          <button className="button secondary" type="button" onClick={writeBack} disabled={state.status === "loading"}>
            回写指定文件 frontmatter
          </button>
        </div>
      </details>

      <ResultView state={state} />
    </div>
  );
}

function GitHubStatusCard({ state }: { state: RequestState & { payload?: GitHubStatus } }) {
  const status = state.payload;
  return (
    <section className={`connection-card ${status?.configured ? "success" : "warning"}`}>
      <div>
        <strong>{status?.configured ? "远端已配置" : "需要配置环境变量"}</strong>
        <p>{state.message ?? "读取配置后可以从这里导入 GitHub 私库中的 Markdown 文件。"}</p>
      </div>
      {status ? (
        <dl className="connection-fields">
          <dt>仓库</dt>
          <dd>{status.owner && status.repo ? `${status.owner}/${status.repo}` : "未配置"}</dd>
          <dt>分支</dt>
          <dd>{status.branch}</dd>
          <dt>Token</dt>
          <dd>{status.hasToken ? "已配置" : "未配置"}</dd>
          <dt>默认源</dt>
          <dd>{status.source.path}</dd>
        </dl>
      ) : null}
    </section>
  );
}

function ResultView({ state }: { state: RequestState }) {
  if (state.status === "idle") {
    return <p className="hint">导入会把匹配的 Markdown 文件写入本地缓存；回写只修改 frontmatter。</p>;
  }

  return (
    <div className={`result ${state.status}`}>
      {state.message ? <p>{state.message}</p> : null}
      {state.payload ? <pre>{JSON.stringify(state.payload, null, 2)}</pre> : null}
    </div>
  );
}

function isImportPayload(payload: unknown): payload is {
  fileCount: number;
  itemCount: number;
  items: Item[];
  source: HumanSource;
} {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "fileCount" in payload &&
    "itemCount" in payload &&
    "source" in payload &&
    "items" in payload &&
    Array.isArray((payload as { items: unknown }).items) &&
    typeof (payload as { source: unknown }).source === "object" &&
    (payload as { source: unknown }).source !== null
  );
}

async function postJson(url: string, body: unknown): Promise<RequestState> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json();

    if (!response.ok) {
      return {
        status: "error",
        message: payload.error ?? "请求失败",
        payload
      };
    }

    return {
      status: "success",
      message: "请求成功",
      payload
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "未知错误"
    };
  }
}
