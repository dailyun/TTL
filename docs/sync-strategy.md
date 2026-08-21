# TodoTodoList 同步策略 v0.1

本策略根据用户已确认方向制定：

- 首页采用「收集箱 + 今日 + 正在」。
- GitHub 私有库需要作为用户可自由读取的远端数据仓库。
- Google Calendar 第一阶段直接做双向同步。

## 1. 总体架构

```txt
Web App
  -> IndexedDB: 本地缓存、离线写入、同步队列
  -> App API: token 安全代理、同步编排
      -> GitHub Private Repo: 用户拥有的远端数据仓库
      -> Google Calendar API: 第三方日历双向同步
```

核心原则：

- GitHub 私有库是远端事实来源，文件格式必须稳定、可读、可被其他工具读取。
- IndexedDB 是本地体验层，负责快速读写、离线和冲突前缓存。
- Google Calendar 是外部日程系统，和本地 Event / 有时间的 Todo 建立双向映射。
- 所有同步都需要保留 `updatedAt`、`deletedAt`、`sourceVersion` 和外部 ID。

## 2. GitHub 私有库数据结构

为了方便用户从其他地方读取，不建议长期只保存一个巨大 snapshot。推荐使用 manifest + 分片数据：

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
  ideas/
    calendar-sync.md
```

### manifest.json

```json
{
  "app": "todotodolist",
  "version": 1,
  "updatedAt": "2026-07-07T00:00:00.000Z",
  "files": {
    "sections": "sections.json",
    "settings": "settings.json",
    "items": ["items/2026/07.json"]
  }
}
```

### items 分片

按月份分片：

- 方便按时间查找。
- 文件数量不会集中在单目录。
- 人可以直接打开 JSON 查看。
- 比单 item 文件更少 API 请求。

每个 item 保留稳定 ID：

```json
{
  "items": [
    {
      "id": "item_01J...",
      "type": "todo",
      "title": "写产品方案",
      "status": "active",
      "sectionId": "work",
      "startAt": "2026-07-07T06:00:00.000Z",
      "updatedAt": "2026-07-07T06:20:00.000Z",
      "deletedAt": null
    }
  ]
}
```

### 人工可读写文件源

除了系统结构化 JSON，GitHub 私有库还需要支持人工可读写的 Markdown 文件源，例如：

```txt
findwork/**/*.md
```

这些文件通过 `sources.json` 配置进入系统：

```json
{
  "version": 1,
  "sources": [
    {
      "id": "findwork",
      "path": "findwork/**/*.md",
      "mode": "read-write",
      "defaultSectionId": "work",
      "defaultType": "idea",
      "defaultStatus": "wanted",
      "importCheckboxes": true,
      "writeBack": "frontmatter-only"
    }
  ]
}
```

Markdown 文件使用 YAML frontmatter 保存结构化字段，正文作为 description。系统回写时默认只更新 frontmatter，避免破坏人工编辑的正文。完整规则见 `docs/github-human-files.md`。

## 3. GitHub 同步流程

### 初次连接

1. 用户配置 GitHub owner / repo / branch / path。
2. 应用通过服务端 API 验证权限。
3. 如果路径为空，初始化 manifest、sections、settings、items。
4. 如果路径已有数据，读取 manifest 并导入 IndexedDB。
5. 如果配置了 `sources.json`，扫描人工文件源并导入匹配文件。

### 本地写入

1. 用户创建或修改 Item。
2. 写入 IndexedDB。
3. 追加 outbox 记录。
4. UI 立即更新。
5. 后台同步 outbox 到 GitHub。

### 拉取远端

1. 读取 manifest。
2. 比较 manifest.updatedAt 与本地 lastRemoteUpdatedAt。
3. 拉取变化分片。
4. 扫描 sources.json 中声明的人工文件源。
5. 解析新增或变化的 Markdown 文件。
6. 逐条合并到 IndexedDB。
7. 更新 sync metadata。

### 写入远端

1. 读取目标文件和 sha。
2. 合并本地 outbox 变更。
3. 写回 GitHub Contents API。
4. 更新 manifest。
5. 标记 outbox synced。

## 4. GitHub 冲突策略

冲突类型：

- 同一 Item 本地和远端都被修改。
- 本地修改，但远端已删除。
- 本地删除，但远端已修改。
- 同一分片文件 sha 已变化。
- 人工 Markdown 文件正文被用户修改，同时系统也有本地修改。

MVP 冲突策略：

- 文件 sha 冲突时，重新拉取远端文件再做 item 级合并。
- 同一 Item 双端修改时，默认保留 `updatedAt` 较新的版本。
- 如果一端 deletedAt 存在，且 deletedAt 晚于另一端 updatedAt，删除优先。
- 冲突无法自动解决时，保留两个版本并提示用户选择。
- 人工 Markdown 正文冲突时默认保留远端正文，只回写 frontmatter，避免覆盖人工内容。

## 5. Google Calendar 双向同步范围

第一阶段直接做双向同步，但范围要收窄：

- 只同步用户明确选择的 Google Calendar。
- 只把本地 Event 和带明确 startAt 的 Todo 同步到 Google。
- Idea 默认不同步到 Google。
- 重复事件第一阶段不编辑复杂重复规则，遇到复杂规则时提示用户限制。

## 6. Google Calendar 映射

本地 Item 与 Google Event 映射：

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

映射规则：

- 本地 Event 创建后，可推送为 Google Event。
- Google Event 拉取后，可创建或更新本地 Event。
- 本地 Todo 如果有 startAt，也可以推送为 Google Event。
- 本地 Item 的 description 可以写入 Google Event description。
- status 为 abandoned 的 Item 默认从 Google 删除或取消同步，需要用户设置确认。

## 7. Google Calendar 双向流程

### 首次同步

1. 用户授权 Google Calendar。
2. 选择要同步的 calendar。
3. 拉取该 calendar 的事件。
4. 建立本地 Event 或 CalendarLink。
5. 保存 `nextSyncToken`。

### 本地到 Google

触发条件：

- 新建 Event。
- 修改 Event 时间、标题、描述。
- 删除或放弃已同步 Event。
- 带 startAt 的 Todo 选择同步到日历。

流程：

1. 本地写入 IndexedDB。
2. 追加 google outbox。
3. 调用 Google Calendar insert / update / delete。
4. 保存 eventId、etag 和 lastPushedAt。

### Google 到本地

触发条件：

- 用户手动同步。
- 应用启动后后台同步。
- 定时同步。

流程：

1. 使用 syncToken 增量拉取。
2. 对新增事件创建本地 Event。
3. 对修改事件更新本地 Event。
4. 对 cancelled 事件写入 deletedAt 或标记为 abandoned。
5. syncToken 失效时重新全量同步。

## 8. Google Calendar 冲突策略

冲突判断：

- 本地 Item 的 updatedAt 晚于 lastPulledAt。
- Google Event 的 updated 时间晚于 lastPushedAt。
- 双方都变更时视为冲突。

MVP 策略：

- 非冲突：自动应用较新的单边变更。
- 双边冲突：弹出冲突面板，展示本地版本和 Google 版本。
- 删除冲突：删除优先级低于明确编辑；如果一边删除、一边编辑，询问用户恢复还是删除。
- 重复事件冲突：先保留 Google 版本，不自动覆盖复杂规则。

## 9. 安全边界

- GitHub 和 Google token 不进入前端持久化存储。
- 本地 IndexedDB 可以保存业务数据和同步状态，但不保存长期访问 token。
- 自部署版本可以通过环境变量配置 GitHub token。
- 面向多用户的部署应使用 GitHub OAuth App / GitHub App 和 Google OAuth。

## 10. 实施建议

为了降低第一版风险，建议同步能力分阶段上线，但产品设计按双向同步建模：

1. 先实现 GitHub 初始化、拉取、推送和 item 级合并。
2. 再实现 Google Calendar 单日历双向同步。
3. 最后加入冲突 UI、自动后台同步和复杂重复事件处理。
