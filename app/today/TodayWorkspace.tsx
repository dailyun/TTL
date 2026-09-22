"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronRight, RefreshCw, WifiOff, Bell, Settings2 } from "lucide-react";
import { db, updateItem, type PendingOperation } from "../../src/local-db/db.js";
import type { Item, ItemStatus } from "../../src/domain/types.js";
import type { Preferences } from "../../src/execution/types.js";
import { cachedWorkspace, syncServerWorkspace, queueBrowserOperation, pendingOperations, type ServerWorkspace } from "../../src/sync/server-workspace.js";
import { FeedbackCard } from "../review/ReviewWorkspace.js";
import "./today.css";

const statusNames: Record<ItemStatus, string> = { wanted: "想做", active: "正在", paused: "搁置", abandoned: "放弃", done: "完成" };
const day = (date = new Date()) => new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const time = (value?: string) => value ? new Date(value).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }) : "待安排";
const stamp = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚未成功";

export function TodayWorkspace() {
  const [data, setData] = useState<ServerWorkspace>();
  const [message, setMessage] = useState("正在连接…");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingOperation[]>([]);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const next = await syncServerWorkspace();
      if (next) { setData(next); setError(""); setMessage(`已同步 · ${time(new Date().toISOString())}`); }
      else setError("服务器工作区尚未配置，请先完成部署。");
    } catch (e) { setMessage("待同步 · 保留此设备上的操作"); setError(e instanceof Error ? e.message : "网络连接未成功"); }
    finally { const queue = await pendingOperations(); setPending(queue.operations); setSnapshotPending(queue.snapshot); setSyncing(false); }
  }, []);
  useEffect(() => {
    void cachedWorkspace().then(value => { if (value) setData(value); });
    void refresh(); const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener("online", refresh); window.addEventListener("focus", refresh);
    const outbox = () => { void pendingOperations().then(q => { setPending(q.operations); setSnapshotPending(q.snapshot); }); };
    window.addEventListener("todo-outbox", outbox);
    return () => { window.clearInterval(timer); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("todo-outbox", outbox); };
  }, [refresh]);
  async function run(task: () => Promise<unknown>) {
    try { setError(""); await task(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "操作未成功"); }
  }
  async function command(body: Record<string, unknown>) { await queueBrowserOperation("/api/workspace", { operationId: `owner:${crypto.randomUUID()}`, ...body }); }
  async function patchItem(item: Item, patch: Partial<Item>) { await updateItem(item.id, patch); setMessage("待同步…"); await refresh(); }
  const today = day();
  const active = data?.snapshot.items.filter(i => !i.deletedAt && ["wanted", "active"].includes(i.status)) ?? [];
  const occurrences = (data?.occurrences ?? []).filter(o => o.date === today && o.state !== "cancelled").sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
  const scheduledIds = new Set(occurrences.map(o => o.itemId));
  const unplanned = active.filter(i => i.autoSchedule && !scheduledIds.has(i.id));
  const reviews = (data?.reviews ?? []).filter(c => c.status === "pending" && Date.parse(c.dueAt) <= Date.now() && (!c.snoozedUntil || Date.parse(c.snoozedUntil) <= Date.now()));
  const answered = (data?.reviews ?? []).filter(c => c.feedback).slice(-10).reverse();
  const brief = data?.briefs.at(-1);
  return <main className="today-shell">
    <header className="today-nav"><a className="today-brand" href="/today"><span className="today-mark"><CheckCircle2 size={21} /></span> TodoTodoList</a><div><a href="/">工作台 <ChevronRight size={14} /></a><button aria-label="设置" className="today-icon" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={20} /></button></div></header>
    <section className="today-hero"><div><p className="today-eyebrow">把计划变成实际的一天</p><h1>今日<span>{new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" })}</span></h1><p>按自己的节奏做事，留下真实的反馈。</p></div><button className="today-sync" disabled={syncing} onClick={() => void refresh()}><RefreshCw size={16} className={syncing ? "turning" : ""} />{message}</button></section>
    {error && <aside className="today-alert" role="alert"><WifiOff size={18} /><div>{error} <a href="/login?next=%2Ftoday">重新登录</a></div></aside>}
    {(pending.length > 0 || snapshotPending) && <section className="today-card"><h2>待同步 <span>{pending.length + Number(snapshotPending)}</span></h2><p>已保存在此设备，服务器确认后才算提交。恢复网络或登录后自动重试。</p>{pending.map(p => <div className="queue-row" key={p.id}><span>{p.path.includes("feedback") ? "执行反馈" : "操作请求"} · {p.error ?? "等待连接"}</span><button className="text-button" onClick={() => void run(() => db.outbox.delete(p.id))}>撤回未提交请求</button></div>)}<button className="today-button secondary" onClick={() => void refresh()}>重试同步</button></section>}
    <div className="today-stats"><a href="#agenda"><strong>{occurrences.length}</strong><span>今日安排</span></a><a href="#unplanned"><strong>{unplanned.length}</strong><span>待安排</span></a><a href="#reviews"><strong>{reviews.length}</strong><span>待回顾</span></a></div>
    <div className="today-columns"><div>
      <section id="agenda" className="today-card"><div className="section-heading"><h2><CalendarDays size={18} />今天的时间</h2><span>北京时间</span></div>
        {!occurrences.length && <div className="today-empty"><CalendarDays size={28} /><h3>今天还没有安排</h3><p>与 Codex 商定行动并发布后，会在 12:00–22:00 的空闲时间安排。已有日历事件也会显示在这里。</p></div>}
        {occurrences.map(o => { const item = data?.snapshot.items.find(i => i.id === o.itemId); return <article className={`agenda-row ${o.state === "completed" ? "completed" : ""}`} key={o.id}><div className="agenda-time">{time(o.startAt)}<small>{time(o.endAt)}</small></div><div className="agenda-body"><h3>{item?.title ?? "关联事项待核对"}</h3><div className="agenda-tags"><span>{o.state === "pending" ? "日历待确认" : o.state === "scheduled" ? "已排期" : o.state === "completed" ? "已反馈完成" : "已反馈"}</span>{o.locked && <span>固定安排</span>}{item?.recurrence && <span>习惯 · 本次执行</span>}</div>{o.reason && <p>{o.reason}</p>}
          <div className="agenda-actions">{item?.goalTreeLink && <button className="text-button" onClick={() => void run(() => navigator.clipboard.writeText(`$decision-tree 讨论 ${item.goalTreeLink!.nodeId}\n树 ID：${item.goalTreeLink!.treeId}\n事项 ID：${item.id}\n请读取最新节点与实际反馈，和我讨论下一步。`))}>复制给 AI</button>}{o.managed && o.locked && Date.parse(o.startAt ?? "") > Date.now() && <button className="text-button" onClick={() => void run(() => command({ type: "unlock", id: o.id, version: o.version }))}>允许后续调整</button>}</div></div></article>; })}
      </section>
      <section id="unplanned" className="today-card"><h2>待安排的行动 <span>{unplanned.length}</span></h2>{!unplanned.length && <p className="muted">当前没有等待排期的已选行动。</p>}{unplanned.map(item => <div className="unplanned-row" key={item.id}><h3>{item.title}</h3><p>{item.durationMinutes ? `${item.durationMinutes} 分钟 · 等待空闲时间或日历连接` : "需要预计时长，补充后才能排期"}</p>{!item.durationMinutes && <form onSubmit={e => { e.preventDefault(); const value = Number(new FormData(e.currentTarget).get("minutes")); if (value >= 5 && value <= 600) void run(() => patchItem(item, { durationMinutes: value })); }}><input aria-label={`${item.title}预计分钟`} name="minutes" type="number" min={5} max={600} step={5} placeholder="分钟" required /><button className="today-button secondary">保存时长</button></form>}<label className="status-select">状态 <select value={item.status} onChange={e => void run(() => patchItem(item, { status: e.target.value as ItemStatus }))}>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>)}</section>
    </div><aside>
      <section className="today-card ai-card"><p className="today-eyebrow">本机 Codex</p><h2>规划与建议</h2>{brief ? <><p className="brief-text">{brief.summary}</p><small>{brief.date === today ? "今日建议" : "此前保存的建议"} · {stamp(brief.createdAt)}</small></> : <p>当前展示已保存的安排。本机尚未生成新的 AI 建议，Mac 恢复连接后会补充。</p>}<div className="connection-row"><span className={data?.planner.lastSeenAt && Date.now() - Date.parse(data.planner.lastSeenAt) < 180_000 ? "dot green" : "dot"} />本机最近连接：{stamp(data?.planner.lastSeenAt)}</div>{data?.planner.lastError && <p className="error">{data.planner.lastError}</p>}</section>
      <section className="today-card"><h2><Bell size={18} />早晚与你碰面</h2><p>{data?.preferences.morningTime ?? "09:00"} 晨报 · {data?.preferences.eveningTime ?? "22:30"} 回顾</p><p className="muted">有内容才提醒。手机通知需从主屏幕 Web App 开启。</p><a className="today-button secondary" href="/review">通知设置与测试 <ChevronRight size={16} /></a></section>
      <section className="today-card sync-details"><h2>连接状态</h2><p>日历同步：{stamp(data?.calendar.lastSyncAt)}</p>{data?.calendar.lastError && <p className="error">{data.calendar.lastError}</p>}{data?.calendar.watchError && <p>{data.calendar.watchError}</p>}<a href="/api/google-calendar/oauth/start">连接 / 重新授权 Google 日历</a><p>后台检查：{stamp(data?.worker.lastSuccessAt)}</p>{data?.worker.lastError && <p className="error">{data.worker.lastError}</p>}{data?.jobs.map(j => <div className="job-row" key={j.id}><p>{j.error ?? "日历请求等待确认"}</p>{j.state !== "conflict" && <button className="text-button" onClick={() => void run(() => command({ type: "retry", id: j.id }))}>重试</button>}</div>)}</section>
    </aside></div>
    {settingsOpen && data && <PreferencePanel preferences={data.preferences} onSave={patch => run(() => command({ type: "preferences", expected: Object.fromEntries(Object.keys(patch).map(k => [k, data.preferences[k as keyof Preferences]])), patch }))} />}
    <section id="reviews" className="today-reviews"><div className="section-heading"><h2>回顾实际发生的事</h2><span>{reviews.length} 项待反馈</span></div>{!reviews.length && <div className="today-card"><p className="muted">目前没有到时间的待回顾行动。时间结束后也不会自动记为完成。</p></div>}{reviews.map(item => <FeedbackCard key={item.id} item={{ ...item, deliveries: [] }} onSaved={refresh} />)}</section>
    {Boolean(data?.conflicts.length) && <section className="today-card"><h2>迁移 / 同步冲突 <span>{data!.conflicts.length}</span></h2><p>两份内容都保留。请选择本次应使用的版本，若服务器又有变化会要求重新核对。</p>{data!.conflicts.map(c => { const current = data!.snapshot[c.collection].find(e => e.id === c.entityId); return <article className="conflict" key={c.id}><h3>{c.entityId}</h3><div><details><summary>服务器版本</summary><pre>{JSON.stringify(current, null, 2)}</pre></details><details><summary>设备 / 导入版本</summary><pre>{JSON.stringify(c.incoming, null, 2)}</pre></details></div><button className="today-button secondary" onClick={() => void run(() => command({ type: "resolve", id: c.id, choice: "server", expectedCurrent: current }))}>保留服务器版</button><button className="today-button secondary" onClick={() => void run(() => command({ type: "resolve", id: c.id, choice: "incoming", expectedCurrent: current }))}>采用导入版</button></article>; })}</section>}
    {answered.length > 0 && <details className="today-card"><summary>最近反馈与更正</summary>{answered.map(item => <div key={item.id}><FeedbackCard item={{ ...item, deliveries: [] }} onSaved={refresh} />{data!.feedbackHistory.filter(f => f.checkInId === item.id).length > 1 && <details><summary>查看原记录</summary>{data!.feedbackHistory.filter(f => f.checkInId === item.id).map(f => <p key={f.id}>{stamp(f.submittedAt)} · {f.outcome} · {f.text}</p>)}</details>}</div>)}</details>}
    <footer className="today-footer">事项保存在服务器 · 完整目标树与工作材料留在你的 Mac</footer>
  </main>;
}

function PreferencePanel({ preferences, onSave }: { preferences: Preferences; onSave: (patch: Partial<Preferences>) => Promise<unknown> }) {
  return <section className="today-card"><h2>每日节奏</h2><form className="preferences-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void onSave({ morningTime: String(form.get("morning")), eveningTime: String(form.get("evening")), bufferMinutes: Number(form.get("buffer")), notifications: form.get("notifications") === "on", autoSchedule: form.get("schedule") === "on" }); }}><label>晨报<input type="time" name="morning" defaultValue={preferences.morningTime} required /></label><label>晚间回顾<input type="time" name="evening" defaultValue={preferences.eveningTime} required /></label><label>任务间缓冲（分钟）<input type="number" name="buffer" min={0} max={120} defaultValue={preferences.bufferMinutes} required /></label><label><input type="checkbox" name="notifications" defaultChecked={preferences.notifications} />发送晨报与晚间提醒</label><label><input type="checkbox" name="schedule" defaultChecked={preferences.autoSchedule} />自动安排已选行动</label><p>北京时间 12:00–22:00；不设总时长上限，避开已有安排。</p><button className="today-button">保存设置</button></form></section>;
}
