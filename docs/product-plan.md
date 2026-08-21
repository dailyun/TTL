# TodoTodoList 产品方案 v0.1

## 1. 产品定位

TodoTodoList 是一个面向个人的想法、任务与日程管理 Web 应用。它的核心目标不是替代重型项目管理工具，而是把日常产生的「想做的事」「正在做的事」「已经安排时间的事」「暂时不做的想法」放在一个可整理、可回顾、可同步的系统里。

一句话定位：

> 一个把 Todo、想法和日程统一管理的个人工作台。

## 2. 目标用户

优先服务以下用户：

- 个人使用者：需要统一管理生活、工作、学习事项。
- 独立开发者 / 创作者：经常产生想法，需要把灵感和执行任务分开管理。
- 产品经理 / 知识工作者：需要在任务、想法、会议、日程之间快速切换。
- 未来可扩展到轻量团队，但 v1 不以多人协作为核心。

## 3. 核心问题

现有工具通常会把信息拆散：

- Todo 工具适合执行，但不适合承载模糊想法。
- 日历适合确定时间，但不适合管理未定计划。
- 笔记工具适合记录，但推进状态和提醒能力较弱。
- 项目管理工具能力强，但对个人使用偏重。

TodoTodoList 要解决的问题是：让一个事项从「想法」到「行动」再到「日程」的流转足够自然。

## 4. 产品原则

- 快速记录优先：新增一个想法或 Todo 不应超过几秒。
- 状态清晰：用户随时知道哪些在做、哪些只是想做、哪些已经搁置。
- 分类轻量：工作、生活等版块帮助聚焦，但不能变成维护负担。
- 日历连接但不绑架：有时间的事项进入日历，没有时间的事项仍可以自然存在。
- 数据可控：GitHub 私有库作为用户拥有的远端数据仓库，支持导出、迁移和外部读取，避免被单一平台锁死。

## 5. 核心对象模型

建议不要把所有内容都抽象成 Todo，而是保留三种主要对象：

| 类型 | 用途 | 时间属性 |
| --- | --- | --- |
| Todo | 明确要完成的任务 | 可选 |
| Idea | 想法、灵感、备忘、愿望 | 通常可选 |
| Event | 会议、约会、行程、已确定安排 | 必须有开始时间，通常有结束时间 |

统一字段建议：

```ts
type ItemType = "todo" | "idea" | "event";
type ItemStatus = "wanted" | "active" | "paused" | "abandoned" | "done";

interface Item {
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
  source: "local" | "google_calendar";
  externalId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}
```

版块字段：

```ts
interface Section {
  id: string;
  name: string;
  color?: string;
  sortOrder: number;
  archivedAt?: string;
}
```

## 6. 状态设计

建议保留用户提出的四种状态，并补充「完成」：

| 状态 | 中文 | 含义 |
| --- | --- | --- |
| wanted | 想要 | 想做、想尝试、未来可能处理 |
| active | 正在 | 当前正在推进 |
| paused | 搁置 | 暂时不处理，但不删除 |
| abandoned | 放弃 | 明确不再推进，保留记录 |
| done | 完成 | 已完成或已发生 |

产品视角建议：

- 「放弃」和「完成」都应从主工作视图中弱化，但可以在归档/历史里查看。
- 「搁置」不是失败，而是主动降噪，应该支持之后恢复。
- Idea 可以从 wanted 转为 active，也可以拆分出 Todo。
- Todo 可以被安排时间后进入日历视图，但不一定需要变成 Event。

## 7. 信息架构

建议第一版包含以下视图：

- 收集箱：所有未分类或快速记录的内容。
- 看板：按状态展示 wanted / active / paused / abandoned / done。
- 版块：按工作、生活、自定义版块组织内容。
- 日历：展示有时间的 Todo 和 Event，以及同步来的第三方日历事件。
- 搜索：按标题、描述、标签、状态、版块查找。
- 设置：日历连接、GitHub 同步、数据导入导出。

## 8. MVP 范围

第一阶段建议聚焦个人可用闭环：

1. 快速新增 Todo / Idea / Event。
2. 默认版块：工作、生活。
3. 自定义版块。
4. 状态管理：想要、正在、搁置、放弃、完成。
5. 看板视图，支持拖拽修改状态。
6. 列表视图，支持过滤版块、状态、类型。
7. 日历视图，展示本地有时间的事项。
8. GitHub 私有库远端数据存储。
9. Google Calendar 双向同步。
10. 本地 IndexedDB 缓存和离线队列。
11. JSON 导出与导入。

暂不进入 MVP 的能力：

- 多人协作。
- 评论、分配、审批。
- 复杂重复任务规则。
- 多第三方日历同时双向同步。
- 移动端原生 App。

## 9. Google Calendar 集成方案

### 已确认方向

Google Calendar 第一阶段直接做双向同步，但需要控制同步范围：

- 只同步用户明确选择的一个 Google Calendar。
- 本地 Event 与有明确 startAt 的 Todo 可以同步到 Google Calendar。
- Google Calendar 事件变化可以同步回本地 Event。
- Idea 默认不同步到 Google Calendar。
- 重复事件第一版限制编辑范围，避免错误覆盖复杂规则。

### 同步策略

需要建立本地 Item 与 Google Event 的映射：

- 本地 Item 保存 externalId、externalCalendarId、externalUrl 和 etag。
- 本地创建或修改 Event 时写入 Google Calendar。
- Google Calendar 事件变更时更新本地 Event。
- 删除、取消、放弃需要有明确策略。
- 同一事件双边修改时进入冲突处理。

双向同步需要处理：

- OAuth 授权与 token 刷新。
- 增量同步 token。
- 删除事件的 tombstone 记录。
- 重复事件。
- 时区。
- 本地修改与远端修改冲突。

Google Calendar API 支持增量同步。官方文档说明，首次同步后可保存 `nextSyncToken`，之后用它只获取变化事件。参考资料：[Google Calendar API - Synchronize resources](https://developers.google.com/workspace/calendar/api/guides/sync)。

## 10. GitHub 私有库作为数据库的可行性

### 结论

GitHub 私有库确认作为用户拥有的远端数据仓库，而不是传统数据库。它承担跨设备同步、外部读取、版本化和数据可迁移的职责。同时，它需要支持人工可读写的 Markdown 文件源，例如 `findwork/**/*.md`，让用户可以继续用编辑器或 GitHub 直接维护内容。

更准确的定位：

> GitHub 私有库是远端事实来源，IndexedDB 是本地缓存、离线写入和同步队列。

### 可行的数据组织

建议按目录分片，避免单目录文件过多：

```txt
data/
  sections.json
  settings.json
  items/
    2026/
      07/
        item_01H....json
        item_01J....json
  sync/
    google-calendar.json
```

推荐采用按时间批量文件，便于用户和外部脚本读取：

```txt
data/
  items/
    2026-07.json
    2026-08.json
```

按月文件更适合早期产品，因为读写次数更少，结构更简单。缺点是同月并发编辑时冲突范围更大，因此需要 item 级合并策略。

除系统结构化数据外，还支持人工文件源：

```txt
findwork/
  product-plan.md
  meeting-notes.md
  ideas/
    calendar-sync.md
```

这些 Markdown 文件可以通过 YAML frontmatter 声明 type、status、section、tags 和时间字段；正文作为 Item description；系统默认只回写 frontmatter，避免破坏人工正文。

### 优点

- 私有仓库可控，用户拥有数据。
- Git 天然保存历史版本。
- 适合 JSON / Markdown 等可读格式。
- 支持 `findwork/**/*.md` 这类人工目录同步进系统。
- 便于备份、迁移、导出和外部读取。
- 对开发者用户有吸引力。

### 主要限制

- GitHub Contents API 是文件级读写，不是数据库查询。
- 更新文件时通常需要携带当前文件的 `sha`，否则可能发生冲突。
- 官方文档提示，对同一路径的 create/update/delete 应串行处理，避免并发冲突。
- API 有速率限制，不适合高频实时写入。
- GitHub 私有库 token 不能直接暴露在前端。
- 查询、分页、全文搜索、复杂筛选都需要应用自己处理。

参考资料：

- [GitHub REST API - Repository contents](https://docs.github.com/en/rest/repos/contents)
- [GitHub REST API - Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [GitHub REST API - Fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)

### 推荐实现

早期推荐：

```txt
GitHub Private Repo
  -> App API / sync worker
    -> 浏览器 IndexedDB
    -> Google Calendar API
```

运行时读写路径：

```txt
用户操作
  -> IndexedDB 即时写入
  -> outbox 同步队列
  -> App API 写入 GitHub / Google Calendar
```

不要让浏览器直接持有 GitHub Personal Access Token。可以选择：

- 后端 API route 代理 GitHub 请求。
- GitHub OAuth App。
- GitHub App。
- 用户自部署时通过环境变量配置 token。

### 是否可作为主数据源

| 场景 | 是否推荐 |
| --- | --- |
| 单用户、低频到中频写入、开发者自用 | 推荐 |
| 单用户、多设备同步 | 推荐，但需要冲突处理 |
| 多用户协作 | 不推荐 |
| 实时编辑 | 不推荐 |
| 复杂查询和报表 | 不推荐 |
| 长期商业化 SaaS | 不推荐作为主数据库 |

如果未来要支持多用户和稳定商业化，可以再引入 Postgres / Supabase / SQLite + sync 服务 / Firebase 等方案。但当前产品方向优先尊重数据自由度，GitHub 私有库作为用户可读取的数据源。

## 11. 推荐技术路线

个人 Web 应用第一版：

- 前端框架：Next.js 或 Vite + React。
- 本地存储：IndexedDB 作为缓存和离线队列。
- 状态管理：Zustand。
- 数据请求：TanStack Query。
- 日历组件：FullCalendar 或 React Big Calendar。
- 拖拽：dnd-kit。
- 后端能力：Next.js API routes / server actions / serverless functions。
- 第三方日历：Google Calendar API。
- GitHub 同步：GitHub REST Contents API。

推荐架构：

```txt
Web App
  -> IndexedDB cache + outbox
  -> App API / sync worker
      -> GitHub Private Repo as remote data source
      -> Google Calendar API two-way sync
```

## 12. 版本规划

### v0.1 本地可用

- Todo / Idea / Event 创建与编辑。
- 工作 / 生活版块。
- 状态管理。
- 看板视图。
- 本地持久化。
- JSON 导出。

### v0.2 组织能力

- 自定义版块。
- 标签。
- 搜索与过滤。
- 归档历史。
- 基础快捷输入。

### v0.3 日历视图

- 本地日历视图。
- 有时间事项展示。
- Event 与 Todo 的时间编辑。

### v0.4 Google Calendar 双向同步

- Google OAuth。
- 读取选定日历事件。
- 本地 Event 推送到 Google Calendar。
- Google Calendar 事件变化同步回本地。
- 冲突检测与基础冲突提示。

### v0.5 GitHub 私有库远端数据源

- 连接 GitHub 私有仓库。
- 初始化远端数据目录。
- 拉取远端数据到 IndexedDB。
- 推送本地变更到 GitHub。
- item 级合并和冲突提示。
- 人工 Markdown 文件源导入和 frontmatter-only 回写。

### v1.0 稳定同步

- Google Calendar 双向同步。
- GitHub 自动同步。
- 冲突处理。
- 更完整的数据导入导出。
- 响应式移动端体验。

## 13. 核心用户流程

### 快速记录想法

1. 用户打开应用。
2. 在收集箱输入一句话。
3. 默认创建为 Idea，状态为 wanted。
4. 用户之后可归入工作 / 生活 / 自定义版块。

### 把想法变成行动

1. 用户在 wanted 列看到一个 Idea。
2. 将状态拖到 active。
3. 可拆分为一个或多个 Todo。
4. 为 Todo 添加截止日期或安排具体时间。

### 管理日程

1. 用户打开日历视图。
2. 看到本地 Event / 有时间的 Todo / Google Calendar 外部事件。
3. 用户可编辑同步事件。
4. 本地修改会推送回 Google Calendar，远端修改会同步回本地。

### 清理系统

1. 用户查看 paused 和 wanted。
2. 将不再处理的内容标记为 abandoned。
3. 将已处理的内容标记为 done。
4. 历史仍可搜索和回顾。

## 14. 关键产品决策

需要和你确认的问题：

1. 产品优先做个人单用户，还是一开始考虑多人协作？
2. 首页已确认为收集箱 + 今日 + 正在。
3. Todo、Idea、Event 三类是否符合你的思考方式？
4. 状态是否确定为：想要、正在、搁置、放弃、完成？
5. Google Calendar 第一版已确认直接做双向同步，是否先限制为单日历？
6. GitHub 私有库已确认作为远端数据源，文件结构选择月分片还是单 snapshot？
7. 你更希望界面风格接近 Todoist、Notion、Linear，还是 Google Calendar？
8. 是否需要「目标 / 项目」这一层级，放在版块和事项之间？

## 15. 建议的默认答案

如果先追求快速做出可用产品，建议默认选择：

- 单用户优先。
- 首页为收集箱 + 今日 / 正在事项。
- 看板作为核心管理视图。
- 日历作为有时间事项的辅助视图。
- Google Calendar v1 直接双向同步。
- GitHub 私有库作为远端数据源。
- 本地 IndexedDB 作为缓存和离线队列。
- 暂不做多人协作。

## 16. 下一步

建议下一轮先确定以下三件事：

1. 技术栈：Next.js 还是 Vite + React。
2. GitHub 数据结构：月分片优先还是单 snapshot 优先。
3. Google Calendar 双向同步：第一版是否只支持单日历。

确认后可以继续输出：

- 详细 PRD。
- 页面原型结构。
- 数据库 / 本地存储 schema。
- API 设计。
- 迭代任务拆分。
- 第一版 Web 应用脚手架和可运行原型。
