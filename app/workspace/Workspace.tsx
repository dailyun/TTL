"use client";

import {
  Archive,
  Ban,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Download,
  FileText,
  GitBranch,
  ImagePlus,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MoreHorizontal,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction
} from "react";
import type { HumanSource, Item, ItemAttachment, ItemStatus, ItemType } from "../../src/domain/types.js";
import { itemDisplayStatus, type ItemDisplayStatus } from "../../src/domain/calendar-history.js";
import { isSupportedCaptureImageType, SUPPORTED_CAPTURE_IMAGE_TYPES } from "../../src/domain/attachments.js";
import { getReverseTodoPhase, isOpenReverseTodo, validateReverseTodoSchedule } from "../../src/domain/reverse-todo.js";
import {
  addDaysToDateKey,
  allDayDateKeyFromIso,
  allDayIsoFromDateKey
} from "../../src/calendar/all-day.js";
import type { LocalGitDiff, LocalGitStatus } from "../../src/local-git/repo.js";
import {
  archiveSection,
  createItem,
  createSection,
  ensureSeedData,
  exportSnapshot,
  getAppSettings,
  importGoogleCalendarItems,
  importItems,
  reconcileHumanSourceItems,
  importSnapshot,
  listActiveItems,
  listAllSections,
  listSections,
  softDeleteItem,
  validateSnapshot,
  type AppSnapshot,
  type AppSettings,
  type Section,
  type SnapshotImportMode,
  updateAppSettings,
  updateItem,
  updateSection
} from "../../src/local-db/db.js";
import { summarizeSourceFiles, type SourceFileSummary } from "../../src/sync/source-summary.js";
import { syncServerWorkspace, isServerMode, browserApi, pendingOperations } from "../../src/sync/server-workspace.js";
import { GitHubSourcePanel } from "../settings/github/GitHubSourcePanel.js";

export type ViewMode = "home" | "notes" | "list" | "board" | "calendar" | "sync";
type TimeFilter = "all" | "scheduled" | "unscheduled";

type GoogleCalendarStatus = {
  oauthConfigured: boolean;
  importConfigured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasRedirectUri: boolean;
  hasRefreshToken: boolean;
  redirectUri?: string;
  calendarId: string;
  sectionId: string;
  realtime: {
    webhookConfigured: boolean;
    channelActive: boolean;
    channelExpiration?: string;
    channelNeedsRenewal: boolean;
    hasSyncToken: boolean;
    lastFullSyncAt?: string;
    lastIncrementalSyncAt?: string;
    lastNotificationAt?: string;
    pendingItemCount: number;
  };
};

type GoogleCalendarCreateResult = {
  calendarId: string;
  eventId: string;
  etag?: string;
  htmlLink?: string;
  ok: boolean;
};

interface CalendarEventCreateInput {
  title: string;
  sectionId: string;
  status: ItemStatus;
  allDay: boolean;
  startAt: string;
  endAt?: string;
}

type QuickAddForm = {
  title: string;
  description: string;
  type: ItemType;
  status: ItemStatus;
  sectionId: string;
  startAt: string;
  endAt: string;
  attachments: ItemAttachment[];
};

const MAX_NOTE_ATTACHMENTS = 6;
const MAX_NOTE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const STATUS_LABELS: Record<ItemStatus, string> = {
  wanted: "想要",
  active: "正在",
  paused: "搁置",
  abandoned: "放弃",
  done: "完成"
};

const TYPE_LABELS: Record<ItemType, string> = {
  idea: "想法",
  todo: "Todo",
  event: "事件",
  avoid: "不要做",
  note: "沉淀"
};

const TYPE_ORDER: ItemType[] = ["idea", "todo", "note", "avoid", "event"];
const DISPLAY_STATUS_LABELS = { ...STATUS_LABELS, history: "历史待确认" };

const STATUS_ORDER: ItemStatus[] = ["wanted", "active", "paused", "abandoned", "done"];
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SECTION_COLORS = ["#6b7280", "#276c63", "#b7532f", "#5c6f82", "#7c5c2e", "#6f4b7c", "#2f6f9f"];

export function Workspace({ initialView = "home" }: { initialView?: ViewMode }) {
  const [serverNotice, setServerNotice] = useState("正在连接服务器…");
  const [syncModeReady, setSyncModeReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [displayNow, setDisplayNow] = useState(() => new Date());
  useEffect(() => {
    const refreshTime = () => setDisplayNow(new Date());
    const timer = window.setInterval(refreshTime, 60_000);
    window.addEventListener("focus", refreshTime);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshTime); };
  }, []);
  const [sections, setSections] = useState<Section[]>([]);
  const [allSections, setAllSections] = useState<Section[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ViewMode>(initialView);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ItemDisplayStatus | "all">("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [sourcePathFilter, setSourcePathFilter] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [newSectionName, setNewSectionName] = useState("");
  const [syncNotice, setSyncNotice] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [githubSnapshotAutoSaveState, setGitHubSnapshotAutoSaveState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [googleRealtimeState, setGoogleRealtimeState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [localChangeRevision, setLocalChangeRevision] = useState(0);
  const [pendingSnapshot, setPendingSnapshot] = useState<{
    fileName: string;
    snapshot: AppSnapshot;
  } | null>(null);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<Item | null>(null);
  const [calendarCreateDay, setCalendarCreateDay] = useState<Date | null>(null);
  const autoPullGitHubSnapshotStartedRef = useRef(false);
  const [form, setForm] = useState<QuickAddForm>({
    title: "",
    description: "",
    type: "idea",
    status: "wanted",
    sectionId: "inbox",
    startAt: "",
    endAt: "",
    attachments: []
  });

  useEffect(() => {
    let stopped = false;
    const sync = async () => {
      try {
        const result = await syncServerWorkspace();
        if (!stopped) setServerNotice(result ? (result.conflicts.length ? `${result.conflicts.length} 项数据冲突待处理` : "事项已与服务器同步") : "本机模式");
      } catch (error) { if (!stopped) setServerNotice(`待同步：${error instanceof Error ? error.message : "网络不可用"}`); }
      finally { if (!stopped) { setSyncModeReady(true); await refresh(); } }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 5000);
    window.addEventListener("online", sync); window.addEventListener("focus", sync);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("online", sync); window.removeEventListener("focus", sync); };
  }, []);

  useEffect(() => {
    if (!syncModeReady || isServerMode() || !settings?.autoPullGitHubSnapshotOnStart || autoPullGitHubSnapshotStartedRef.current) return;

    autoPullGitHubSnapshotStartedRef.current = true;
    void mergeGitHubSnapshotOnStart();
  }, [syncModeReady, settings?.autoPullGitHubSnapshotOnStart]);

  useEffect(() => {
    if (!syncModeReady || isServerMode() || !settings?.autoPushGitHubSnapshotOnChange || localChangeRevision === 0) return;

    setGitHubSnapshotAutoSaveState({
      status: "loading",
      message: "GitHub 快照将在本地变更稳定后自动保存..."
    });
    const timeout = window.setTimeout(() => {
      void autoPushGitHubSnapshot();
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [localChangeRevision, settings?.autoPushGitHubSnapshotOnChange]);

  useEffect(() => {
    if (!syncModeReady || isServerMode() || !settings?.autoSyncGoogleCalendar) {
      setGoogleRealtimeState({ status: "idle" });
      return;
    }

    let stopped = false;
    let syncInFlight = false;
    let watchError: string | undefined;

    async function ensureWatch() {
      const response = await fetch("/api/google-calendar/realtime/start", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "启动 Google Calendar 实时通知失败");
      watchError = undefined;
    }

    async function synchronizeGoogleCalendar() {
      if (stopped || syncInFlight) return;
      syncInFlight = true;
      try {
        const response = await fetch("/api/google-calendar/realtime/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "sync" })
        });
        const payload = (await response.json().catch(() => ({}))) as {
          deliveryVersion?: number;
          items?: Item[];
          mode?: "full" | "incremental" | "skipped";
          error?: string;
        };
        if (!response.ok || !Array.isArray(payload.items) || !Number.isInteger(payload.deliveryVersion)) {
          throw new Error(payload.error ?? "Google Calendar 增量同步失败");
        }

        const imported = await importGoogleCalendarItems(payload.items);
        if (payload.items.length > 0) {
          const acknowledgement = await fetch("/api/google-calendar/realtime/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "ack",
              deliveryVersion: payload.deliveryVersion
            })
          });
          if (!acknowledgement.ok) throw new Error("Google Calendar 同步确认失败，将自动重试");
        }
        if (imported.importedCount > 0) await refreshAfterLocalChange();
        if (!stopped) {
          setGoogleRealtimeState({
            status: watchError ? "error" : "success",
            message: watchError
              ? `${watchError}；当前仅使用兜底增量轮询`
              : imported.importedCount > 0
                ? `已实时同步 ${imported.importedCount} 条 Google 日程`
                : "Google Calendar 实时同步运行中"
          });
        }
      } catch (error) {
        if (!stopped) {
          setGoogleRealtimeState({
            status: "error",
            message: error instanceof Error ? error.message : "Google Calendar 实时同步失败"
          });
        }
      } finally {
        syncInFlight = false;
      }
    }

    setGoogleRealtimeState({ status: "loading", message: "正在启动 Google Calendar 实时同步..." });
    void ensureWatch()
      .catch((error) => {
        watchError = error instanceof Error ? error.message : "启动 Google Calendar 实时通知失败";
        if (!stopped) {
          setGoogleRealtimeState({
            status: "error",
            message: watchError
          });
        }
      })
      .finally(() => void synchronizeGoogleCalendar());

    const syncTimer = window.setInterval(() => void synchronizeGoogleCalendar(), 5000);
    const watchTimer = window.setInterval(() => {
      void ensureWatch().catch((error) => {
        watchError = error instanceof Error ? error.message : "续订 Google Calendar 实时通知失败";
      });
    }, 6 * 60 * 60 * 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void synchronizeGoogleCalendar();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      window.clearInterval(syncTimer);
      window.clearInterval(watchTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [syncModeReady, settings?.autoSyncGoogleCalendar]);

  async function refresh() {
    await ensureSeedData();
    const [nextItems, nextSections, nextAllSections, nextSettings] = await Promise.all([
      listActiveItems(),
      listSections(),
      listAllSections(),
      getAppSettings()
    ]);
    setItems(nextItems);
    setSections(nextSections);
    setAllSections(nextAllSections);
    setSettings(nextSettings);
    if (!nextSections.some((section) => section.id === form.sectionId)) {
      setForm((current) => ({ ...current, sectionId: nextSections[0]?.id ?? "inbox" }));
    }
  }

  async function refreshAfterLocalChange() {
    setLocalChangeRevision((revision) => revision + 1);
    await refresh();
    if (isServerMode()) {
      setServerNotice("待同步…");
      try { await syncServerWorkspace(); setServerNotice("事项已与服务器同步"); await refresh(); }
      catch { setServerNotice("待同步：本机内容已保存，联网后重试"); }
    }
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isNote = form.type === "note";
    if (!isNote && !form.title.trim()) return;
    if (isNote && !form.title.trim() && !form.description.trim() && form.attachments.length === 0) return;

    const reverseTodoError = validateReverseTodoSchedule({
      type: form.type,
      startAt: form.startAt || undefined,
      endAt: form.endAt || undefined
    });
    if (reverseTodoError) {
      setSyncNotice({ status: "error", message: reverseTodoError });
      return;
    }

    const created = await createItem({
      title: noteTitle(form),
      description: form.description,
      type: form.type,
      status: form.status,
      sectionId: form.sectionId,
      attachments: form.attachments,
      startAt: form.startAt ? new Date(form.startAt).toISOString() : undefined,
      endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined
    });
    setForm((current) => {
      const nextPeriod = current.type === "avoid" ? defaultReverseTodoPeriod() : { startAt: "", endAt: "" };
      return { ...current, title: "", description: "", attachments: [], ...nextPeriod };
    });
    if (created.type === "note") {
      setSyncNotice({ status: "success", message: "已加入沉淀" });
    }
    await refreshAfterLocalChange();
  }

  async function updateItemAndWriteBack(
    item: Item,
    patch: Partial<Item>,
    options: { writeBack?: boolean } = {}
  ): Promise<boolean> {
    const updatedAt = new Date().toISOString();
    let nextItem: Item = {
      ...item,
      ...patch,
      updatedAt
    };

    if (options.writeBack !== false && canAutoWriteBackHumanSource(nextItem, patch)) {
      try {
        const sourcePath = nextItem.sourceLink.sourcePath;
        const writeBack = await writeBackHumanFileFrontmatter(nextItem, patch);
        if (writeBack.sha) {
          nextItem = {
            ...nextItem,
            sourceLink: {
              ...nextItem.sourceLink,
              sourceSha: writeBack.sha
            }
          };
        }
        setSyncNotice({
          status: "success",
          message: `已写回 ${writeBack.targetLabel} ${sourcePath}`
        });
      } catch (error) {
        setSyncNotice({
          status: "error",
          message: error instanceof Error ? error.message : "写回人工文件失败"
        });
        return false;
      }
    }
    if (!isServerMode() && canAutoWriteBackGoogleCalendar(nextItem, patch)) {
      try {
        const writeback = await writeBackGoogleCalendarEvent(nextItem);
        if (writeback.etag) {
          nextItem = {
            ...nextItem,
            sourceLink: {
              ...nextItem.sourceLink,
              etag: writeback.etag
            }
          };
        }
        setSyncNotice({
          status: "success",
          message: "已写回 Google Calendar"
        });
      } catch (error) {
        setSyncNotice({
          status: "error",
          message: error instanceof Error ? error.message : "写回 Google Calendar 失败"
        });
        return false;
      }
    }

    await updateItem(item.id, {
      ...patch,
      sourceLink: nextItem.sourceLink
    }, updatedAt);
    await refreshAfterLocalChange();
    return true;
  }

  async function createGoogleCalendarEventForItem(item: Item) {
    if (isServerMode()) {
      await syncServerWorkspace();
      await browserApi("/api/workspace", { type: "calendar_create", operationId: `calendar:${crypto.randomUUID()}`, id: item.id, expectedUpdatedAt: item.updatedAt });
      setSyncNotice({ status: "success", message: "已保存日历请求，后台确认后会在今日页显示；失败可重试。" });
      await refreshAfterLocalChange(); return;
    }
    const response = await fetch("/api/google-calendar/create-event", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ item })
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<GoogleCalendarCreateResult> & {
      error?: string;
    };

    if (!response.ok || !payload.calendarId || !payload.eventId) {
      throw new Error(payload.error ?? "创建 Google Calendar 事件失败");
    }

    await updateItem(item.id, {
      source: "google_calendar",
      sourceLink: {
        provider: "google_calendar",
        sourceId: "google-calendar",
        calendarId: payload.calendarId,
        eventId: payload.eventId,
        etag: payload.etag,
        writeBack: "none"
      },
      tags: Array.from(new Set([...item.tags, "google-calendar"]))
    });
    setSyncNotice({
      status: "success",
      message: "已创建 Google Calendar 事件"
    });
    await refreshAfterLocalChange();
  }

  async function deleteGoogleCalendarEventForItem(item: Item) {
    if (isServerMode()) return; // The owner deletion is persisted with the item, then queued on the server.
    if (item.source !== "google_calendar" || item.sourceLink?.provider !== "google_calendar") return;

    const response = await fetch("/api/google-calendar/delete-event", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ item })
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "删除 Google Calendar 事件失败");
    }
  }

  async function addSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newSectionName.trim()) return;
    await createSection(newSectionName);
    setNewSectionName("");
    await refreshAfterLocalChange();
  }

  async function saveSettings(patch: Partial<Omit<AppSettings, "id" | "createdAt">>) {
    const nextSettings = await updateAppSettings(patch);
    setSettings(nextSettings);
    setLocalChangeRevision((revision) => revision + 1);
  }

  async function setGoogleCalendarRealtimeEnabled(enabled: boolean) {
    if (isServerMode()) { setSyncNotice({ status: "success", message: "日历由服务器独立同步，连接状态请查看今日页。" }); return; }
    await saveSettings({ autoSyncGoogleCalendar: enabled });
    if (enabled) return;

    try {
      const response = await fetch("/api/google-calendar/realtime/stop", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "停止 Google Calendar 实时通知失败");
      setGoogleRealtimeState({ status: "idle" });
    } catch (error) {
      setSyncNotice({
        status: "error",
        message: error instanceof Error ? error.message : "停止 Google Calendar 实时通知失败"
      });
    }
  }

  async function saveSection(section: Section, patch: Partial<Pick<Section, "name" | "color">>) {
    await updateSection(section.id, patch);
    setEditingSection(null);
    await refreshAfterLocalChange();
  }

  async function archiveSelectedSection(section: Section) {
    await archiveSection(section.id);
    if (sectionFilter === section.id) {
      setSectionFilter("all");
    }
    setEditingSection(null);
    await refreshAfterLocalChange();
  }

  async function confirmDeleteItem(item: Item) {
    try {
      if (item.source === "google_calendar") {
        await deleteGoogleCalendarEventForItem(item);
      }
      await softDeleteItem(item.id);
      if (selectedItemId === item.id) {
        setSelectedItemId(null);
      }
      setPendingDeleteItem(null);
      setSyncNotice({
        status: "success",
        message: item.source === "google_calendar" ? "已删除本地事项和 Google Calendar 事件" : "已删除事项"
      });
      await refreshAfterLocalChange();
    } catch (error) {
      setPendingDeleteItem(null);
      setSyncNotice({
        status: "error",
        message: error instanceof Error ? error.message : "删除事项失败"
      });
    }
  }

  async function exportData() {
    const snapshot = await exportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `todotodolist-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function selectSnapshotFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const snapshot = validateSnapshot(parsed);
      setPendingSnapshot({ fileName: file.name, snapshot });
      setSyncNotice(null);
    } catch (error) {
      setSyncNotice({
        status: "error",
        message: error instanceof Error ? error.message : "导入 JSON 失败"
      });
    } finally {
      event.currentTarget.value = "";
    }
  }

  async function restoreSnapshot(mode: SnapshotImportMode) {
    if (!pendingSnapshot) return;

    try {
      const snapshot = await importSnapshot(pendingSnapshot.snapshot, { mode });
      setPendingSnapshot(null);
      setSelectedItemId(null);
      setSourcePathFilter(null);
      await refreshAfterLocalChange();
      setSyncNotice({
        status: "success",
        message:
          mode === "replace"
            ? `已从 ${pendingSnapshot.fileName} 覆盖恢复 ${snapshot.items.length} 条事项`
            : `已从 ${pendingSnapshot.fileName} 合并 ${snapshot.items.length} 条事项`
      });
    } catch (error) {
      setSyncNotice({
        status: "error",
        message: error instanceof Error ? error.message : "导入 JSON 失败"
      });
    }
  }

  async function pushGitHubSnapshot(): Promise<string> {
    const snapshot = await exportSnapshot();
    const response = await fetch("/api/github/snapshot", {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ snapshot })
    });
    const payload = (await response.json().catch(() => ({}))) as {
      sourcePath?: string;
      itemCount?: number;
      mergeSummary?: {
        remoteItemsKept?: number;
        remoteSectionsKept?: number;
        remoteSettingsKept?: number;
      };
      snapshot?: unknown;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "上传 GitHub 快照失败");
    }

    if (payload.snapshot) {
      await importSnapshot(validateSnapshot(payload.snapshot), { mode: "merge" });
      await refresh();
    }

    return snapshotSaveMessage(payload, snapshot.items.length);
  }

  async function autoPushGitHubSnapshot() {
    setGitHubSnapshotAutoSaveState({
      status: "loading",
      message: "正在自动保存 GitHub 快照..."
    });
    try {
      const message = await pushGitHubSnapshot();
      setGitHubSnapshotAutoSaveState({
        status: "success",
        message: message.replace(/^已保存/, "已自动保存")
      });
    } catch (error) {
      setGitHubSnapshotAutoSaveState({
        status: "error",
        message: error instanceof Error ? error.message : "自动保存 GitHub 快照失败"
      });
    }
  }

  async function pullGitHubSnapshot(): Promise<string> {
    const { sourcePath, snapshot } = await readGitHubSnapshot();
    setPendingSnapshot({
      fileName: sourcePath,
      snapshot
    });
    setSyncNotice(null);
    return `已读取 ${sourcePath}，请选择合并或覆盖恢复。`;
  }

  async function readGitHubSnapshot(): Promise<{ sourcePath: string; snapshot: AppSnapshot }> {
    const response = await fetch("/api/github/snapshot");
    const payload = (await response.json().catch(() => ({}))) as {
      sourcePath?: string;
      snapshot?: unknown;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "读取 GitHub 快照失败");
    }

    return {
      sourcePath: payload.sourcePath ?? "GitHub snapshot",
      snapshot: validateSnapshot(payload.snapshot)
    };
  }

  async function mergeGitHubSnapshotOnStart() {
    try {
      const { sourcePath, snapshot } = await readGitHubSnapshot();
      const imported = await importSnapshot(snapshot, { mode: "merge" });
      setPendingSnapshot(null);
      setSelectedItemId(null);
      setSourcePathFilter(null);
      await refresh();
      setSyncNotice({
        status: "success",
        message: `启动时已从 ${sourcePath} 合并 ${imported.items.length} 条事项`
      });
    } catch (error) {
      setSyncNotice({
        status: "error",
        message: error instanceof Error ? error.message : "启动时合并 GitHub 快照失败"
      });
    }
  }

  async function createCalendarEvent(input: CalendarEventCreateInput) {
    const created = await createItem({
      title: input.title,
      type: "event",
      status: input.status,
      sectionId: input.sectionId,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay
    });
    setCalendarCreateDay(null);
    setSelectedItemId(created.id);
    await refreshAfterLocalChange();
  }

  async function logout() {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_CACHE" });
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  const sectionMap = useMemo(
    () => new Map(allSections.map((section) => [section.id, section])),
    [allSections]
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesQuery =
        !query.trim() ||
        `${item.title} ${item.description} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
      const matchesSection = sectionFilter === "all" || item.sectionId === sectionFilter;
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      const matchesStatus = statusFilter === "all" || itemDisplayStatus(item, displayNow) === statusFilter;
      const matchesTime =
        timeFilter === "all" ||
        (timeFilter === "scheduled" && Boolean(item.startAt)) ||
        (timeFilter === "unscheduled" && !item.startAt);
      const matchesSourcePath = !sourcePathFilter || item.sourceLink?.sourcePath === sourcePathFilter;
      return matchesQuery && matchesSection && matchesType && matchesStatus && matchesTime && matchesSourcePath;
    });
  }, [items, query, sectionFilter, sourcePathFilter, statusFilter, timeFilter, typeFilter, displayNow]);

  const regularItems = filteredItems.filter((item) => item.type !== "avoid" && item.type !== "note");
  const inboxItems = regularItems.filter((item) => item.sectionId === "inbox");
  const activeItems = regularItems.filter((item) => itemDisplayStatus(item, displayNow) === "active");
  const historyItems = regularItems.filter((item) => itemDisplayStatus(item, displayNow) === "history");
  const reverseTodoItems = filteredItems.filter(isOpenReverseTodo);
  const noteItems = filteredItems.filter((item) => item.type === "note");
  const todayItems = regularItems.filter(isTodayItem);
  const timedItems = filteredItems.filter((item) => item.startAt);
  const calendarItems = timedItems.filter((item) => {
    if (item.status === "abandoned") return false;
    if (item.status === "done" && !settings?.showDoneInCalendar) return false;
    return true;
  });
  const boardItems = filteredItems.filter(
    (item) => item.type !== "note" && (settings?.showAbandonedInBoard || item.status !== "abandoned")
  );
  const sourceSummaries = useMemo(() => summarizeSourceFiles(items), [items]);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId && !item.deletedAt) ?? null,
    [items, selectedItemId]
  );

  function changeView(nextView: ViewMode) {
    setView(nextView);
    setMobileToolsOpen(false);

    const url = new URL(window.location.href);
    if (nextView === "home") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", nextView);
    }
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="brand-mark">TodoTodoList</p>
            <h1>想法、Todo、日程</h1>
          </div>
          <button
            aria-controls="sidebar-tools"
            aria-expanded={mobileToolsOpen}
            className={`mobile-tools-toggle ${mobileToolsOpen ? "active" : ""}`}
            type="button"
            onClick={() => setMobileToolsOpen((open) => !open)}
          >
            <Settings size={17} />
            版块与设置
          </button>
        </div>

        <nav className="nav-list" aria-label="主导航">
          <NavButton active={view === "home"} icon={<Inbox size={17} />} label="首页" onClick={() => changeView("home")} />
          <NavButton
            active={view === "notes"}
            icon={<NotebookPen size={17} />}
            label="沉淀"
            onClick={() => {
              setTypeFilter("all");
              setStatusFilter("all");
              setTimeFilter("all");
              changeView("notes");
            }}
          />
          <NavButton active={view === "list"} icon={<ClipboardList size={17} />} label="全部" onClick={() => changeView("list")} />
          <NavButton active={view === "board"} icon={<LayoutDashboard size={17} />} label="看板" onClick={() => changeView("board")} />
          <NavButton active={view === "calendar"} icon={<CalendarDays size={17} />} label="日历" onClick={() => changeView("calendar")} />
          <NavButton active={view === "sync"} icon={<GitBranch size={17} />} label="同步" onClick={() => changeView("sync")} />
          <a className="nav-link" href="/today"><CalendarDays size={17} />今日与执行反馈</a>
          <a className="nav-link" href="/review"><NotebookPen size={17} />提醒与回顾</a>
        </nav>

        <div className={`sidebar-tools ${mobileToolsOpen ? "open" : ""}`} id="sidebar-tools">
          <nav className="mobile-tools-nav" aria-label="更多视图">
            <NavButton active={view === "list"} icon={<ClipboardList size={17} />} label="全部事项" onClick={() => changeView("list")} />
            <NavButton active={view === "notes"} icon={<NotebookPen size={17} />} label="沉淀" onClick={() => {
              setTypeFilter("all"); setStatusFilter("all"); setTimeFilter("all"); changeView("notes");
            }} />
            <NavButton active={view === "board"} icon={<LayoutDashboard size={17} />} label="看板" onClick={() => changeView("board")} />
            <NavButton active={view === "sync"} icon={<GitBranch size={17} />} label="同步" onClick={() => changeView("sync")} />
          </nav>
          <section className="side-section">
            <div className="side-title">版块</div>
            {sections.map((section) => (
              <div className="section-row" key={section.id}>
                <button
                  className={`section-chip ${sectionFilter === section.id ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSectionFilter(section.id);
                    setMobileToolsOpen(false);
                  }}
                >
                  <span style={{ background: section.color }} />
                  {section.name}
                </button>
                <button
                  className="section-edit-button"
                  type="button"
                  title="编辑版块"
                  onClick={() => setEditingSection(section)}
                >
                  <Settings size={14} />
                </button>
              </div>
            ))}
            <button className="section-chip" type="button" onClick={() => {
              setSectionFilter("all");
              setMobileToolsOpen(false);
            }}>
              <span />
              全部
            </button>
            <form className="add-section" onSubmit={addSection}>
              <input
                aria-label="新增版块"
                placeholder="新增版块"
                value={newSectionName}
                onChange={(event) => setNewSectionName(event.target.value)}
              />
              <button type="submit" title="新增版块">
                <Plus size={16} />
              </button>
            </form>
          </section>

          <section className="side-section">
            <div className="side-title">视图设置</div>
            <label className="side-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings?.showDoneInCalendar)}
                onChange={(event) => void saveSettings({ showDoneInCalendar: event.target.checked })}
              />
              日历显示完成
            </label>
            <label className="side-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings?.showAbandonedInBoard)}
                onChange={(event) => void saveSettings({ showAbandonedInBoard: event.target.checked })}
              />
              看板显示放弃
            </label>
            <label className="side-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings?.autoPullGitHubSnapshotOnStart)}
                onChange={(event) => void saveSettings({ autoPullGitHubSnapshotOnStart: event.target.checked })}
              />
              启动合并 GitHub 快照
            </label>
            <label className="side-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings?.autoPushGitHubSnapshotOnChange)}
                onChange={(event) => void saveSettings({ autoPushGitHubSnapshotOnChange: event.target.checked })}
              />
              变更后保存 GitHub 快照
            </label>
            <label className="side-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings?.autoSyncGoogleCalendar)}
                onChange={(event) => void setGoogleCalendarRealtimeEnabled(event.target.checked)}
              />
              Google 日历实时同步
            </label>
            {googleRealtimeState.message ? (
              <p className={`sync-message ${googleRealtimeState.status}`}>
                {googleRealtimeState.message}
              </p>
            ) : null}
            {githubSnapshotAutoSaveState.message ? (
              <p className={`sync-message ${githubSnapshotAutoSaveState.status}`}>
                {githubSnapshotAutoSaveState.message}
              </p>
            ) : null}
          </section>

          <button className="nav-link sidebar-logout" type="button" onClick={() => void logout()}>
            <LogOut size={17} />
            退出工作台
          </button>
        </div>
      </aside>

      {/* Keep the fixed navigation outside the sidebar's backdrop-filter containing block. */}
      <nav className="mobile-bottom-nav" aria-label="手机主导航">
        <NavButton active={view === "home"} icon={<Inbox size={19} />} label="首页" onClick={() => changeView("home")} />
        <a className="nav-link" href="/today"><Check size={19} />今日</a>
        <NavButton active={view === "calendar"} icon={<CalendarDays size={19} />} label="日历" onClick={() => changeView("calendar")} />
        <a className="nav-link" href="/review"><NotebookPen size={19} />回顾</a>
        <button className={`nav-link ${mobileToolsOpen || !["home", "calendar"].includes(view) ? "active" : ""}`}
          type="button" aria-controls="sidebar-tools" aria-expanded={mobileToolsOpen}
          onClick={() => setMobileToolsOpen((open) => !open)}><MoreHorizontal size={19} />更多</button>
      </nav>

      <section className="workspace">
        <div className="workspace-sync-status" role="status">
          <span>{serverNotice}</span><a href="/today">查看同步详情<ChevronRight size={14} /></a>
        </div>
        <header className={`topbar ${mobileFiltersOpen ? "filters-open" : ""}`}>
          <div className="searchbox">
            <Search size={17} />
            <input
              aria-label="搜索事项"
              placeholder="搜索标题、描述、标签"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button
            aria-expanded={mobileFiltersOpen}
            className="mobile-filter-toggle"
            type="button"
            onClick={() => setMobileFiltersOpen((open) => !open)}
          >
            <Settings size={17} />
            筛选
          </button>
          <div className="topbar-controls">
            <select
              aria-label="类型过滤"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as ItemType | "all")}
            >
              <option value="all">全部类型</option>
              {TYPE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <select
              aria-label="状态过滤"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ItemDisplayStatus | "all")}
            >
              <option value="all">全部状态</option>
              <option value="history">历史待确认</option>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <select
              aria-label="时间过滤"
              value={timeFilter}
              onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
            >
              <option value="all">全部时间</option>
              <option value="scheduled">有时间</option>
              <option value="unscheduled">无时间</option>
            </select>
            <button className="icon-button" type="button" title="刷新" onClick={() => void refresh()}>
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" type="button" title="导出 JSON" onClick={() => void exportData()}>
              <Download size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="导入 JSON"
              onClick={() => snapshotInputRef.current?.click()}
            >
              <Upload size={18} />
            </button>
            <input
              ref={snapshotInputRef}
              aria-label="导入 JSON 快照"
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void selectSnapshotFile(event)}
            />
          </div>
        </header>

        {syncNotice ? (
          <div className={`workspace-notice ${syncNotice.status}`} role="status">
            <span>{syncNotice.message}</span>
            <button type="button" onClick={() => setSyncNotice(null)} title="关闭提示">
              <X size={14} />
            </button>
          </div>
        ) : null}

        <QuickAdd form={form} sections={sections} setForm={setForm} onSubmit={submitItem} />

        {view === "home" ? (
          <HomeView
            inboxItems={inboxItems}
            todayItems={todayItems}
            activeItems={activeItems}
            historyItems={historyItems}
            reverseTodoItems={reverseTodoItems}
            sectionMap={sectionMap}
            onOpenItem={setSelectedItemId}
            onStatusChange={async (item, status) => {
              await updateItemAndWriteBack(item, { status });
            }}
            onDelete={async (item) => setPendingDeleteItem(item)}
          />
        ) : null}

        {view === "notes" ? (
          <NotesView
            items={noteItems}
            sectionMap={sectionMap}
            onOpenItem={setSelectedItemId}
          />
        ) : null}

        {view === "list" ? (
          <ListView
            items={filteredItems}
            sectionMap={sectionMap}
            sourcePathFilter={sourcePathFilter}
            onClearSourcePath={() => setSourcePathFilter(null)}
            onOpenItem={setSelectedItemId}
            onStatusChange={async (item, status) => {
              await updateItemAndWriteBack(item, { status });
            }}
            onDelete={async (item) => setPendingDeleteItem(item)}
          />
        ) : null}

        {view === "board" ? (
          <BoardView
            items={boardItems}
            sectionMap={sectionMap}
            showAbandoned={Boolean(settings?.showAbandonedInBoard)}
            onOpenItem={setSelectedItemId}
            onStatusChange={async (item, status) => {
              await updateItemAndWriteBack(item, { status });
            }}
          />
        ) : null}

        {view === "calendar" ? (
          <CalendarView
            items={calendarItems}
            sectionMap={sectionMap}
            onCreateEvent={(day) => setCalendarCreateDay(day)}
            onOpenItem={setSelectedItemId}
            onScheduleChange={async (item, patch) => {
              await updateItemAndWriteBack(item, patch);
            }}
          />
        ) : null}

        {view === "sync" ? (
          <SyncView
            sections={sections}
            summaries={sourceSummaries}
            onPullGitHubSnapshot={pullGitHubSnapshot}
            onPushGitHubSnapshot={pushGitHubSnapshot}
            onImported={refreshAfterLocalChange}
            onOpenSource={(sourcePath) => {
              setSourcePathFilter(sourcePath);
              setSectionFilter("all");
              setStatusFilter("all");
              setTypeFilter("all");
              setTimeFilter("all");
              setQuery("");
              changeView("list");
            }}
          />
        ) : null}
      </section>

      {selectedItem ? (
        <ItemDetailDrawer
          item={selectedItem}
          sections={sections}
          sectionMap={sectionMap}
          onClose={() => setSelectedItemId(null)}
          onStatusChange={async (status) => {
            return updateItemAndWriteBack(selectedItem, { status });
          }}
          onSave={async (patch, options) => {
            return updateItemAndWriteBack(selectedItem, patch, options);
          }}
          onCreateGoogleCalendarEvent={createGoogleCalendarEventForItem}
          onDelete={async () => setPendingDeleteItem(selectedItem)}
        />
      ) : null}

      {pendingSnapshot ? (
        <SnapshotImportDialog
          fileName={pendingSnapshot.fileName}
          snapshot={pendingSnapshot.snapshot}
          onCancel={() => setPendingSnapshot(null)}
          onImport={(mode) => void restoreSnapshot(mode)}
        />
      ) : null}

      {editingSection ? (
        <SectionEditDialog
          section={editingSection}
          onArchive={() => void archiveSelectedSection(editingSection)}
          onCancel={() => setEditingSection(null)}
          onSave={(patch) => void saveSection(editingSection, patch)}
        />
      ) : null}

      {pendingDeleteItem ? (
        <DeleteItemDialog
          item={pendingDeleteItem}
          sectionMap={sectionMap}
          onCancel={() => setPendingDeleteItem(null)}
          onConfirm={() => void confirmDeleteItem(pendingDeleteItem)}
        />
      ) : null}

      {calendarCreateDay ? (
        <CalendarCreateEventDialog
          day={calendarCreateDay}
          defaultSectionId={sectionFilter === "all" ? form.sectionId : sectionFilter}
          sections={sections}
          onCancel={() => setCalendarCreateDay(null)}
          onCreate={(input) => void createCalendarEvent(input)}
        />
      ) : null}
    </main>
  );
}

function SnapshotImportDialog({
  fileName,
  snapshot,
  onCancel,
  onImport
}: {
  fileName: string;
  snapshot: AppSnapshot;
  onCancel: () => void;
  onImport: (mode: SnapshotImportMode) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="snapshot-import-title"
        aria-modal="true"
        className="snapshot-dialog"
        role="dialog"
      >
        <header>
          <h2 id="snapshot-import-title">导入 JSON 快照</h2>
          <button className="icon-button compact" type="button" title="取消导入" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="snapshot-summary">
          <div>
            <span>文件</span>
            <strong>{fileName}</strong>
          </div>
          <div>
            <span>导出时间</span>
            <strong>{formatDateTime(snapshot.exportedAt)}</strong>
          </div>
          <div>
            <span>事项</span>
            <strong>{snapshot.items.length}</strong>
          </div>
          <div>
            <span>版块</span>
            <strong>{snapshot.sections.length}</strong>
          </div>
          <div>
            <span>设置</span>
            <strong>{snapshot.settings.length}</strong>
          </div>
          <div>
            <span>同步元数据</span>
            <strong>{snapshot.syncMetadata.length}</strong>
          </div>
        </div>
        <p className="snapshot-warning">
          覆盖会先清空本地缓存再恢复快照；合并会按 updatedAt 保留较新的同 ID 数据。
        </p>
        <footer className="snapshot-actions">
          <button className="button ghost" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button secondary" type="button" onClick={() => onImport("merge")}>
            合并较新数据
          </button>
          <button className="button danger-button" type="button" onClick={() => onImport("replace")}>
            覆盖本地
          </button>
        </footer>
      </section>
    </div>
  );
}

function SectionEditDialog({
  section,
  onArchive,
  onCancel,
  onSave
}: {
  section: Section;
  onArchive: () => void;
  onCancel: () => void;
  onSave: (patch: Partial<Pick<Section, "name" | "color">>) => void;
}) {
  const [draft, setDraft] = useState({
    name: section.name,
    color: section.color
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) return;
    onSave({
      name: draft.name,
      color: draft.color
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        aria-labelledby="section-edit-title"
        aria-modal="true"
        className="section-dialog"
        role="dialog"
        onSubmit={submit}
      >
        <header>
          <h2 id="section-edit-title">编辑版块</h2>
          <button className="icon-button compact" type="button" title="取消" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <label>
          名称
          <input
            autoFocus
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <div className="color-picker-field">
          <span>颜色</span>
          <div className="color-swatch-row" role="list" aria-label="版块颜色">
            {SECTION_COLORS.map((color) => (
              <button
                aria-label={color}
                aria-pressed={draft.color === color}
                className={`color-swatch ${draft.color === color ? "active" : ""}`}
                key={color}
                style={{ background: color }}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, color }))}
              />
            ))}
            <input
              aria-label="自定义颜色"
              type="color"
              value={draft.color}
              onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
            />
          </div>
        </div>
        <footer className="dialog-footer split">
          <div>
            {!section.isInbox ? (
              <button className="button danger-button" type="button" onClick={onArchive}>
                归档版块
              </button>
            ) : null}
          </div>
          <div className="dialog-actions">
            <button className="button ghost" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="button" type="submit" disabled={!draft.name.trim()}>
              保存
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function DeleteItemDialog({
  item,
  sectionMap,
  onCancel,
  onConfirm
}: {
  item: Item;
  sectionMap: Map<string, Section>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="delete-item-title"
        aria-modal="true"
        className="delete-dialog"
        role="dialog"
      >
        <header>
          <h2 id="delete-item-title">删除事项</h2>
          <button className="icon-button compact" type="button" title="取消" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="delete-dialog-body">
          <ItemMeta item={item} sectionMap={sectionMap} />
          <strong>{item.title || "未命名事项"}</strong>
          <p>删除后会从默认视图隐藏，并保留删除标记用于后续同步。</p>
        </div>
        <footer className="dialog-actions">
          <button className="button ghost" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button danger-button" type="button" onClick={onConfirm}>
            确认删除
          </button>
        </footer>
      </section>
    </div>
  );
}

function CalendarCreateEventDialog({
  day,
  defaultSectionId,
  sections,
  onCancel,
  onCreate
}: {
  day: Date;
  defaultSectionId: string;
  sections: Section[];
  onCancel: () => void;
  onCreate: (input: CalendarEventCreateInput) => void;
}) {
  const defaultSection = sections.some((section) => section.id === defaultSectionId)
    ? defaultSectionId
    : sections[0]?.id ?? "inbox";
  const [draft, setDraft] = useState({
    title: "",
    sectionId: defaultSection,
    status: "active" as ItemStatus,
    allDay: false,
    startAt: dateTimeLocalForDay(day, 9),
    endAt: dateTimeLocalForDay(day, 10),
    startDate: localDateKey(day),
    endDate: localDateKey(day)
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim()) return;

    const startAt = draft.allDay
      ? isoFromLocalDateInput(draft.startDate)
      : isoFromDateTimeLocal(draft.startAt);
    const rawEndAt = draft.allDay
      ? isoFromLocalDateInput(draft.endDate || draft.startDate)
      : isoFromDateTimeLocal(draft.endAt);

    if (!startAt) return;
    const endAt = rawEndAt && rawEndAt >= startAt ? rawEndAt : startAt;

    onCreate({
      title: draft.title.trim(),
      sectionId: draft.sectionId,
      status: draft.status,
      allDay: draft.allDay,
      startAt,
      endAt
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        aria-labelledby="calendar-create-title"
        aria-modal="true"
        className="calendar-event-dialog"
        role="dialog"
        onSubmit={submit}
      >
        <header>
          <h2 id="calendar-create-title">新建日程</h2>
          <button className="icon-button compact" type="button" title="取消" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <label>
          标题
          <input
            autoFocus
            placeholder="输入日程标题"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <div className="dialog-grid">
          <label>
            版块
            <select
              value={draft.sectionId}
              onChange={(event) => setDraft((current) => ({ ...current, sectionId: event.target.value }))}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={draft.status}
              onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ItemStatus }))}
            >
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(event) => setDraft((current) => ({ ...current, allDay: event.target.checked }))}
          />
          全天
        </label>
        {draft.allDay ? (
          <div className="dialog-grid">
            <label>
              开始日期
              <input
                type="date"
                value={draft.startDate}
                onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                value={draft.endDate}
                onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))}
              />
            </label>
          </div>
        ) : (
          <div className="dialog-grid">
            <label>
              开始时间
              <input
                type="datetime-local"
                value={draft.startAt}
                onChange={(event) => setDraft((current) => ({ ...current, startAt: event.target.value }))}
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                value={draft.endAt}
                onChange={(event) => setDraft((current) => ({ ...current, endAt: event.target.value }))}
              />
            </label>
          </div>
        )}
        <footer className="snapshot-actions">
          <button className="button ghost" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button" type="submit" disabled={!draft.title.trim()}>
            创建
          </button>
        </footer>
      </form>
    </div>
  );
}

function canAutoWriteBackHumanSource(item: Item, patch: Partial<Item>): item is Item & {
  sourceLink: NonNullable<Item["sourceLink"]>;
} {
  return (
    item.source === "github" &&
    item.sourceLink?.provider === "github" &&
    item.sourceLink.writeBack !== "none" &&
    hasFrontmatterPatchField(patch)
  );
}

function canAutoWriteBackGoogleCalendar(item: Item, patch: Partial<Item>): item is Item & {
  sourceLink: NonNullable<Item["sourceLink"]>;
} {
  return (
    item.source === "google_calendar" &&
    item.sourceLink?.provider === "google_calendar" &&
    Boolean(item.sourceLink.calendarId) &&
    Boolean(item.sourceLink.eventId) &&
    (hasPatchField(patch, "title") ||
      hasPatchField(patch, "startAt") ||
      hasPatchField(patch, "endAt") ||
      hasPatchField(patch, "allDay") ||
      hasPatchField(patch, "description"))
  );
}

function draftTypeCanSyncToGoogle(type: ItemType): boolean {
  return type === "event" || type === "todo";
}

async function writeBackHumanFileFrontmatter(
  item: Item & { sourceLink: NonNullable<Item["sourceLink"]> },
  changedPatch: Partial<Item>
): Promise<{ sha?: string; targetLabel: string }> {
  if (item.sourceLink.writeBack === "none") {
    throw new Error("该人工文件源不允许写回");
  }
  if (item.sourceLink.provider !== "github") {
    throw new Error("只有 GitHub 人工文件源支持 frontmatter 写回");
  }
  if (!item.sourceLink.sourcePath) {
    throw new Error("Git 来源事项缺少 sourcePath");
  }

  const target = humanFileWriteBackTarget(item.sourceLink);
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sourcePath: item.sourceLink.sourcePath,
      expectedSha: item.sourceLink.sourceSha,
      patch: frontmatterPatchFromItemState(item, changedPatch)
    })
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; sha?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? `写回${target.label}失败`);
  }

  return {
    sha: payload.sha,
    targetLabel: target.label
  };
}

async function writeBackGoogleCalendarEvent(item: Item) {
  const response = await fetch("/api/google-calendar/writeback-event", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ item })
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; etag?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "写回 Google Calendar 失败");
  }

  return payload;
}

function frontmatterPatchFromItemState(item: Item, changedPatch: Partial<Item>) {
  const patch: {
    id: string;
    type?: ItemType;
    status?: ItemStatus;
    section?: string;
    title?: string;
    tags?: string[];
    startAt?: string | null;
    endAt?: string | null;
    allDay?: boolean;
    updatedAt: string;
  } = {
    id: item.id,
    updatedAt: item.updatedAt
  };

  if (hasPatchField(changedPatch, "type")) patch.type = item.type;
  if (hasPatchField(changedPatch, "status")) patch.status = item.status;
  if (hasPatchField(changedPatch, "sectionId")) patch.section = item.sectionId;
  if (hasPatchField(changedPatch, "title")) patch.title = item.title;
  if (hasPatchField(changedPatch, "tags")) patch.tags = item.tags;
  if (hasPatchField(changedPatch, "startAt")) patch.startAt = item.startAt ?? null;
  if (hasPatchField(changedPatch, "endAt")) patch.endAt = item.endAt ?? null;
  if (hasPatchField(changedPatch, "allDay")) patch.allDay = item.allDay;

  return patch;
}

function hasPatchField(patch: Partial<Item>, field: keyof Item): boolean {
  return Object.prototype.hasOwnProperty.call(patch, field);
}

function hasFrontmatterPatchField(patch: Partial<Item>): boolean {
  return (
    hasPatchField(patch, "title") ||
    hasPatchField(patch, "type") ||
    hasPatchField(patch, "status") ||
    hasPatchField(patch, "sectionId") ||
    hasPatchField(patch, "tags") ||
    hasPatchField(patch, "startAt") ||
    hasPatchField(patch, "endAt") ||
    hasPatchField(patch, "allDay")
  );
}

function humanFileWriteBackTarget(sourceLink: NonNullable<Item["sourceLink"]>): {
  label: string;
  url: string;
} {
  if (sourceLink.sourceSha) {
    return {
      label: "GitHub",
      url: "/api/github/writeback-human-file"
    };
  }

  return {
    label: "本地 Git",
    url: "/api/local-git/writeback-human-file"
  };
}

function NavButton(props: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`nav-link ${props.active ? "active" : ""}`} type="button" aria-current={props.active ? "page" : undefined} onClick={props.onClick}>
      {props.icon}
      {props.label}
    </button>
  );
}

function QuickAdd({
  form,
  sections,
  setForm,
  onSubmit
}: {
  form: QuickAddForm;
  sections: Section[];
  setForm: Dispatch<SetStateAction<QuickAddForm>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const isReverseTodo = form.type === "avoid";
  const isNote = form.type === "note";

  function selectType(type: ItemType) {
    setForm((current) => {
      if (type === "avoid" && current.type !== "avoid") {
        const period = defaultReverseTodoPeriod();
        return {
          ...current,
          type,
          status: "active",
          description: "",
          attachments: [],
          startAt: current.startAt || period.startAt,
          endAt: period.endAt
        };
      }
      if (type === "note") {
        return {
          ...current,
          type,
          status: "wanted",
          startAt: "",
          endAt: ""
        };
      }
      return {
        ...current,
        type,
        description: current.type === "note" ? "" : current.description,
        attachments: current.type === "note" ? [] : current.attachments,
        endAt: ""
      };
    });
    setAttachmentError(null);
    if (type === "avoid" || type === "note") setOptionsOpen(true);
  }

  async function appendAttachments(files: File[]) {
    if (!files.length) return;
    try {
      const remaining = MAX_NOTE_ATTACHMENTS - form.attachments.length;
      if (remaining <= 0) throw new Error(`最多添加 ${MAX_NOTE_ATTACHMENTS} 张截图`);
      const attachments = await imageAttachmentsFromFiles(files, remaining);
      setForm((current) => ({
        ...current,
        attachments: [...current.attachments, ...attachments].slice(0, MAX_NOTE_ATTACHMENTS)
      }));
      setAttachmentError(files.length > remaining ? `最多保留 ${MAX_NOTE_ATTACHMENTS} 张截图` : null);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "读取截图失败");
    }
  }

  function handlePaste(event: ReactClipboardEvent<HTMLFormElement>) {
    if (!isNote) return;
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!imageFiles.length) return;
    event.preventDefault();
    void appendAttachments(imageFiles);
  }

  return (
    <form
      className={`quick-add ${isReverseTodo ? "reverse-mode" : ""} ${isNote ? "note-mode" : ""}`}
      onPaste={handlePaste}
      onSubmit={onSubmit}
    >
      <div className="quick-add-main">
        <input
          aria-label="快速新增"
          placeholder={isReverseTodo
            ? "这段时间决定不做什么？"
            : isNote
              ? "沉淀一个片段，可只写内容或粘贴截图"
              : "记录一个想法、Todo 或事件"}
          value={form.title}
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
        />
        <button className="primary-button" type="submit">
          {isReverseTodo ? <Ban size={16} /> : isNote ? <NotebookPen size={16} /> : <Plus size={16} />}
          {isReverseTodo ? "立下约定" : isNote ? "沉淀" : "新增"}
        </button>
      </div>
      <button
        aria-expanded={optionsOpen}
        className="quick-add-options-toggle"
        type="button"
        onClick={() => setOptionsOpen((open) => !open)}
      >
        <Settings size={15} />
        {optionsOpen ? "收起选项" : "类型、状态、版块与时间"}
      </button>
      <div className={`quick-add-options ${optionsOpen ? "open" : ""}`}>
        <div className="quick-add-fields">
          <select
            aria-label="类型"
            className="quick-add-type"
            value={form.type}
            onChange={(event) => selectType(event.target.value as ItemType)}
          >
            {TYPE_ORDER.map((type) => (
              <option key={type} value={type}>{TYPE_LABELS[type]}</option>
            ))}
          </select>
          <select
            aria-label="状态"
            className="quick-add-status"
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ItemStatus }))}
          >
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <select
            aria-label="版块"
            className="quick-add-section"
            value={form.sectionId}
            onChange={(event) => setForm((current) => ({ ...current, sectionId: event.target.value }))}
          >
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
          {!isReverseTodo && !isNote ? (
            <input
              aria-label="时间"
              className="quick-add-start"
              type="datetime-local"
              value={form.startAt}
              onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))}
            />
          ) : null}
          {isReverseTodo ? (
            <div className="reverse-period-fields">
              <div className="reverse-period-intro">
                <Ban size={17} />
                <span><strong>反向待办时段</strong> 在这段时间里，明确守住一件“不做的事”。</span>
              </div>
              <label>
                从
                <input
                  aria-label="反向待办开始时间"
                  required
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))}
                />
              </label>
              <label>
                到
                <input
                  aria-label="反向待办结束时间"
                  min={form.startAt || undefined}
                  required
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(event) => setForm((current) => ({ ...current, endAt: event.target.value }))}
                />
              </label>
            </div>
          ) : null}
          {isNote ? (
            <div className="note-capture-fields">
              <textarea
                aria-label="沉淀内容"
                placeholder="写下零碎记录、灵感、上下文……也可以直接粘贴剪贴板中的截图。"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
              <div className="note-attachment-tools">
                <label className="note-upload-button">
                  <ImagePlus size={16} />
                  添加截图
                  <input
                    className="visually-hidden"
                    type="file"
                    accept={SUPPORTED_CAPTURE_IMAGE_TYPES.join(",")}
                    multiple
                    onChange={(event) => {
                      void appendAttachments(Array.from(event.currentTarget.files ?? []));
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <span>支持选择或直接粘贴，单张不超过 5 MB，最多 {MAX_NOTE_ATTACHMENTS} 张。</span>
                {attachmentError ? <span className="note-attachment-error">{attachmentError}</span> : null}
              </div>
              {form.attachments.length ? (
                <div className="note-attachment-preview" aria-label="待保存截图">
                  {form.attachments.map((attachment) => (
                    <figure key={attachment.id}>
                      <img src={attachment.dataUrl} alt={attachment.name} />
                      <button
                        type="button"
                        title="移除截图"
                        onClick={() => setForm((current) => ({
                          ...current,
                          attachments: current.attachments.filter((candidate) => candidate.id !== attachment.id)
                        }))}
                      >
                        <X size={13} />
                      </button>
                    </figure>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function HomeView({
  historyItems,
  inboxItems,
  todayItems,
  activeItems,
  reverseTodoItems,
  sectionMap,
  onOpenItem,
  onStatusChange,
  onDelete
}: {
  inboxItems: Item[];
  todayItems: Item[];
  activeItems: Item[];
  historyItems: Item[];
  reverseTodoItems: Item[];
  sectionMap: Map<string, Section>;
  onOpenItem: (itemId: string) => void;
  onStatusChange: (item: Item, status: ItemStatus) => Promise<void>;
  onDelete: (item: Item) => Promise<void>;
}) {
  return (
    <div className="home-view">
      <section className="home-overview" aria-label="今日概览">
        <div>
          <p className="eyebrow">Today</p>
          <h2>今天先做重要的事</h2>
          <p>主页优先呈现今天与正在推进的事项；导航、版块和设置已收进次级入口。</p>
        </div>
        <dl className="home-metrics">
          <div>
            <dt>今日</dt>
            <dd>{todayItems.length}</dd>
          </div>
          <div>
            <dt>正在</dt>
            <dd>{activeItems.length}</dd>
          </div>
          <div>
            <dt>收集箱</dt>
            <dd>{inboxItems.length}</dd>
          </div>
        </dl>
      </section>
      <div className="home-grid">
        <ItemColumn className="home-column-priority" title="今日" icon={<CalendarDays size={18} />} items={todayItems} sectionMap={sectionMap} onOpenItem={onOpenItem} onStatusChange={onStatusChange} onDelete={onDelete} />
        <ItemColumn title="正在" icon={<Circle size={18} />} items={activeItems} sectionMap={sectionMap} onOpenItem={onOpenItem} onStatusChange={onStatusChange} onDelete={onDelete} />
        <ItemColumn title="收集箱" icon={<Inbox size={18} />} items={inboxItems} sectionMap={sectionMap} onOpenItem={onOpenItem} onStatusChange={onStatusChange} onDelete={onDelete} />
      </div>
      {historyItems.length > 0 && <details className="reverse-todo-disclosure">
        <summary>历史日程待确认 · {historyItems.length}</summary>
        <p>这些 Google 日程的时间已过去，实际是否完成尚未确认。可在事项中确认完成或调整安排。</p>
        <ItemColumn title="历史待确认" icon={<CalendarDays size={18} />} items={historyItems} sectionMap={sectionMap} onOpenItem={onOpenItem} onStatusChange={onStatusChange} onDelete={onDelete} />
      </details>}
      {reverseTodoItems.length > 0 ? (
        <details className="reverse-todo-disclosure">
          <summary>
            <span className="reverse-disclosure-title">
              <Ban size={15} />
              不要做
            </span>
            <span className="reverse-disclosure-count">
              {reverseTodoItems.length} 项约定
              <ChevronRight className="reverse-disclosure-chevron" size={15} />
            </span>
          </summary>
          <ReverseTodoPanel
            items={reverseTodoItems}
            sectionMap={sectionMap}
            onOpenItem={onOpenItem}
            onStatusChange={onStatusChange}
          />
        </details>
      ) : null}
    </div>
  );
}

function ReverseTodoPanel({
  items,
  sectionMap,
  onOpenItem,
  onStatusChange
}: {
  items: Item[];
  sectionMap: Map<string, Section>;
  onOpenItem: (itemId: string) => void;
  onStatusChange: (item: Item, status: ItemStatus) => Promise<void>;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const sortedItems = [...items].sort((left, right) => compareReverseTodos(left, right, now));

  return (
    <section className="reverse-todo-panel" aria-label="反向待办清单">
      <div className="reverse-todo-list">
        {sortedItems.map((item) => {
          const phase = getReverseTodoPhase(item, now);
          return (
            <article className={`reverse-todo-card ${phase}`} key={item.id}>
              <div className="reverse-todo-card-main">
                <div className="reverse-todo-card-meta">
                  <span className={`reverse-phase ${phase}`}>{reverseTodoPhaseLabel(phase)}</span>
                  <span>{sectionMap.get(item.sectionId)?.name ?? item.sectionId}</span>
                </div>
                <button type="button" onClick={() => onOpenItem(item.id)}>{item.title}</button>
                <p>{formatReverseTodoWindow(item, now)}</p>
              </div>
              <div className="reverse-todo-actions">
                <button className="detail-button" type="button" onClick={() => onOpenItem(item.id)}>详情</button>
                {phase === "expired" ? (
                  <button className="reverse-complete-button" type="button" onClick={() => void onStatusChange(item, "done")}>
                    <Check size={15} /> 守住了
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function NotesView({
  items,
  sectionMap,
  onOpenItem
}: {
  items: Item[];
  sectionMap: Map<string, Section>;
  onOpenItem: (itemId: string) => void;
}) {
  return (
    <section className="notes-view">
      <header className="notes-header">
        <div>
          <p className="eyebrow">Capture</p>
          <h2>沉淀</h2>
          <p>收下零碎记录、尚未成形的想法和截图，之后再决定如何整理。</p>
        </div>
        <span>{items.length} 条</span>
      </header>
      {items.length === 0 ? (
        <div className="notes-empty">
          <NotebookPen size={20} />
          <div>
            <strong>还没有沉淀内容</strong>
            <p>在上方快速新增中选择“沉淀”，可以写文字、选择截图或直接粘贴截图。</p>
          </div>
        </div>
      ) : (
        <div className="notes-grid">
          {items.map((item) => {
            const cover = item.attachments?.[0];
            return (
              <article className="note-card" key={item.id}>
                {cover ? (
                  <button className="note-cover" type="button" onClick={() => onOpenItem(item.id)}>
                    <img src={cover.dataUrl} alt={cover.name} />
                    {item.attachments && item.attachments.length > 1 ? (
                      <span>{item.attachments.length} 张</span>
                    ) : null}
                  </button>
                ) : null}
                <div className="note-card-body">
                  <div className="note-card-meta">
                    <span>{sectionMap.get(item.sectionId)?.name ?? item.sectionId}</span>
                    <time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time>
                  </div>
                  <button className="note-card-title" type="button" onClick={() => onOpenItem(item.id)}>
                    {item.title}
                  </button>
                  {item.description ? <p>{item.description.slice(0, 220)}</p> : null}
                  <footer>
                    <span>{item.tags.length ? item.tags.map((tag) => `#${tag}`).join(" ") : "未整理"}</span>
                    <button className="detail-button" type="button" onClick={() => onOpenItem(item.id)}>打开</button>
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ListView({
  items,
  sectionMap,
  sourcePathFilter,
  onClearSourcePath,
  onOpenItem,
  onStatusChange,
  onDelete
}: {
  items: Item[];
  sectionMap: Map<string, Section>;
  sourcePathFilter: string | null;
  onClearSourcePath: () => void;
  onOpenItem: (itemId: string) => void;
  onStatusChange: (item: Item, status: ItemStatus) => Promise<void>;
  onDelete: (item: Item) => Promise<void>;
}) {
  return (
    <section className="surface">
      <div className="surface-header">
        <h2>全部事项</h2>
        <span>{items.length} 条</span>
      </div>
      {sourcePathFilter ? (
        <div className="active-filter">
          <span>{sourcePathFilter}</span>
          <button type="button" onClick={onClearSourcePath}>
            <X size={15} />
            清除
          </button>
        </div>
      ) : null}
      <div className="item-list">
        {items.length === 0 ? <EmptyState text="没有匹配当前筛选的事项。" /> : null}
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            sectionMap={sectionMap}
            onOpenItem={onOpenItem}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function BoardView({
  items,
  sectionMap,
  showAbandoned,
  onOpenItem,
  onStatusChange
}: {
  items: Item[];
  sectionMap: Map<string, Section>;
  showAbandoned: boolean;
  onOpenItem: (itemId: string) => void;
  onStatusChange: (item: Item, status: ItemStatus) => Promise<void>;
}) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ItemStatus | null>(null);
  const draggingItem = useMemo(
    () => items.find((item) => item.id === draggingItemId) ?? null,
    [draggingItemId, items]
  );

  async function dropOnStatus(status: ItemStatus) {
    if (!draggingItem || draggingItem.status === status) {
      setDraggingItemId(null);
      setDragOverStatus(null);
      return;
    }

    await onStatusChange(draggingItem, status);
    setDraggingItemId(null);
    setDragOverStatus(null);
  }

  const boardStatuses: ItemDisplayStatus[] = [...(showAbandoned
    ? STATUS_ORDER
    : STATUS_ORDER.filter((status) => status !== "abandoned")), "history"];

  return (
    <section className="board">
      {boardStatuses.map((status) => {
        const columnItems = items.filter((item) => itemDisplayStatus(item) === status);
        return (
          <div
            className={`board-column ${dragOverStatus === status ? "drag-over" : ""}`}
            key={status}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDragOverStatus(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (status !== "history") setDragOverStatus(status);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (status !== "history") void dropOnStatus(status);
            }}
          >
            <div className="board-title">
              <span>{DISPLAY_STATUS_LABELS[status]}</span>
              <strong>{columnItems.length}</strong>
            </div>
            <div className="board-items">
              {columnItems.length === 0 ? (
                <div className="board-drop-empty">{status === "history" ? "暂无待确认的历史日程" : "拖到这里"}</div>
              ) : null}
              {columnItems.map((item) => (
                <article
                  className={`item-card ${draggingItemId === item.id ? "dragging" : ""}`}
                  draggable
                  key={item.id}
                  onDragEnd={() => {
                    setDraggingItemId(null);
                    setDragOverStatus(null);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                    setDraggingItemId(item.id);
                  }}
                >
                  <ItemMeta item={item} sectionMap={sectionMap} />
                  <button className="item-title-button" type="button" onClick={() => onOpenItem(item.id)}>
                    {item.title}
                  </button>
                  <select
                    value={item.status}
                    onChange={(event) => void onStatusChange(item, event.target.value as ItemStatus)}
                  >
                    {STATUS_ORDER.map((nextStatus) => (
                      <option key={nextStatus} value={nextStatus}>
                        {nextStatus === "active" && itemDisplayStatus(item) === "history" ? "历史待确认" : STATUS_LABELS[nextStatus]}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function CalendarView({
  items,
  sectionMap,
  onCreateEvent,
  onOpenItem,
  onScheduleChange
}: {
  items: Item[];
  sectionMap: Map<string, Section>;
  onCreateEvent: (day: Date) => void;
  onOpenItem: (itemId: string) => void;
  onScheduleChange: (item: Item, patch: Partial<Item>) => Promise<void>;
}) {
  const [cursorMonth, setCursorMonth] = useState(() => startOfMonth(new Date()));
  const [calendarDrag, setCalendarDrag] = useState<CalendarDragState | null>(null);
  const ignoreCalendarClickUntilRef = useRef(0);
  const calendarWeeks = useMemo(() => buildCalendarWeeks(cursorMonth), [cursorMonth]);
  const previewItems = useMemo(
    () => previewCalendarItemsForDrag(items, calendarDrag),
    [calendarDrag, items]
  );
  const dayItemCounts = useMemo(() => countItemsByCalendarDay(previewItems), [previewItems]);
  const segmentsByWeek = useMemo(
    () => buildCalendarSegments(calendarWeeks, previewItems),
    [calendarWeeks, previewItems]
  );
  const monthItemCount = useMemo(
    () => items.filter((item) => itemOverlapsMonth(item, cursorMonth)).length,
    [cursorMonth, items]
  );

  useEffect(() => {
    if (!calendarDrag) return;

    const activeDrag = calendarDrag;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    function updateDragTarget(event: PointerEvent) {
      const targetDay = calendarDayFromPoint(event.clientX, event.clientY);
      const targetDayKey = targetDay ? localDateKey(targetDay) : undefined;
      const moved =
        Math.abs(event.clientX - activeDrag.startX) > 4 ||
        Math.abs(event.clientY - activeDrag.startY) > 4;
      setCalendarDrag((current) => {
        if (!current || current.pointerId !== event.pointerId) {
          return current;
        }
        if (current.targetDayKey === targetDayKey && current.didMove === (current.didMove || moved)) {
          return current;
        }
        return { ...current, didMove: current.didMove || moved, targetDayKey };
      });
    }

    function finishDrag(event: PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;

      const startX = activeDrag.startX ?? event.clientX;
      const startY = activeDrag.startY ?? event.clientY;
      const moved =
        Math.abs(event.clientX - startX) > 4 ||
        Math.abs(event.clientY - startY) > 4;
      if (moved) {
        ignoreCalendarClickUntilRef.current = Date.now() + 250;
      }

      setCalendarDrag(null);
      if (!moved && !activeDrag.didMove) return;
      void completeCalendarPointerDrag(activeDrag, event.clientX, event.clientY);
    }

    function cancelDrag(event: PointerEvent) {
      if (event.pointerId !== activeDrag.pointerId) return;
      setCalendarDrag(null);
    }

    function cancelByEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCalendarDrag(null);
      }
    }

    window.addEventListener("pointermove", updateDragTarget);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("keydown", cancelByEscape);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", updateDragTarget);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("keydown", cancelByEscape);
    };
  }, [calendarDrag, items]);

  function beginCalendarPointerDrag(
    event: ReactPointerEvent<HTMLElement>,
    nextDrag: Omit<CalendarDragState, "pointerId" | "startX" | "startY" | "didMove">
  ) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setCalendarDrag({
      ...nextDrag,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      didMove: false,
      targetDayKey: localDateKey(calendarDayFromPoint(event.clientX, event.clientY) ?? new Date())
    });
  }

  async function completeCalendarPointerDrag(
    dragState: CalendarDragState,
    clientX: number,
    clientY: number
  ) {
    const item = items.find((candidate) => candidate.id === dragState.itemId);
    const targetDay = calendarDayFromPoint(clientX, clientY);
    if (!item || !targetDay) return;

    const patch = calendarPatchForDrop(item, targetDay, dragState.kind, dragState.grabOffsetDays);
    if (!calendarPatchChangesItem(item, patch)) return;
    await onScheduleChange(item, patch);
  }

  return (
    <section className="surface">
      <div className="surface-header">
        <h2>
          <CalendarDays size={18} />
          {formatMonthTitle(cursorMonth)}
        </h2>
        <div className="calendar-toolbar">
          <span>{monthItemCount} 条本月事项</span>
          <button
            className="icon-button compact"
            type="button"
            title="上个月"
            onClick={() => setCursorMonth((current) => addMonths(current, -1))}
          >
            <ChevronLeft size={17} />
          </button>
          <button className="detail-button" type="button" onClick={() => setCursorMonth(startOfMonth(new Date()))}>
            今天
          </button>
          <button
            className="icon-button compact"
            type="button"
            title="下个月"
            onClick={() => setCursorMonth((current) => addMonths(current, 1))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      <div className="calendar-grid" role="grid" aria-label={`${formatMonthTitle(cursorMonth)} 日历`}>
        {WEEKDAY_LABELS.map((day) => (
          <div className="calendar-weekday" key={day}>
            {day}
          </div>
        ))}
        {calendarWeeks.map((week, weekIndex) => {
          const segments = segmentsByWeek.get(weekIndex) ?? [];
          const laneCount = Math.max(1, ...segments.map((segment) => segment.lane + 1));
          return (
            <div
              className={`calendar-week ${calendarDrag ? "dragging-calendar-item" : ""}`}
              key={week.map(localDateKey).join(":")}
              data-calendar-week-start={localDateKey(week[0])}
              style={{ "--calendar-lanes": laneCount } as CSSProperties}
            >
              {week.map((day) => {
                const dayKey = localDateKey(day);
                const dayItemCount = dayItemCounts.get(dayKey) ?? 0;
                const isOutside = !isSameMonth(day, cursorMonth);
                const isToday = localDateKey(new Date()) === dayKey;

                return (
                  <div
                    className={`calendar-day ${isOutside ? "outside" : ""} ${isToday ? "today" : ""} ${dayItemCount ? "has-items" : ""} ${calendarDrag?.targetDayKey === dayKey ? "drop-target" : ""}`}
                    key={dayKey}
                    onDoubleClick={() => onCreateEvent(day)}
                    role="gridcell"
                    title="双击新建日程"
                  >
                    <div className="calendar-day-header">
                      <time dateTime={dayKey}>{day.getDate()}</time>
                      <div className="calendar-day-tools">
                        {dayItemCount ? <span>{dayItemCount}</span> : null}
                        <button
                          aria-label={`${dayKey} 新建日程`}
                          className="calendar-day-add"
                          type="button"
                          onClick={() => onCreateEvent(day)}
                          title="新建日程"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="calendar-events" aria-label="日程条目">
                {segments.map((segment) => {
                  const section = sectionMap.get(segment.item.sectionId);
                  const startsBeforeWeek = segment.itemStart < segment.weekStart;
                  const endsAfterWeek = segment.itemEnd > segment.weekEnd;
                  return (
                    <div
                      aria-label={`${segment.item.title} ${formatCalendarRange(segment.item)}`}
                      className={`calendar-event ${segment.item.type} ${calendarDrag?.itemId === segment.item.id ? "is-dragging" : ""} ${startsBeforeWeek ? "continues-before" : ""} ${endsAfterWeek ? "continues-after" : ""}`}
                      key={`${segment.item.id}-${weekIndex}-${segment.startColumn}`}
                      onClick={() => {
                        if (Date.now() < ignoreCalendarClickUntilRef.current) return;
                        onOpenItem(segment.item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenItem(segment.item.id);
                        }
                      }}
                      onPointerDown={(event) =>
                        beginCalendarPointerDrag(event, {
                          kind: "move",
                          itemId: segment.item.id,
                          grabOffsetDays: calendarGrabOffsetDays(segment, event.clientX, event.clientY)
                        })
                      }
                      role="button"
                      style={{
                        "--calendar-item-color": section?.color ?? "var(--accent)",
                        gridColumn: `${segment.startColumn} / ${segment.endColumn}`,
                        gridRow: segment.lane + 1
                      } as CSSProperties}
                      tabIndex={0}
                      title="拖动移动，拖左右边缘调整跨度"
                    >
                      <span
                        aria-label="调整开始日期"
                        className="calendar-resize-handle start"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) =>
                          beginCalendarPointerDrag(event, {
                            kind: "resize-start",
                            itemId: segment.item.id,
                            grabOffsetDays: 0
                          })
                        }
                        role="button"
                        title="调整开始日期"
                      />
                      <span className="calendar-event-content">
                        <time>{formatCalendarRange(segment.item)}</time>
                        <span>{segment.item.title}</span>
                      </span>
                      <span
                        aria-label="调整结束日期"
                        className="calendar-resize-handle end"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) =>
                          beginCalendarPointerDrag(event, {
                            kind: "resize-end",
                            itemId: segment.item.id,
                            grabOffsetDays: 0
                          })
                        }
                        role="button"
                        title="调整结束日期"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="calendar-empty">
          <EmptyState text="还没有安排具体时间的事项。" />
        </div>
      ) : null}
    </section>
  );
}

function SyncView({
  sections,
  summaries,
  onPullGitHubSnapshot,
  onPushGitHubSnapshot,
  onImported,
  onOpenSource
}: {
  sections: Section[];
  summaries: SourceFileSummary[];
  onPullGitHubSnapshot: () => Promise<string>;
  onPushGitHubSnapshot: () => Promise<string>;
  onImported: () => Promise<void>;
  onOpenSource: (sourcePath: string) => void;
}) {
  const [localGitStatus, setLocalGitStatus] = useState<LocalGitStatus | null>(null);
  const [localGitState, setLocalGitState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [localImportState, setLocalImportState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [diffState, setDiffState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    path?: string;
    diff?: string;
    message?: string;
  }>({ status: "idle" });
  const [createState, setCreateState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [googleImportState, setGoogleImportState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [googleStatusState, setGoogleStatusState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    payload?: GoogleCalendarStatus;
  }>({ status: "idle" });
  const [githubSnapshotState, setGitHubSnapshotState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [createForm, setCreateForm] = useState({
    title: "",
    type: "idea" as ItemType,
    status: "wanted" as ItemStatus,
    sectionId: "work",
    description: "",
    startAt: "",
    endAt: ""
  });
  const [commitMessage, setCommitMessage] = useState("Update TodoTodoList human files");

  useEffect(() => {
    void refreshLocalGitStatus();
    void refreshGoogleCalendarStatus();
  }, []);

  useEffect(() => {
    if (sections.length && !sections.some((section) => section.id === createForm.sectionId)) {
      setCreateForm((current) => ({ ...current, sectionId: sections[0]?.id ?? "work" }));
    }
  }, [createForm.sectionId, sections]);

  async function refreshLocalGitStatus() {
    setLocalGitState({ status: "loading", message: "正在读取本地 Git 工作区..." });
    try {
      const response = await fetch("/api/local-git/status");
      const payload = (await response.json().catch(() => ({}))) as LocalGitStatus & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "读取本地 Git 状态失败");
      }

      setLocalGitStatus(payload);
      if (!payload.changedFiles.some((file) => file.path === diffState.path)) {
        setDiffState({ status: "idle" });
      }
      setLocalGitState({
        status: "success",
        message: payload.isClean ? "本地模拟库没有待提交变更。" : `发现 ${payload.changedFiles.length} 个待提交文件。`
      });
    } catch (error) {
      setLocalGitState({
        status: "error",
        message: error instanceof Error ? error.message : "读取本地 Git 状态失败"
      });
    }
  }

  async function importConfiguredLocalGit() {
    setLocalImportState({ status: "loading", message: "正在从 sources.json 导入本地 Git..." });
    try {
      const response = await fetch("/api/local-git/import-human-files", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      });
      const payload = (await response.json().catch(() => ({}))) as {
        fileCount?: number;
        itemCount?: number;
        items?: Item[];
        sources?: { sources?: HumanSource[] };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "导入失败");
      }

      if (!Array.isArray(payload.items)) {
        throw new Error("导入结果缺少事项数据");
      }

      const sourceIds = payload.sources?.sources?.map((source) => source.id) ?? [];
      const reconciliation = await reconcileHumanSourceItems(payload.items, sourceIds);
      await onImported();
      await refreshLocalGitStatus();

      setLocalImportState({
        status: "success",
        message: `已导入 ${payload.fileCount ?? 0} 个文件、${payload.itemCount ?? payload.items.length} 条事项${reconciliation.deletedCount ? `，清理 ${reconciliation.deletedCount} 条已移除事项` : ""}。`
      });
    } catch (error) {
      setLocalImportState({
        status: "error",
        message: error instanceof Error ? error.message : "导入失败"
      });
    }
  }

  async function createLocalGitHumanFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.title.trim()) return;
    if (createForm.type === "avoid") {
      const error = validateReverseTodoPeriod(createForm.startAt, createForm.endAt);
      if (error) {
        setCreateState({ status: "error", message: error });
        return;
      }
    }

    setCreateState({ status: "loading", message: "正在创建本地 Git Markdown 文件..." });
    try {
      const response = await fetch("/api/local-git/create-human-file", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: createForm.title,
          type: createForm.type,
          status: createForm.status,
          sectionId: createForm.sectionId,
          description: createForm.description,
          startAt: createForm.startAt ? new Date(createForm.startAt).toISOString() : undefined,
          endAt: createForm.endAt ? new Date(createForm.endAt).toISOString() : undefined
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        sourcePath?: string;
        itemCount?: number;
        items?: Item[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "创建失败");
      }

      if (!Array.isArray(payload.items)) {
        throw new Error("创建结果缺少事项数据");
      }

      await importItems(payload.items);
      await onImported();
      await refreshLocalGitStatus();

      setCreateForm((current) => ({
        ...current,
        title: "",
        description: "",
        ...(current.type === "avoid" ? defaultReverseTodoPeriod() : { startAt: "", endAt: "" })
      }));
      setCreateState({
        status: "success",
        message: `已创建 ${payload.sourcePath}，导入 ${payload.itemCount ?? payload.items.length} 条事项。`
      });
    } catch (error) {
      setCreateState({
        status: "error",
        message: error instanceof Error ? error.message : "创建失败"
      });
    }
  }

  async function importGoogleCalendarEvents() {
    setGoogleImportState({ status: "loading", message: "正在从 Google Calendar 导入近期日程..." });
    try {
      const response = await fetch("/api/google-calendar/import-events", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      });
      const payload = (await response.json().catch(() => ({}))) as {
        calendarId?: string;
        eventCount?: number;
        itemCount?: number;
        items?: Item[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Google Calendar 导入失败");
      }
      if (!Array.isArray(payload.items)) {
        throw new Error("Google Calendar 导入结果缺少事项数据");
      }

      await importGoogleCalendarItems(payload.items);
      await onImported();
      setGoogleImportState({
        status: "success",
        message: `已从 ${payload.calendarId ?? "primary"} 导入 ${payload.itemCount ?? payload.items.length} 条日程。`
      });
    } catch (error) {
      setGoogleImportState({
        status: "error",
        message: error instanceof Error ? error.message : "Google Calendar 导入失败"
      });
    }
  }

  async function refreshGoogleCalendarStatus() {
    setGoogleStatusState({ status: "loading", message: "正在读取 Google Calendar 配置..." });
    try {
      const response = await fetch("/api/google-calendar/status");
      const payload = (await response.json().catch(() => ({}))) as GoogleCalendarStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "读取 Google Calendar 配置失败");
      }
      setGoogleStatusState({
        status: "success",
        message: payload.importConfigured
          ? "Google Calendar 已可导入。"
          : payload.oauthConfigured
            ? "OAuth 已配置，完成授权后会自动保存 token。"
            : "Google Calendar OAuth 环境变量尚未配置完整。",
        payload
      });
    } catch (error) {
      setGoogleStatusState({
        status: "error",
        message: error instanceof Error ? error.message : "读取 Google Calendar 配置失败"
      });
    }
  }

  async function previewLocalGitDiff(sourcePath: string) {
    setDiffState({ status: "loading", path: sourcePath, message: "正在读取 diff..." });
    try {
      const response = await fetch(`/api/local-git/diff?path=${encodeURIComponent(sourcePath)}`);
      const payload = (await response.json().catch(() => ({}))) as LocalGitDiff & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "读取 diff 失败");
      }

      setDiffState({
        status: "success",
        path: sourcePath,
        diff: payload.diff,
        message: payload.diff.trim() ? undefined : "这个文件暂无可显示的未提交 diff。"
      });
    } catch (error) {
      setDiffState({
        status: "error",
        path: sourcePath,
        message: error instanceof Error ? error.message : "读取 diff 失败"
      });
    }
  }

  async function commitLocalGitChanges() {
    setLocalGitState({ status: "loading", message: "正在提交本地 Git 变更..." });
    try {
      const response = await fetch("/api/local-git/commit", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ message: commitMessage })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        committed?: boolean;
        commit?: string;
        status?: LocalGitStatus;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "提交失败");
      }

      if (payload.status) {
        setLocalGitStatus(payload.status);
      }
      setDiffState({ status: "idle" });
      setLocalGitState({
        status: "success",
        message: payload.committed ? `已提交 ${payload.commit}` : "没有需要提交的变更。"
      });
    } catch (error) {
      setLocalGitState({
        status: "error",
        message: error instanceof Error ? error.message : "提交失败"
      });
    }
  }

  async function pushGitHubSnapshot() {
    setGitHubSnapshotState({ status: "loading", message: "正在保存完整 JSON 快照到 GitHub..." });
    try {
      const message = await onPushGitHubSnapshot();
      setGitHubSnapshotState({ status: "success", message });
    } catch (error) {
      setGitHubSnapshotState({
        status: "error",
        message: error instanceof Error ? error.message : "保存 GitHub 快照失败"
      });
    }
  }

  async function pullGitHubSnapshot() {
    setGitHubSnapshotState({ status: "loading", message: "正在从 GitHub 读取完整 JSON 快照..." });
    try {
      const message = await onPullGitHubSnapshot();
      setGitHubSnapshotState({ status: "success", message });
    } catch (error) {
      setGitHubSnapshotState({
        status: "error",
        message: error instanceof Error ? error.message : "读取 GitHub 快照失败"
      });
    }
  }

  return (
    <div className="sync-stack">
      <section className="surface" id="github-source">
        <div className="surface-header">
          <h2>
            <GitBranch size={18} />
            GitHub 文件源
          </h2>
          <span>私有 Markdown 仓库</span>
        </div>
        <div className="sync-embedded-panel">
          <p className="sync-section-intro">
            读取 GitHub 私有库中的 Markdown 文件并同步为事项。Token 只在服务端环境变量中使用，不进入浏览器存储。
          </p>
          <GitHubSourcePanel embedded />
        </div>
      </section>

      <section className="surface">
        <div className="surface-header">
          <h2>
            <GitBranch size={18} />
            GitHub JSON 快照
          </h2>
          <span>完整恢复点</span>
        </div>
        <div className="local-git-panel">
          <div className="sync-toolbar">
            <div>
              <strong>保存或恢复完整 TodoTodoList 数据</strong>
              {githubSnapshotState.message ? (
                <p className={`sync-message ${githubSnapshotState.status}`}>{githubSnapshotState.message}</p>
              ) : null}
            </div>
            <div className="sync-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void pullGitHubSnapshot()}
                disabled={githubSnapshotState.status === "loading"}
              >
                从 GitHub 读取
              </button>
              <button
                className="button"
                type="button"
                onClick={() => void pushGitHubSnapshot()}
                disabled={githubSnapshotState.status === "loading"}
              >
                保存到 GitHub
              </button>
            </div>
          </div>
          <p className="sync-message">
            默认写入 <code>todotodolist/snapshot.json</code>，可用 <code>GITHUB_SNAPSHOT_PATH</code> 改路径。
          </p>
        </div>
      </section>

      <section className="surface">
        <div className="surface-header">
          <h2>
            <GitBranch size={18} />
            本地 Git 工作区
          </h2>
          <span>{localGitStatus ? `${localGitStatus.branch} · ${localGitStatus.head}` : "未读取"}</span>
        </div>
        <div className="local-git-panel">
          <div className="sync-toolbar">
            <div>
              <strong>{localGitStatus?.isClean ? "工作区干净" : "存在待提交变更"}</strong>
              {localGitState.message ? (
                <p className={`sync-message ${localGitState.status}`}>{localGitState.message}</p>
              ) : null}
              {localImportState.message ? (
                <p className={`sync-message ${localImportState.status}`}>{localImportState.message}</p>
              ) : null}
            </div>
            <div className="sync-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void importConfiguredLocalGit()}
                disabled={localGitState.status === "loading" || localImportState.status === "loading"}
              >
                从本地 Git 导入
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void refreshLocalGitStatus()}
                disabled={localGitState.status === "loading" || localImportState.status === "loading"}
              >
                刷新状态
              </button>
              <button
                className="button"
                type="button"
                onClick={() => void commitLocalGitChanges()}
                disabled={
                  localGitState.status === "loading" ||
                  localImportState.status === "loading" ||
                  !localGitStatus ||
                  localGitStatus.isClean ||
                  !commitMessage.trim()
                }
              >
                提交变更
              </button>
            </div>
          </div>

          <label className="commit-message-field">
            提交信息
            <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
          </label>

          <form className="git-create-form" onSubmit={createLocalGitHumanFile}>
            <div className="git-create-header">
              <strong>新建 Git 事项文件</strong>
              {createState.message ? (
                <p className={`sync-message ${createState.status}`}>{createState.message}</p>
              ) : null}
            </div>
            <input
              aria-label="Git 文件事项标题"
              placeholder="标题"
              value={createForm.title}
              onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
            />
            <select
              aria-label="Git 文件事项类型"
              value={createForm.type}
              onChange={(event) => {
                const type = event.target.value as ItemType;
                setCreateForm((current) => type === "avoid"
                  ? { ...current, type, status: "active", ...defaultReverseTodoPeriod() }
                  : { ...current, type, endAt: "" });
              }}
            >
              {TYPE_ORDER.map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type]}</option>
              ))}
            </select>
            <select
              aria-label="Git 文件事项状态"
              value={createForm.status}
              onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as ItemStatus }))}
            >
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <select
              aria-label="Git 文件事项版块"
              value={createForm.sectionId}
              onChange={(event) => setCreateForm((current) => ({ ...current, sectionId: event.target.value }))}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
            {createForm.type === "avoid" ? (
              <div className="git-create-period">
                <label>
                  不做时段开始
                  <input
                    required
                    type="datetime-local"
                    value={createForm.startAt}
                    onChange={(event) => setCreateForm((current) => ({ ...current, startAt: event.target.value }))}
                  />
                </label>
                <label>
                  不做时段结束
                  <input
                    min={createForm.startAt || undefined}
                    required
                    type="datetime-local"
                    value={createForm.endAt}
                    onChange={(event) => setCreateForm((current) => ({ ...current, endAt: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}
            <textarea
              aria-label="Git 文件事项描述"
              placeholder="Markdown 描述"
              value={createForm.description}
              onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
            />
            <button
              className="button"
              type="submit"
              disabled={createState.status === "loading" || !createForm.title.trim()}
            >
              创建 Markdown
            </button>
          </form>

          {localGitStatus?.changedFiles.length ? (
            <div className="changed-files">
              {localGitStatus.changedFiles.map((file) => (
                <div className="changed-file" key={`${file.indexStatus}:${file.worktreeStatus}:${file.path}`}>
                  <span>{file.label}</span>
                  <code>{file.path}</code>
                  <button
                    type="button"
                    onClick={() => void previewLocalGitDiff(file.path)}
                    disabled={diffState.status === "loading" && diffState.path === file.path}
                  >
                    查看 diff
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="本地模拟库暂无待提交文件。" />
          )}

          {localGitStatus?.diffStat ? <pre className="diff-stat">{localGitStatus.diffStat}</pre> : null}
          {diffState.status !== "idle" ? (
            <section className="diff-preview" aria-label="Git diff 预览">
              <div className="diff-preview-header">
                <strong>{diffState.path}</strong>
                {diffState.status === "loading" ? <span>读取中</span> : null}
              </div>
              {diffState.message ? (
                <p className={`sync-message ${diffState.status}`}>{diffState.message}</p>
              ) : null}
              {diffState.diff ? <pre>{diffState.diff}</pre> : null}
            </section>
          ) : null}
        </div>
      </section>

      <section className="surface">
        <div className="surface-header">
          <h2>
            <CalendarDays size={18} />
            Google Calendar
          </h2>
          <span>单日历导入</span>
        </div>
        <div className="local-git-panel">
          <GoogleCalendarStatusCard state={googleStatusState} />
          <div className="sync-toolbar">
            <div>
              <strong>从 Google Calendar 拉取近期日程</strong>
              {googleImportState.message ? (
                <p className={`sync-message ${googleImportState.status}`}>{googleImportState.message}</p>
              ) : null}
            </div>
            <div className="sync-actions">
              {googleStatusState.payload?.oauthConfigured ? (
                <a className="button secondary" href="/api/google-calendar/oauth/start" target="_blank" rel="noreferrer">
                  重新授权 Google
                </a>
              ) : (
                <span className="button secondary disabled">重新授权 Google</span>
              )}
              <button
                className="button secondary"
                type="button"
                onClick={() => void refreshGoogleCalendarStatus()}
                disabled={googleStatusState.status === "loading"}
              >
                刷新配置
              </button>
              <button
                className="button"
                type="button"
                onClick={() => void importGoogleCalendarEvents()}
                disabled={
                  googleImportState.status === "loading" ||
                  googleStatusState.status === "loading" ||
                  !googleStatusState.payload?.importConfigured
                }
              >
                导入日程
              </button>
            </div>
          </div>
          <p className="sync-message">
            授权完成后会自动保存 refresh token。回到这里刷新配置即可导入日程，无需重启应用。
          </p>
        </div>
      </section>

      <section className="surface">
        <div className="surface-header">
          <h2>
            <GitBranch size={18} />
            来源文件
          </h2>
          <span>{summaries.length} 个来源文件</span>
        </div>
        <div className="sync-list">
          {summaries.length === 0 ? <EmptyState text="还没有 GitHub 来源文件。可以先到 GitHub 同步页导入本地模拟库。" /> : null}
          {summaries.map((summary) => (
            <article className="sync-row" key={`${summary.sourceId}:${summary.sourcePath}`}>
              <div className="sync-file">
                <FileText size={18} />
                <div>
                  <h3>{summary.sourcePath}</h3>
                  <p>{summary.sourceId} · {formatDateTime(summary.latestUpdatedAt)} 更新</p>
                </div>
              </div>
              <div className="sync-stats">
                <Metric label="事项" value={summary.itemCount} />
                <Metric label="主项" value={summary.rootItemCount} />
                <Metric label="子项" value={summary.childItemCount} />
                <Metric label="可回写" value={summary.writableItemCount} />
              </div>
              <div className="sync-statuses" aria-label={`${summary.sourcePath} 状态分布`}>
                {STATUS_ORDER.map((status) => (
                  <span key={status}>
                    {STATUS_LABELS[status]} {summary.statusCounts[status]}
                  </span>
                ))}
              </div>
              <div className="sync-footer">
                <span>{writeBackLabel(summary.writeBack)}</span>
                {summary.sourceSha ? <code>{summary.sourceSha.slice(0, 7)}</code> : <code>local</code>}
                <button type="button" onClick={() => onOpenSource(summary.sourcePath)}>
                  查看事项
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function GoogleCalendarStatusCard({
  state
}: {
  state: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    payload?: GoogleCalendarStatus;
  };
}) {
  const status = state.payload;
  return (
    <section className={`connection-card ${status?.importConfigured ? "success" : "warning"}`}>
      <div>
        <strong>{status?.importConfigured ? "Google Calendar 已可导入" : "需要完成 Google Calendar 配置"}</strong>
        <p>{state.message ?? "读取配置后可以从这里授权并导入近期日程。"}</p>
      </div>
      {status ? (
        <dl className="connection-fields">
          <dt>日历</dt>
          <dd>{status.calendarId}</dd>
          <dt>版块</dt>
          <dd>{status.sectionId}</dd>
          <dt>OAuth</dt>
          <dd>{status.oauthConfigured ? "已配置" : "未配置完整"}</dd>
          <dt>Token</dt>
          <dd>{status.hasRefreshToken ? "已配置" : "未配置"}</dd>
          <dt>实时同步</dt>
          <dd>
            {status.realtime.channelActive
              ? "推送通道运行中"
              : status.realtime.webhookConfigured
                ? "等待启动"
                : "未配置 Webhook"}
          </dd>
          <dt>最近同步</dt>
          <dd>{formatDateTime(status.realtime.lastIncrementalSyncAt ?? status.realtime.lastFullSyncAt) || "尚无"}</dd>
        </dl>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ItemColumn({
  className,
  title,
  icon,
  items,
  sectionMap,
  onOpenItem,
  onStatusChange,
  onDelete
}: {
  className?: string;
  title: string;
  icon: ReactNode;
  items: Item[];
  sectionMap: Map<string, Section>;
  onOpenItem: (itemId: string) => void;
  onStatusChange: (item: Item, status: ItemStatus) => Promise<void>;
  onDelete: (item: Item) => Promise<void>;
}) {
  return (
    <section className={`surface ${className ?? ""}`.trim()}>
      <div className="surface-header">
        <h2>
          {icon}
          {title}
        </h2>
        <span>{items.length}</span>
      </div>
      <div className="item-list">
        {items.length === 0 ? <EmptyState text="这里暂时是空的。" /> : null}
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            sectionMap={sectionMap}
            onOpenItem={onOpenItem}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function ItemRow({
  item,
  sectionMap,
  onOpenItem,
  onStatusChange,
  onDelete
}: {
  item: Item;
  sectionMap: Map<string, Section>;
  onOpenItem: (itemId: string) => void;
  onStatusChange: (item: Item, status: ItemStatus) => Promise<void>;
  onDelete: (item: Item) => Promise<void>;
}) {
  return (
    <article className="item-row">
      <div className="item-main">
        <ItemMeta item={item} sectionMap={sectionMap} />
        <button className="item-title-button" type="button" onClick={() => onOpenItem(item.id)}>
          {item.title}
        </button>
        {item.description ? <p>{item.description.slice(0, 120)}</p> : null}
      </div>
      <div className="item-actions">
        <button className="detail-button" type="button" onClick={() => onOpenItem(item.id)}>
          详情
        </button>
        {item.type !== "note" ? (
          <>
            <select
              aria-label="修改状态"
              value={item.status}
              onChange={(event) => void onStatusChange(item, event.target.value as ItemStatus)}
            >
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {status === "active" && itemDisplayStatus(item) === "history" ? "历史待确认" : STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <button className="icon-button" type="button" title="完成" onClick={() => void onStatusChange(item, "done")}>
              <Check size={17} />
            </button>
          </>
        ) : null}
        <button className="icon-button danger" type="button" title="删除" onClick={() => void onDelete(item)}>
          <Trash2 size={17} />
        </button>
      </div>
    </article>
  );
}

function ItemDetailDrawer({
  item,
  sections,
  sectionMap,
  onClose,
  onStatusChange,
  onSave,
  onCreateGoogleCalendarEvent,
  onDelete
}: {
  item: Item;
  sections: Section[];
  sectionMap: Map<string, Section>;
  onClose: () => void;
  onStatusChange: (status: ItemStatus) => Promise<boolean>;
  onSave: (patch: Partial<Item>, options?: { writeBack?: boolean }) => Promise<boolean>;
  onCreateGoogleCalendarEvent: (item: Item) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const section = sectionMap.get(item.sectionId);
  const sourceLink = item.sourceLink;
  const [draft, setDraft] = useState(() => draftFromItem(item));
  const [writeBackState, setWriteBackState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const canCreateGoogleCalendarEvent =
    item.source === "local" && !sourceLink && draftTypeCanSyncToGoogle(draft.type);
  const hasGoogleSyncDate = draft.allDay ? Boolean(draft.startDate) : Boolean(draft.startAt);

  useEffect(() => {
    setDraft(draftFromItem(item));
  }, [item]);

  const isDirty = useMemo(() => {
    const current = draftFromItem(item);
    return (
      draft.title !== current.title ||
      draft.type !== current.type ||
      draft.status !== current.status ||
      draft.sectionId !== current.sectionId ||
      draft.tagsText !== current.tagsText ||
      draft.allDay !== current.allDay ||
      draft.startDate !== current.startDate ||
      draft.endDate !== current.endDate ||
      draft.startAt !== current.startAt ||
      draft.endAt !== current.endAt ||
      draft.description !== current.description ||
      attachmentIds(draft.attachments) !== attachmentIds(current.attachments)
    );
  }, [draft, item]);

  async function saveDetails(): Promise<Partial<Item> | null> {
    if (!draft.title.trim()) {
      setWriteBackState({ status: "error", message: "标题不能为空" });
      return null;
    }

    const reverseTodoError = validateReverseTodoDraft(draft);
    if (reverseTodoError) {
      setWriteBackState({ status: "error", message: reverseTodoError });
      return null;
    }

    const patch = patchFromDraft(draft);
    const saved = await onSave(patch);
    if (!saved) {
      setWriteBackState({ status: "error", message: "远端写回失败，本地修改尚未保存" });
      return null;
    }
    setWriteBackState({ status: "success", message: "已保存到本地缓存" });
    return patch;
  }

  async function writeBackHumanFile() {
    if (!sourceLink || sourceLink.writeBack === "none") return;

    const target = humanFileWriteBackTarget(sourceLink);
    setWriteBackState({ status: "loading", message: `正在写回 ${target.label} frontmatter...` });
    try {
      const reverseTodoError = validateReverseTodoDraft(draft);
      if (reverseTodoError) throw new Error(reverseTodoError);

      const patch = patchFromDraft(draft);
      if (!patch.title?.trim()) {
        throw new Error("标题不能为空");
      }

      const saved = await onSave(patch);
      if (!saved) throw new Error("写回失败，本地修改尚未保存");

      setWriteBackState({
        status: "success",
        message: `已写回 ${target.label} ${sourceLink.sourcePath}`
      });
    } catch (error) {
      setWriteBackState({
        status: "error",
        message: error instanceof Error ? error.message : "写回失败"
      });
    }
  }

  async function createGoogleCalendarFromDraft() {
    if (!canCreateGoogleCalendarEvent) return;
    if (!draft.title.trim()) {
      setWriteBackState({ status: "error", message: "标题不能为空" });
      return;
    }

    const patch = patchFromDraft(draft);
    const updatedItem: Item = {
      ...item,
      ...patch,
      source: "local",
      title: patch.title ?? item.title,
      type: patch.type ?? item.type,
      status: patch.status ?? item.status,
      sectionId: patch.sectionId ?? item.sectionId,
      tags: patch.tags ?? item.tags,
      description: patch.description ?? item.description
    };

    if (!updatedItem.startAt) {
      setWriteBackState({ status: "error", message: "同步到 Google Calendar 需要开始时间" });
      return;
    }

    setWriteBackState({ status: "loading", message: "正在创建 Google Calendar 事件..." });
    try {
      const saved = await onSave(patch);
      if (!saved) throw new Error("本地事项保存失败");
      await onCreateGoogleCalendarEvent(updatedItem);
      setWriteBackState({ status: "success", message: "已同步到 Google Calendar" });
    } catch (error) {
      setWriteBackState({
        status: "error",
        message: error instanceof Error ? error.message : "同步到 Google Calendar 失败"
      });
    }
  }

  async function appendDraftAttachments(files: File[]) {
    if (!files.length) return;
    try {
      const remaining = MAX_NOTE_ATTACHMENTS - draft.attachments.length;
      if (remaining <= 0) throw new Error(`最多添加 ${MAX_NOTE_ATTACHMENTS} 张截图`);
      const attachments = await imageAttachmentsFromFiles(files, remaining);
      setDraft((current) => ({
        ...current,
        attachments: [...current.attachments, ...attachments].slice(0, MAX_NOTE_ATTACHMENTS)
      }));
      setWriteBackState({
        status: "idle",
        message: files.length > remaining ? `最多保留 ${MAX_NOTE_ATTACHMENTS} 张截图` : undefined
      });
    } catch (error) {
      setWriteBackState({
        status: "error",
        message: error instanceof Error ? error.message : "读取截图失败"
      });
    }
  }

  return (
    <aside className="detail-drawer" aria-label="事项详情">
      <header className="detail-header">
        <div>
          <ItemMeta item={item} sectionMap={sectionMap} />
          <h2>{draft.title || "未命名事项"}</h2>
        </div>
        <button className="icon-button" type="button" title="关闭详情" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="detail-section detail-form">
        <label>
          标题
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <div className="detail-form-grid">
          <label>
            类型
            <select
              value={draft.type}
              onChange={(event) => {
                const type = event.target.value as ItemType;
                setDraft((current) => {
                  if (type === "avoid") return ensureReverseTodoDraft(current);
                  if (type === "note") {
                    return {
                      ...current,
                      type,
                      status: "wanted",
                      allDay: false,
                      startAt: "",
                      endAt: "",
                      startDate: "",
                      endDate: ""
                    };
                  }
                  return { ...current, type };
                });
              }}
            >
              {TYPE_ORDER.map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type]}</option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={draft.status}
              onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ItemStatus }))}
            >
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="detail-form-grid">
          <label>
            版块
            <select
              value={draft.sectionId}
              onChange={(event) => setDraft((current) => ({ ...current, sectionId: event.target.value }))}
            >
              {sections.map((nextSection) => (
                <option key={nextSection.id} value={nextSection.id}>
                  {nextSection.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            标签
            <input
              value={draft.tagsText}
              onChange={(event) => setDraft((current) => ({ ...current, tagsText: event.target.value }))}
            />
          </label>
        </div>
        {draft.type !== "note" ? (
          <>
        <div className="detail-form-grid">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  allDay: event.target.checked,
                  startDate: current.startDate || current.startAt.slice(0, 10),
                  endDate: current.endDate || current.endAt.slice(0, 10) || current.startAt.slice(0, 10)
                }))
              }
            />
            全天
          </label>
        </div>
        {draft.allDay ? (
          <div className="detail-form-grid">
            <label>
              开始日期
              <input
                type="date"
                value={draft.startDate}
                onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                value={draft.endDate}
                onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))}
              />
            </label>
          </div>
        ) : (
          <div className="detail-form-grid">
            <label>
              开始时间
              <input
                type="datetime-local"
                value={draft.startAt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    startAt: event.target.value,
                    startDate: event.target.value.slice(0, 10)
                  }))
                }
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                value={draft.endAt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    endAt: event.target.value,
                    endDate: event.target.value.slice(0, 10)
                  }))
                }
              />
            </label>
          </div>
        )}
          </>
        ) : null}
        <label>
          描述
          <textarea
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
          />
        </label>
        {draft.type === "note" ? (
          <div className="detail-attachments">
            <div className="detail-attachments-header">
              <div>
                <strong>截图</strong>
                <span>{draft.attachments.length}/{MAX_NOTE_ATTACHMENTS}</span>
              </div>
              <label className="note-upload-button">
                <ImagePlus size={16} />
                添加截图
                <input
                  className="visually-hidden"
                  type="file"
                  accept={SUPPORTED_CAPTURE_IMAGE_TYPES.join(",")}
                  multiple
                  onChange={(event) => {
                    void appendDraftAttachments(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {draft.attachments.length ? (
              <div className="detail-attachment-grid">
                {draft.attachments.map((attachment) => (
                  <figure key={attachment.id}>
                    <img src={attachment.dataUrl} alt={attachment.name} />
                    <figcaption>{attachment.name}</figcaption>
                    <button
                      type="button"
                      title="移除截图"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        attachments: current.attachments.filter((candidate) => candidate.id !== attachment.id)
                      }))}
                    >
                      <X size={14} />
                    </button>
                  </figure>
                ))}
              </div>
            ) : <p>可以添加或粘贴截图，保存后会进入本地缓存和 JSON 快照。</p>}
          </div>
        ) : null}
        <div className="writeback-row">
          <button
            className="button"
            type="button"
            onClick={() => void saveDetails()}
            disabled={!isDirty || writeBackState.status === "loading"}
          >
            保存
          </button>
          {isDirty ? <span className="writeback-message">有未保存修改</span> : null}
        </div>
      </div>

      {item.type !== "note" ? (
      <div className="detail-section compact-status">
        <label>
          快速状态
          <select value={item.status} onChange={(event) => void onStatusChange(event.target.value as ItemStatus)}>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {status === "active" && itemDisplayStatus(item) === "history" ? "历史待确认" : STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </div>
      ) : null}

      <div className="detail-grid">
        <DetailField label="类型" value={TYPE_LABELS[item.type]} />
        {item.type === "avoid" ? <DetailField label="约定阶段" value={reverseTodoPhaseLabel(getReverseTodoPhase(item))} /> : null}
        <DetailField label="版块" value={section?.name ?? item.sectionId} />
        <DetailField label="来源" value={sourceLabel(item)} />
        <DetailField label="更新时间" value={formatDateTime(item.updatedAt)} />
        {item.type === "note" ? <DetailField label="截图" value={`${item.attachments?.length ?? 0} 张`} /> : null}
        {item.startAt || item.allDay ? <DetailField label="全天" value={item.allDay ? "是" : "否"} /> : null}
        {item.startAt ? <DetailField label={item.allDay ? "开始日期" : "开始时间"} value={formatItemDateTime(item, item.startAt)} /> : null}
        {item.endAt ? <DetailField label={item.allDay ? "结束日期" : "结束时间"} value={formatItemDateTime(item, item.endAt)} /> : null}
      </div>

      {sourceLink ? (
        <div className="detail-section">
          <h3>同步信息</h3>
          <dl className="source-fields">
            <DetailPair label="sourceId" value={sourceLink.sourceId} />
            {sourceLink.sourcePath ? <DetailPair label="sourcePath" value={sourceLink.sourcePath} /> : null}
            {sourceLink.calendarId ? <DetailPair label="calendarId" value={sourceLink.calendarId} /> : null}
            {sourceLink.eventId ? <DetailPair label="eventId" value={sourceLink.eventId} /> : null}
            <DetailPair label="writeBack" value={sourceLink.provider === "google_calendar" ? "标题、描述和时间可写回" : writeBackLabel(sourceLink.writeBack)} />
            {sourceLink.line ? <DetailPair label="line" value={String(sourceLink.line)} /> : null}
            {sourceLink.etag ? <DetailPair label="etag" value={sourceLink.etag} /> : null}
            {sourceLink.frontmatterHash ? <DetailPair label="frontmatter" value={sourceLink.frontmatterHash.slice(0, 12)} /> : null}
            {sourceLink.bodyHash ? <DetailPair label="body" value={sourceLink.bodyHash.slice(0, 12)} /> : null}
          </dl>
          {sourceLink.writeBack !== "none" ? (
            <div className="writeback-row">
              <button
                className="button"
                type="button"
                onClick={() => void writeBackHumanFile()}
                disabled={writeBackState.status === "loading"}
              >
                写回{humanFileWriteBackTarget(sourceLink).label}
              </button>
              {writeBackState.message ? (
                <span className={`writeback-message ${writeBackState.status}`}>
                  {writeBackState.message}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {canCreateGoogleCalendarEvent ? (
        <div className="detail-section">
          <h3>Google Calendar</h3>
          <div className="writeback-row">
            <button
              className="button"
              type="button"
              onClick={() => void createGoogleCalendarFromDraft()}
              disabled={!hasGoogleSyncDate || writeBackState.status === "loading"}
            >
              同步到 Google Calendar
            </button>
            {writeBackState.message ? (
              <span className={`writeback-message ${writeBackState.status}`}>
                {writeBackState.message}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="detail-section">
        <h3>描述</h3>
        {draft.description ? <pre className="markdown-preview">{draft.description}</pre> : <EmptyState text="还没有描述。" />}
      </div>

      <footer className="detail-footer">
        {item.type !== "note" ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setDraft((current) => ({ ...current, status: "done" }));
              void onSave({ status: "done" });
            }}
          >
            {item.type === "avoid" ? (getReverseTodoPhase(item) === "expired" ? "守住了" : "结束约定") : "标记完成"}
          </button>
        ) : <span />}
        <button className="button danger-button" type="button" onClick={() => void onDelete()}>
          删除
        </button>
      </footer>
    </aside>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type DetailDraft = {
  title: string;
  type: ItemType;
  status: ItemStatus;
  sectionId: string;
  tagsText: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startAt: string;
  endAt: string;
  description: string;
  attachments: ItemAttachment[];
};

function draftFromItem(item: Item): DetailDraft {
  const startDate = item.startAt
    ? item.allDay
      ? storedAllDayDateKey(item.startAt)
      : localDateKey(new Date(item.startAt))
    : "";
  const endDate = item.endAt
    ? item.allDay
      ? storedAllDayDateKey(item.endAt)
      : localDateKey(new Date(item.endAt))
    : startDate;

  return {
    title: item.title,
    type: item.type,
    status: item.status,
    sectionId: item.sectionId,
    tagsText: item.tags.join(", "),
    allDay: Boolean(item.allDay),
    startDate,
    endDate,
    startAt: dateTimeLocalValue(item.startAt),
    endAt: dateTimeLocalValue(item.endAt),
    description: item.description,
    attachments: [...(item.attachments ?? [])]
  };
}

function patchFromDraft(draft: DetailDraft): Partial<Item> {
  const startAt = draft.allDay ? isoFromLocalDateInput(draft.startDate) : isoFromDateTimeLocal(draft.startAt);
  const rawEndAt = draft.allDay ? isoFromLocalDateInput(draft.endDate || draft.startDate) : isoFromDateTimeLocal(draft.endAt);
  const endAt = startAt && rawEndAt && new Date(rawEndAt) < new Date(startAt) ? startAt : rawEndAt;

  return {
    title: draft.title.trim(),
    type: draft.type,
    status: draft.status,
    sectionId: draft.sectionId,
    tags: splitTags(draft.tagsText),
    allDay: draft.allDay || undefined,
    startAt,
    endAt,
    description: draft.description,
    attachments: draft.attachments.length ? draft.attachments : undefined
  };
}

function noteTitle(form: QuickAddForm): string {
  const explicitTitle = form.title.trim();
  if (explicitTitle) return explicitTitle;
  const firstLine = form.description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine.slice(0, 80);
  if (form.attachments.length) return `截图沉淀 ${formatDateTime(new Date().toISOString())}`;
  return "未命名沉淀";
}

async function imageAttachmentsFromFiles(files: File[], limit: number): Promise<ItemAttachment[]> {
  const selectedFiles = files.slice(0, Math.max(0, limit));
  for (const file of selectedFiles) {
    if (!isSupportedCaptureImageType(file.type)) {
      throw new Error(`${file.name} 不是支持的截图格式（PNG、JPEG、WebP 或 GIF）`);
    }
    if (file.size > MAX_NOTE_ATTACHMENT_BYTES) throw new Error(`${file.name} 超过 5 MB`);
  }

  return Promise.all(selectedFiles.map(async (file) => ({
    id: crypto.randomUUID(),
    name: file.name || "clipboard-image.png",
    mimeType: file.type,
    size: file.size,
    dataUrl: await fileAsDataUrl(file),
    createdAt: new Date().toISOString()
  })));
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取 ${file.name || "截图"} 失败`));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(`读取 ${file.name || "截图"} 失败`));
    };
    reader.readAsDataURL(file);
  });
}

function defaultReverseTodoPeriod(now = new Date()): { startAt: string; endAt: string } {
  const roundedStart = new Date(now);
  roundedStart.setSeconds(0, 0);
  roundedStart.setMinutes(Math.ceil(roundedStart.getMinutes() / 5) * 5);
  const end = new Date(roundedStart.getTime() + 24 * 60 * 60 * 1000);
  return {
    startAt: dateTimeLocalValue(roundedStart.toISOString()),
    endAt: dateTimeLocalValue(end.toISOString())
  };
}

function validateReverseTodoPeriod(startAt: string, endAt: string): string | null {
  return validateReverseTodoSchedule({ type: "avoid", startAt, endAt });
}

function validateReverseTodoDraft(draft: DetailDraft): string | null {
  if (draft.type !== "avoid") return null;
  const startAt = draft.allDay ? draft.startDate : draft.startAt;
  const endAt = draft.allDay ? draft.endDate : draft.endAt;
  return validateReverseTodoPeriod(startAt, endAt);
}

function ensureReverseTodoDraft(draft: DetailDraft): DetailDraft {
  const period = defaultReverseTodoPeriod();
  return {
    ...draft,
    type: "avoid",
    status: draft.status === "wanted" ? "active" : draft.status,
    allDay: false,
    startAt: draft.startAt || period.startAt,
    endAt: draft.endAt || period.endAt,
    startDate: (draft.startAt || period.startAt).slice(0, 10),
    endDate: (draft.endAt || period.endAt).slice(0, 10)
  };
}

function compareReverseTodos(left: Item, right: Item, now = new Date()): number {
  const rank = { active: 0, upcoming: 1, expired: 2, unscheduled: 3, invalid: 4 } as const;
  const phaseOrder = rank[getReverseTodoPhase(left, now)] - rank[getReverseTodoPhase(right, now)];
  if (phaseOrder) return phaseOrder;
  return (left.endAt ?? left.updatedAt).localeCompare(right.endAt ?? right.updatedAt);
}

function reverseTodoPhaseLabel(phase: ReturnType<typeof getReverseTodoPhase>): string {
  return {
    active: "生效中",
    upcoming: "即将开始",
    expired: "已到期",
    unscheduled: "待补时间",
    invalid: "时间有误"
  }[phase];
}

function formatReverseTodoWindow(item: Item, now = new Date()): string {
  if (!item.startAt || !item.endAt) return "尚未设置约定时段";
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "约定时段无效";

  const phase = getReverseTodoPhase(item, now);
  const range = `${formatDateTime(item.startAt)} → ${formatDateTime(item.endAt)}`;
  if (phase === "active") return `${range} · 还剩 ${formatCompactDuration(end.getTime() - now.getTime())}`;
  if (phase === "upcoming") return `${range} · ${formatCompactDuration(start.getTime() - now.getTime())}后开始`;
  if (phase === "expired") return `${range} · 时段已结束`;
  return range;
}

function formatCompactDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  return `${minutes}分钟`;
}

function attachmentIds(attachments: ItemAttachment[]): string {
  return attachments.map((attachment) => attachment.id).join(",");
}

function splitTags(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function dateTimeLocalValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function dateTimeLocalForDay(day: Date, hours: number): string {
  return dateTimeLocalValue(
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, 0, 0, 0).toISOString()
  );
}

function isoFromDateTimeLocal(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function isoFromLocalDateInput(value: string): string | undefined {
  return allDayIsoFromDateKey(value);
}

function DetailPair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ItemMeta({ item, sectionMap }: { item: Item; sectionMap: Map<string, Section> }) {
  const section = sectionMap.get(item.sectionId);
  return (
    <div className="item-meta">
      <span className={`type-pill ${item.type}`}>
        {item.type === "idea" ? <Lightbulb size={13} /> : null}
        {item.type === "todo" ? <ClipboardList size={13} /> : null}
        {item.type === "event" ? <CalendarDays size={13} /> : null}
        {item.type === "avoid" ? <Ban size={13} /> : null}
        {item.type === "note" ? <NotebookPen size={13} /> : null}
        {TYPE_LABELS[item.type]}
      </span>
      {item.type === "avoid" ? (
        <span className={`reverse-phase ${getReverseTodoPhase(item)}`}>
          {reverseTodoPhaseLabel(getReverseTodoPhase(item))}
        </span>
      ) : item.type === "note" ? (
        <span>{item.attachments?.length ? `${item.attachments.length} 张截图` : "文字记录"}</span>
      ) : <span>{DISPLAY_STATUS_LABELS[itemDisplayStatus(item)]}</span>}
      <span>{section?.name ?? item.sectionId}</span>
      {item.source === "github" ? <span>GitHub</span> : null}
      {item.type === "avoid" ? <span>{formatReverseTodoWindow(item)}</span> : item.startAt ? <span>{formatDateTime(item.startAt)}</span> : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Archive size={18} />
      {text}
    </div>
  );
}

function isTodayItem(item: Item): boolean {
  if (!item.startAt) return false;
  return localDateKey(itemStartDay(item)) === localDateKey(new Date());
}

type CalendarDragState = {
  kind: "move" | "resize-start" | "resize-end";
  itemId: string;
  grabOffsetDays: number;
  pointerId: number;
  startX: number;
  startY: number;
  didMove: boolean;
  targetDayKey?: string;
};

interface CalendarSegment {
  item: Item;
  itemStart: Date;
  itemEnd: Date;
  visibleStart: Date;
  visibleEnd: Date;
  weekStart: Date;
  weekEnd: Date;
  startColumn: number;
  endColumn: number;
  lane: number;
}

function buildCalendarWeeks(month: Date): Date[][] {
  const calendarDays = buildCalendarDays(month);
  return Array.from({ length: 6 }, (_, weekIndex) =>
    calendarDays.slice(weekIndex * 7, weekIndex * 7 + 7)
  );
}

function buildCalendarSegments(weeks: Date[][], items: Item[]): Map<number, CalendarSegment[]> {
  const segmentsByWeek = new Map<number, CalendarSegment[]>();

  weeks.forEach((week, weekIndex) => {
    const weekStart = startOfDay(week[0]);
    const weekEnd = startOfDay(week[6]);
    const rawSegments = items
      .filter((item) => item.startAt)
      .map((item) => {
        const itemStart = itemStartDay(item);
        const itemEnd = itemEndDay(item);
        if (itemEnd < weekStart || itemStart > weekEnd) return null;

        const visibleStart = itemStart < weekStart ? weekStart : itemStart;
        const visibleEnd = itemEnd > weekEnd ? weekEnd : itemEnd;

        return {
          item,
          itemStart,
          itemEnd,
          visibleStart,
          visibleEnd,
          weekStart,
          weekEnd,
          startColumn: daysBetween(weekStart, visibleStart) + 1,
          endColumn: daysBetween(weekStart, visibleEnd) + 2,
          lane: 0
        };
      })
      .filter((segment): segment is CalendarSegment => Boolean(segment))
      .sort((a, b) => {
        const startOrder = a.startColumn - b.startColumn;
        const spanOrder = b.endColumn - b.startColumn - (a.endColumn - a.startColumn);
        return startOrder || spanOrder || a.item.title.localeCompare(b.item.title);
      });

    const laneEnds: number[] = [];
    rawSegments.forEach((segment) => {
      const lane = laneEnds.findIndex((endColumn) => endColumn <= segment.startColumn);
      const nextLane = lane === -1 ? laneEnds.length : lane;
      segment.lane = nextLane;
      laneEnds[nextLane] = segment.endColumn;
    });

    segmentsByWeek.set(weekIndex, rawSegments);
  });

  return segmentsByWeek;
}

function countItemsByCalendarDay(items: Item[]): Map<string, number> {
  const counts = new Map<string, number>();

  items.forEach((item) => {
    if (!item.startAt) return;
    const start = itemStartDay(item);
    const end = itemEndDay(item);
    const spanDays = Math.min(daysBetween(start, end), 365);

    for (let offset = 0; offset <= spanDays; offset += 1) {
      const key = localDateKey(addDays(start, offset));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });

  return counts;
}

function calendarPatchForDrop(
  item: Item,
  targetDay: Date,
  dragKind: CalendarDragState["kind"],
  grabOffsetDays = 0
): Partial<Item> {
  if (!item.startAt) return {};

  const start = new Date(item.startAt);
  const end = item.endAt ? new Date(item.endAt) : undefined;

  if (item.allDay) {
    const startKey = storedAllDayDateKey(item.startAt);
    const endKey = storedAllDayDateKey(item.endAt ?? item.startAt);
    const targetKey = localDateKey(addDays(targetDay, -grabOffsetDays));

    if (dragKind === "move") {
      const durationDays = Math.max(0, daysBetweenDateKeys(startKey, endKey));
      return {
        startAt: allDayIsoFromDateKey(targetKey),
        endAt: item.endAt
          ? allDayIsoFromDateKey(addDaysToDateKey(targetKey, durationDays))
          : undefined
      };
    }

    if (dragKind === "resize-start") {
      const nextStartKey = targetKey > endKey ? endKey : targetKey;
      return {
        startAt: allDayIsoFromDateKey(nextStartKey),
        endAt: allDayIsoFromDateKey(endKey)
      };
    }

    const nextEndKey = targetKey < startKey ? startKey : targetKey;
    return {
      endAt: allDayIsoFromDateKey(nextEndKey)
    };
  }

  if (dragKind === "move") {
    const nextStart = dateWithTime(addDays(targetDay, -grabOffsetDays), start);
    const durationMs = end ? Math.max(0, end.getTime() - start.getTime()) : 0;

    return {
      startAt: nextStart.toISOString(),
      endAt: end ? new Date(nextStart.getTime() + durationMs).toISOString() : undefined
    };
  }

  if (dragKind === "resize-start") {
    const currentEnd = end ?? start;
    const requestedStart = dateWithTime(targetDay, start);
    const nextStart = requestedStart > currentEnd ? dateWithTime(currentEnd, start) : requestedStart;

    return {
      startAt: nextStart.toISOString(),
      endAt: end ? currentEnd.toISOString() : start.toISOString()
    };
  }

  const requestedEnd = dateWithTime(targetDay, end ?? start);
  const nextEnd = requestedEnd < start ? start : requestedEnd;

  return {
    endAt: nextEnd.toISOString()
  };
}

function calendarGrabOffsetDays(segment: CalendarSegment, clientX: number, clientY: number): number {
  const grabbedDay = calendarDayFromPoint(clientX, clientY) ?? segment.visibleStart;
  return Math.max(0, daysBetween(segment.itemStart, startOfDay(grabbedDay)));
}

function previewCalendarItemsForDrag(items: Item[], dragState: CalendarDragState | null): Item[] {
  if (!dragState?.didMove || !dragState.targetDayKey) return items;

  const item = items.find((candidate) => candidate.id === dragState.itemId);
  if (!item) return items;

  const patch = calendarPatchForDrop(
    item,
    dateFromLocalDateKey(dragState.targetDayKey),
    dragState.kind,
    dragState.grabOffsetDays
  );
  if (!calendarPatchChangesItem(item, patch)) return items;

  return items.map((candidate) =>
    candidate.id === item.id
      ? {
          ...candidate,
          ...patch
        }
      : candidate
  );
}

function calendarPatchChangesItem(item: Item, patch: Partial<Item>): boolean {
  return (
    (Object.hasOwn(patch, "startAt") && (patch.startAt ?? undefined) !== item.startAt) ||
    (Object.hasOwn(patch, "endAt") && (patch.endAt ?? undefined) !== item.endAt)
  );
}

function itemOverlapsMonth(item: Item, month: Date): boolean {
  if (!item.startAt) return false;
  const monthStart = startOfDay(startOfMonth(month));
  const monthEnd = startOfDay(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const itemStart = itemStartDay(item);
  const itemEnd = itemEndDay(item);
  return itemEnd >= monthStart && itemStart <= monthEnd;
}

function itemEndDay(item: Item): Date {
  if (!item.startAt) return startOfDay(new Date());
  const start = itemStartDay(item);
  if (!item.endAt) return start;
  const end = item.allDay
    ? dateFromLocalDateKey(storedAllDayDateKey(item.endAt))
    : startOfDay(new Date(item.endAt));
  return end < start ? start : end;
}

function itemStartDay(item: Item): Date {
  if (!item.startAt) return startOfDay(new Date());
  return item.allDay
    ? dateFromLocalDateKey(storedAllDayDateKey(item.startAt))
    : startOfDay(new Date(item.startAt));
}

function calendarDayFromPoint(clientX: number, clientY: number): Date | null {
  const target = document.elementFromPoint(clientX, clientY);
  const weekElement = target?.closest<HTMLElement>("[data-calendar-week-start]");
  if (!weekElement) return null;

  const weekStartValue = weekElement.dataset.calendarWeekStart;
  if (!weekStartValue) return null;

  const weekStart = dateFromLocalDateKey(weekStartValue);
  const rect = weekElement.getBoundingClientRect();
  const rawColumn = Math.floor(((clientX - rect.left) / rect.width) * 7);
  const column = Math.max(0, Math.min(6, rawColumn));
  return addDays(weekStart, column);
}

function buildCalendarDays(month: Date): Date[] {
  const firstDay = startOfMonth(month);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / msPerDay);
}

function daysBetweenDateKeys(start: string, end: string): number {
  const startIso = allDayIsoFromDateKey(start);
  const endIso = allDayIsoFromDateKey(end);
  if (!startIso || !endIso) return 0;
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / (24 * 60 * 60 * 1000));
}

function dateWithTime(day: Date, timeSource: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds(),
    timeSource.getMilliseconds()
  );
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function isSameMonth(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function storedAllDayDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const isCanonicalUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  return isCanonicalUtcMidnight ? allDayDateKeyFromIso(value) : localDateKey(date);
}

function dateFromLocalDateKey(value: string): Date {
  const [year = "0", month = "1", day = "1"] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function formatMonthTitle(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long"
  }).format(value);
}

function formatEventTime(value?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCalendarRange(item: Item): string {
  if (!item.startAt) return "";
  if (item.allDay) {
    const startKey = storedAllDayDateKey(item.startAt);
    const endKey = storedAllDayDateKey(item.endAt ?? item.startAt);
    if (startKey === endKey) return "全天";
    const formatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
    return `${formatter.format(dateFromLocalDateKey(startKey))} - ${formatter.format(dateFromLocalDateKey(endKey))}`;
  }
  const start = new Date(item.startAt);
  const end = item.endAt ? new Date(item.endAt) : undefined;
  const startDay = localDateKey(start);
  const endDay = end ? localDateKey(end) : startDay;

  if (!end || startDay === endDay) {
    return formatEventTime(item.startAt);
  }

  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });

  return `${dateFormatter.format(start)} - ${dateFormatter.format(end)}`;
}

function formatDateTime(value?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatItemDateTime(item: Item, value: string): string {
  if (!item.allDay) return formatDateTime(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(dateFromLocalDateKey(storedAllDayDateKey(value)));
}

function writeBackLabel(value: SourceFileSummary["writeBack"]): string {
  if (value === "frontmatter-only") return "只回写 frontmatter";
  if (value === "full-file") return "可回写全文";
  return "只读";
}

function snapshotSaveMessage(
  payload: {
    sourcePath?: string;
    itemCount?: number;
    mergeSummary?: {
      remoteItemsKept?: number;
      remoteSectionsKept?: number;
      remoteSettingsKept?: number;
    };
  },
  fallbackItemCount: number
): string {
  const remoteKept =
    (payload.mergeSummary?.remoteItemsKept ?? 0) +
    (payload.mergeSummary?.remoteSectionsKept ?? 0) +
    (payload.mergeSummary?.remoteSettingsKept ?? 0);
  const message = `已保存 ${payload.itemCount ?? fallbackItemCount} 条事项到 ${payload.sourcePath ?? "GitHub 快照"}`;
  return remoteKept > 0 ? `${message}，并合并远端保留 ${remoteKept} 条` : message;
}

function sourceLabel(item: Item): string {
  if (item.source === "github") return "GitHub";
  if (item.source === "google_calendar") return "Google Calendar";
  return "本地";
}
