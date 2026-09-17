"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckIn, Delivery, FeedbackInput } from "../../src/check-ins/schema.js";
import "./review.css";
import { db } from "../../src/local-db/db.js";
import { queueBrowserOperation, pendingOperations } from "../../src/sync/server-workspace.js";

type ReviewItem = CheckIn & { deliveries: Array<Pick<Delivery, "status" | "attemptedAt" | "statusCode">> };
type PushConfig = { configured: boolean; publicKey: string | null; lastDispatchAt: string | null };
const outcomes: Record<FeedbackInput["outcome"], string> = { completed: "完成了", partial: "部分完成", not_done: "没做", skipped: "跳过这次回顾" };
const deliveryLabels = { sending: "正在提交推送", accepted: "推送服务已接受；是否送达请查看手机", failed: "推送未成功", unknown: "发送结果待核实" };

async function api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store"
  });
  if (response.status === 401) throw new Error("登录已过期，请重新登录后继续。");
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || "操作失败，请重试。");
  return value as T;
}

function applicationServerKey(value: string): ArrayBuffer {
  const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

export function ReviewWorkspace({ selectedId }: { selectedId?: string }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const testRequest = useRef<{ id: string; subscriptionId: string; dueAt: string } | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<{ data: ReviewItem[] }>(`/api/check-ins${selectedId ? `?id=${encodeURIComponent(selectedId)}` : ""}`);
    setItems(data.data.filter(c => !["morning", "evening"].includes(c.kind ?? "")));
    setLoaded(true);
  }, [selectedId]);

  useEffect(() => {
    setSupported(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setNeedsInstall(ios && !(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone));
    void refresh().catch((e) => { setError(e.message); setLoaded(true); });
    void api<PushConfig>("/api/notifications").then(setConfig).catch((e) => setError(e.message));
    const focus = () => { void refresh().catch((e) => setError(e.message)); };
    window.addEventListener("focus", focus);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistration("/").then(async (registration) => {
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const saved = await api<{ id: string }>("/api/notifications/subscribe", subscription.toJSON());
          setDeviceId(saved.id);
        }
      }).catch((e) => setError(e.message));
    }
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);

  async function run(task: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function enablePush() {
    // Request permission directly from this user gesture, before network work.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("通知尚未允许，可在 iPhone 设置中修改后重试。");
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config!.publicKey!) });
    const saved = await api<{ id: string }>("/api/notifications/subscribe", subscription.toJSON());
    setDeviceId(saved.id); setMessage("此设备已开启通知。可以创建一条测试回顾。");
  }

  async function disablePush() {
    if (deviceId) await api("/api/notifications/subscribe", { id: deviceId }, "DELETE");
    const registration = await navigator.serviceWorker.getRegistration("/");
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
    setDeviceId(null); setMessage("此设备已关闭通知，已有回顾仍保留。");
  }

  async function testPush() {
    testRequest.current ??= { id: `test-${crypto.randomUUID()}`, subscriptionId: deviceId!, dueAt: new Date(Date.now() + 30_000).toISOString() };
    await api("/api/notifications/test", testRequest.current);
    testRequest.current = null;
    setMessage("测试回顾已保存，计划 30 秒后推送。请关闭网页、锁屏验证；提醒服务需保持运行。");
    await refresh();
  }

  return <main className="review-shell">
    <header className="review-header"><a href="/today">← 今日</a><span>TodoTodoList</span></header>
    <section className="review-intro"><p className="eyebrow">记录实际发生的事</p><h1>提醒与回顾</h1><p>做了多少、遇到什么，都可以记下来。你的反馈会成为下一次规划的依据。</p></section>
    <section className="review-panel" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">手机通知</h2>
      {needsInstall && <p>iPhone 请先在 Safari 分享菜单中选择<strong>“添加到主屏幕”</strong>，再从桌面图标打开本站。</p>}
      {!supported && !needsInstall && <p>当前环境暂不支持推送，请使用 HTTPS 网站及支持通知的浏览器。</p>}
      {config && !config.configured && <p>服务端推送尚未配置，仍可在下方查看和填写回顾。</p>}
      {config?.configured && <p className="review-muted">{config.lastDispatchAt ? `提醒服务最近检查：${new Date(config.lastDispatchAt).toLocaleString()}` : "提醒服务尚未运行，测试提醒会先保存在队列中。"}</p>}
      <div className="review-actions">
        <button type="button" disabled={busy || !supported || needsInstall || !config?.configured} onClick={() => void run(deviceId ? disablePush : enablePush)}>{deviceId ? "关闭此设备通知" : "开启此设备通知"}</button>
        <button type="button" className="secondary" disabled={busy || !deviceId || !config?.configured} onClick={() => void run(testPush)}>30 秒后测试提醒</button>
      </div>
    </section>
    {error && <p className="review-alert error" role="alert">{error} <a href={`/login?next=${encodeURIComponent(`/review${selectedId ? `?checkIn=${selectedId}` : ""}`)}`}>登录</a></p>}
    {message && <p className="review-alert" role="status">{message}</p>}
    <div className="review-list-heading"><h2>{selectedId ? "这一次回顾" : "待回顾与记录"}</h2><button className="secondary" type="button" disabled={busy} onClick={() => void run(refresh)}>刷新</button></div>
    {!loaded && <p>正在读取…</p>}
    {loaded && !items.length && <section className="review-panel"><h2>{selectedId ? "没有找到这项回顾" : "暂时没有待回顾事项"}</h2><p>规划后选定的行动可以在这里收集反馈。测试回顾不会改变真实目标。</p></section>}
    {items.map((item) => <FeedbackCard key={item.id} item={item} onSaved={refresh} />)}
    {selectedId && <a href="/review">查看全部回顾</a>}
  </main>;
}

export function FeedbackCard({ item, onSaved }: { item: ReviewItem; onSaved: () => Promise<void> }) {
  const [outcome, setOutcome] = useState<FeedbackInput["outcome"] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const draftKey = `feedback-draft:${item.id}`;
  useEffect(() => {
    void db.runtime.get(draftKey).then(row => {
      const draft = row?.value as { outcome?: FeedbackInput["outcome"]; text?: string } | undefined;
      if (draft) { setOutcome(draft.outcome ?? null); setText(draft.text ?? ""); }
    });
    const update = async () => {
      const rows = await db.outbox.toArray();
      setPending(rows.some(row => row.path === `/api/check-ins/${encodeURIComponent(item.id)}/feedback`));
    };
    void update(); window.addEventListener("todo-outbox", update);
    return () => window.removeEventListener("todo-outbox", update);
  }, [draftKey, item.id]);
  useEffect(() => { setEditing(false); }, [item.feedback?.id]);
  async function draft(nextOutcome: FeedbackInput["outcome"] | null, nextText: string) {
    setOutcome(nextOutcome); setText(nextText);
    await db.runtime.put({ key: draftKey, value: { outcome: nextOutcome, text: nextText } });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!outcome) return;
    setBusy(true); setError("");
    try {
      await queueBrowserOperation(`/api/check-ins/${encodeURIComponent(item.id)}/feedback`, {
        id: `reply-${crypto.randomUUID()}`, outcome, text, ...(item.feedback ? { supersedesId: item.feedback.id } : {})
      });
      const queued = (await db.outbox.toArray()).some(row => row.path === `/api/check-ins/${encodeURIComponent(item.id)}/feedback`);
      setPending(queued);
      if (!queued) { await db.runtime.delete(draftKey); await onSaved(); setEditing(false); }
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <article className="review-panel" id={item.id}>
    <div className="review-meta"><span>{item.test ? "测试事项" : "行动回顾"}</span><time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time></div>
    <h2>{item.title}</h2><p>{item.prompt}</p>
    {item.feedback && !editing ? <div className="review-answer"><strong>{outcomes[item.feedback.outcome]}</strong><p>{item.feedback.text || "没有补充说明"}</p><small>服务器已保存 · {new Date(item.feedback.submittedAt).toLocaleString()}。更正会保留原记录。</small>
      <button className="secondary" disabled={pending} onClick={() => { setEditing(true); void draft(item.feedback!.outcome, item.feedback!.text); }}>更正反馈</button></div>
      : item.status === "cancelled" ? <p>这项回顾已取消，已有记录仍保留。</p> : <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy || pending}><legend>{editing ? "更正实际结果" : "实际结果"}</legend><div className="review-choices">{Object.entries(outcomes).map(([value, label]) => <label key={value} className={outcome === value ? "selected" : ""}><input type="radio" name={`outcome-${item.id}`} value={value} checked={outcome === value} onChange={() => void draft(value as FeedbackInput["outcome"], text)} />{label}</label>)}</div></fieldset>
        <label className="review-text-label" htmlFor={`text-${item.id}`}>补充一句（可选）</label><textarea id={`text-${item.id}`} maxLength={5000} value={text} disabled={busy || pending} onChange={(e) => void draft(outcome, e.target.value)} placeholder="做了什么、感觉如何，或遇到了什么阻碍…" />
        {error && <p role="alert" className="error">{error}</p>}<div className="review-actions"><button type="submit" disabled={busy || pending || !outcome}>{pending ? "待同步 · 内容已保存在此设备" : busy ? "正在提交…" : editing ? "保存更正" : "保存反馈"}</button>
        {!editing && <button type="button" className="secondary" disabled={busy || pending} onClick={() => void queueBrowserOperation("/api/workspace", { type: "snooze", operationId: `snooze:${crypto.randomUUID()}`, id: item.id, until: new Date(Date.now() + 12 * 3600_000).toISOString() }).then(onSaved)}>稍后回答</button>}
        {editing && <button type="button" className="secondary" onClick={() => setEditing(false)}>取消更正</button>}</div>
      </form>}
    {pending && <p role="status">待同步；服务器确认前不会显示为已保存。可在今日页查看重试情况。</p>}
    {item.deliveries.length > 0 && <p className="review-muted review-delivery">{deliveryLabels[item.deliveries.at(-1)!.status]}</p>}
  </article>;
}
