# TodoTodoList 技术设计草案 v0.1

## 1. 架构目标

第一版技术架构应支持：

- 浏览器本地可用。
- 数据可导出。
- 第一阶段支持 Google Calendar 双向同步。
- 使用 GitHub 私有库作为用户可自由读取的远端数据仓库。
- 避免把敏感 token 暴露在前端。

推荐路线：

```txt
React Web App
  -> IndexedDB local cache + outbox
  -> App API / serverless functions
      -> GitHub REST Contents API as remote data source
      -> Google Calendar API two-way sync
```

## 2. 技术栈建议

推荐：

- Framework: Next.js
- UI: React
- State: Zustand
- Data cache: TanStack Query
- Local DB: IndexedDB, 推荐 Dexie 封装，用于缓存、离线写入和同步队列
- Calendar UI: FullCalendar
- Drag and drop: dnd-kit
- Date utils: date-fns
- Validation: Zod

如果想更轻：

- Vite + React
- IndexedDB + Dexie
- Cloudflare Pages Functions 或 Vercel Functions

## 3. 数据实体

### Item

```ts
export type ItemType = "todo" | "idea" | "event";
export type ItemStatus = "wanted" | "active" | "paused" | "abandoned" | "done";
export type ItemSource = "local" | "google_calendar";

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  description?: string;
  sectionId: string;
  status: ItemStatus;
  priority?: "low" | "medium" | "high";
  tags: string[];
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  source: ItemSource;
  externalId?: string;
  externalCalendarId?: string;
  externalUrl?: string;
  remoteVersion?: string;
  lastSyncedAt?: string;
  deletedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Section

```ts
export interface Section {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isInbox?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Settings

```ts
export interface Settings {
  defaultSectionId: string;
  calendarDefaultView: "week" | "month" | "day";
  showDoneInCalendar: boolean;
  showAbandonedInBoard: boolean;
  github?: GitHubSyncSettings;
  googleCalendar?: GoogleCalendarSettings;
}
```

### Sync metadata

```ts
export interface SyncMetadata {
  provider: "github" | "google_calendar";
  lastSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  cursor?: string;
  status: "idle" | "syncing" | "error";
  errorMessage?: string;
}
```

## 4. IndexedDB 设计

建议 stores：

```txt
items
sections
settings
syncMetadata
outbox
calendarLinks
```

索引：

```txt
items:
  id
  type
  status
  sectionId
  startAt
  updatedAt
  source
  externalId

sections:
  id
  sortOrder

outbox:
  id
  provider
  status
  createdAt

calendarLinks:
  itemId
  provider
  calendarId
  eventId
```

outbox 用于同步：

- 本地变更先写入 IndexedDB。
- 再写入 outbox。
- 后台或手动同步时逐条提交到 GitHub / Google。
- 成功后标记 synced。

## 5. GitHub 私有库同步设计

### 推荐定位

GitHub 私有库作为用户拥有的远端数据仓库。它不是传统数据库，但在本产品里承担远端事实来源的角色；IndexedDB 是本地缓存、离线写入和同步队列。

选择这个方向的原因：

- 用户可以从其他工具、脚本和设备自由读取 JSON 数据。
- GitHub 私有库天然有版本历史和可迁移性。
- 不依赖传统数据库部署，降低平台锁定。

需要接受的限制：

- GitHub Contents API 是文件读写，不是复杂查询数据库。
- 文件更新需要处理 sha 和冲突。
- 频繁自动保存容易触发速率和二级限制。
- token 管理不适合纯前端暴露。

### 远端文件结构

推荐使用 manifest + 按月分片：

```txt
todotodolist/
  manifest.json
  sections.json
  settings.json
  items/
    2026/
      07.json
      08.json
  sync/
    github.json
    google-calendar.json
  sources.json

findwork/
  product-plan.md
  meeting-notes.md
```

优点：

- 用户可以直接查看和读取。
- 文件不会过度集中在单目录。
- 比单 item 文件减少 API 请求。
- 比单 snapshot 更适合增量同步。
- 可以额外配置 `findwork/**/*.md` 这类人工可读写文件源。

### manifest schema

```ts
export interface Manifest {
  app: "todotodolist";
  version: 1;
  updatedAt: string;
  files: {
    sections: string;
    settings: string;
    items: string[];
    sync: string[];
  };
}
```

### item shard schema

```ts
export interface ItemShard {
  app: "todotodolist";
  version: 1;
  shard: string;
  updatedAt: string;
  items: Item[];
}
```

### human source schema

```ts
export interface HumanSource {
  id: string;
  label: string;
  path: string;
  mode: "read-only" | "read-write";
  defaultSectionId: string;
  defaultType: ItemType;
  defaultStatus: ItemStatus;
  importCheckboxes: boolean;
  writeBack: "none" | "frontmatter-only" | "full-file";
}

export interface SourcesFile {
  version: 1;
  sources: HumanSource[];
}

export interface ItemSourceLink {
  provider: "github";
  sourceId: string;
  sourcePath: string;
  sourceSha?: string;
  frontmatterHash?: string;
  bodyHash?: string;
  writeBack: "none" | "frontmatter-only" | "full-file";
}
```

Item 需要增加：

```ts
sourceLink?: ItemSourceLink;
```

### 同步模式

MVP 需要支持：

- 初次连接 GitHub 私有库。
- 从远端 GitHub 数据初始化 IndexedDB。
- 读取 `sources.json` 并扫描人工 Markdown 文件源。
- 本地写入后通过 outbox 推送到 GitHub。
- 应用启动或手动刷新时从 GitHub 拉取变化。
- item 级合并和冲突提示。
- 人工 Markdown 文件默认只回写 frontmatter。

后续增强：

- 自动后台同步。
- 多设备合并。
- 更细粒度增量文件。

### API 设计草案

```txt
POST /api/github/connect
GET  /api/github/manifest
GET  /api/github/file
POST /api/github/push
POST /api/github/pull
```

注意：

- `/api/github/connect` 不应把用户 token 返回给前端。
- 自部署版本可以通过环境变量提供 token。
- SaaS 版本应使用 GitHub OAuth App 或 GitHub App。

## 6. Google Calendar 同步设计

### v0.4 双向同步

目标：

- 用户授权 Google Calendar。
- 应用读取一个选定日历。
- 本地 Event / 有 startAt 的 Todo 可以创建或更新 Google Calendar 事件。
- Google Calendar 事件变化可以同步回本地。
- 删除、取消、放弃和冲突都有明确策略。

数据策略：

- 与本地事项有关联的 Google Event 进入 `calendarLinks`。
- Google 中新增的事件可以创建本地 Event。
- 本地 Idea 默认不同步到 Google。
- 复杂重复事件第一版保留 Google 版本，不自动覆盖复杂规则。

CalendarLink：

```ts
interface CalendarLink {
  itemId: string;
  provider: "google_calendar";
  calendarId: string;
  eventId: string;
  etag?: string;
  htmlLink?: string;
  lastPulledAt?: string;
  lastPushedAt?: string;
}
```

同步元数据：

```ts
interface GoogleCalendarSyncState {
  calendarId: string;
  syncToken?: string;
  lastFullSyncAt?: string;
  lastIncrementalSyncAt?: string;
}
```

### 增量同步

Google Calendar API 支持首次全量同步后保存 `nextSyncToken`，后续请求只拉取变化。实现时需要处理：

- sync token 失效后重新全量同步。
- deleted/cancelled 事件。
- recurrence 实例。
- timezone。

### 本地到 Google

触发条件：

- 新建 Event。
- 修改已同步 Event 的标题、描述、时间。
- 删除或放弃已同步 Event。
- Todo 添加 startAt 并选择同步到日历。

流程：

1. 写入 IndexedDB。
2. 写入 outbox。
3. App API 调用 Google Calendar insert / update / delete。
4. 保存 eventId、etag、lastPushedAt。

### Google 到本地

触发条件：

- 应用启动。
- 用户手动同步。
- 后台定时同步。

流程：

1. 使用 syncToken 增量拉取。
2. 新增事件创建本地 Event。
3. 修改事件更新本地 Event。
4. cancelled 事件写入 deletedAt 或标记 abandoned。
5. syncToken 失效时重新全量同步。

## 7. 冲突策略

MVP：

- GitHub 文件 sha 冲突时，重新拉取远端文件并进行 item 级合并。
- 同一 Item 本地与 GitHub 远端都修改时，默认保留 updatedAt 较新版本。
- 删除冲突中，如果 deletedAt 晚于另一端 updatedAt，则删除优先。
- Google Calendar 双边修改时，展示本地版本和 Google 版本，由用户选择。
- 复杂重复事件冲突时，优先保留 Google 版本并提示限制。

后续：

- 支持字段级冲突提示。
- 支持冲突历史。
- 支持自动合并非重叠字段。

## 8. 导入导出

导出：

- 生成 snapshot JSON。
- 文件名：`todotodolist-snapshot-YYYY-MM-DD.json`。

导入：

- 校验 app 和 version。
- 校验字段结构。
- 预览导入数量。
- 用户选择覆盖或合并。

合并规则：

- id 相同：updatedAt 较新的覆盖。
- id 不同：新增。
- deletedAt 存在：保留删除标记。

## 9. 安全注意事项

- 前端不保存 GitHub PAT 明文。
- OAuth token 应放在服务端或安全会话中。
- 本地 IndexedDB 数据默认未加密，敏感信息不建议存入描述字段。
- 导出文件需要提醒用户自行保护。
- 如果接入 Google Calendar，权限 scope 要保持最小化。

## 10. 待确认

- 第一版使用 Next.js 还是 Vite。
- GitHub 同步是个人自部署优先，还是 SaaS OAuth 优先。
- GitHub 文件结构第一版是否采用 manifest + 月分片。
- Google Calendar 第一版是否只支持单日历。
- 是否需要端到端加密。
