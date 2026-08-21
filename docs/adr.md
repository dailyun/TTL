# TodoTodoList 架构决策记录 v0.1

ADR 用来记录当前阶段的关键选择。状态说明：

- Accepted：已由用户明确确认。
- Proposed：作为 v0.1 推荐默认方案，等待用户最终确认。
- Deferred：暂不进入 v0.1。

## ADR-001 首页采用「收集箱 + 今日 + 正在」

Status: Accepted

决策：

- 首页第一屏采用「收集箱 + 今日 + 正在」。

原因：

- 收集箱解决快速记录后的整理问题。
- 今日解决日程和时间压力。
- 正在解决当前推进焦点。
- 比纯看板或纯日历更符合“想法 + 事件 + Todo”的混合产品定位。

影响：

- 首页不做营销页。
- 首页不以统计图为主。
- 首页是实际工作台。

## ADR-002 GitHub 私有库作为远端数据仓库

Status: Accepted

决策：

- GitHub 私有库作为用户可自由读取的远端数据仓库。
- IndexedDB 作为本地缓存、离线写入和同步队列。
- 不把传统数据库作为 v0.1 的主存储。

原因：

- 用户明确需要从其他地方自由读取数据库。
- GitHub 私有库中的 JSON 文件便于外部工具、脚本、备份系统读取。
- 传统数据库部署自由度较低，且会引入账号、服务和迁移成本。

影响：

- 需要稳定、可读、版本化的数据文件结构。
- 需要处理 GitHub Contents API 的 sha、速率限制和并发冲突。
- 不能把 GitHub token 直接暴露在前端。
- 复杂查询需要在应用层或本地索引完成。

## ADR-003 GitHub 文件结构采用 manifest + 月分片

Status: Proposed

决策：

- v0.1 默认采用 manifest + 月分片文件，而不是单个巨大 snapshot。

推荐结构：

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
```

原因：

- 比单 snapshot 更适合长期同步。
- 文件仍然可读，用户可以直接打开 JSON。
- 按月份组织更符合 Todo/Event 的时间属性。
- 比每个 Item 一个文件更少 API 请求。

替代方案：

- 单 snapshot：实现更快，但长期冲突范围大，不利于外部读取局部数据。
- 单 Item 文件：冲突小，但文件数量和 API 请求更多。

v0.1 取舍：

- 采用月分片。
- 如果开发复杂度过高，可以临时使用 snapshot 启动原型，但正式同步设计不以 snapshot 为终态。

## ADR-003B 支持人工可读写 Markdown 文件源

Status: Accepted

决策：

- 除系统结构化 JSON 外，支持从 GitHub 私有库中的人工 Markdown 目录同步内容。
- 典型路径如 `findwork/**/*.md`。
- Markdown 使用 YAML frontmatter 表达结构化字段，正文作为 description。
- 系统默认只回写 frontmatter，不重写人工正文。

原因：

- 用户明确希望 GitHub 私有库可以人工读写。
- 用户希望 `findwork` 下的一些文件可以同步进系统。
- Markdown + frontmatter 对人和程序都友好。

影响：

- 需要 `sources.json` 配置人工文件源。
- 需要 Markdown/frontmatter 解析器。
- 需要保存 `sourcePath`、`sourceSha`、`bodyHash` 等同步元数据。
- 冲突策略必须保护人工正文，不能静默覆盖。

## ADR-004 Google Calendar 第一阶段直接做双向同步

Status: Accepted

决策：

- 第一阶段按双向同步设计，不走只读导入路线。

原因：

- 用户明确要求直接做双向同步。
- TodoTodoList 的事件管理需要避免用户在两个日历系统重复维护。

范围限制：

- v0.1 只支持用户选择的一个 Google Calendar。
- 本地 Event 默认可同步。
- 有 startAt 的 Todo 可以选择同步。
- Idea 默认不同步。
- 复杂重复事件不在 v0.1 中深度编辑。

影响：

- 需要 CalendarLink 映射表。
- 需要 outbox。
- 需要冲突检测。
- 需要删除、放弃、取消同步的明确行为。

## ADR-005 技术栈推荐 Next.js + React

Status: Proposed

决策：

- v0.1 推荐使用 Next.js + React。

原因：

- 需要 API routes / server actions 代理 GitHub 和 Google token。
- 后续部署到 Vercel 或类似平台更直接。
- React 生态适合看板、日历、复杂表单。
- Next.js 可以同时承载前端和轻量后端同步接口。

替代方案：

- Vite + React：前端更轻，但仍需要额外 serverless/API 服务承载 token 和同步。
- 纯静态前端：不适合安全处理 GitHub / Google token。

推荐配套：

- IndexedDB: Dexie
- State: Zustand
- Server cache/request: TanStack Query
- Calendar UI: FullCalendar
- Drag and drop: dnd-kit
- Validation: Zod

## ADR-006 v0.1 单用户优先

Status: Proposed

决策：

- v0.1 按单用户个人工具设计。

原因：

- 当前核心目标是个人想法、事件、Todo 管理。
- GitHub 私有库作为个人数据仓库更自然。
- 多人协作会显著改变权限、冲突、数据模型和同步策略。

影响：

- 暂不做团队、成员、权限、评论、分配。
- 后续如要多人协作，应作为 v2.0 方向重新设计。

## ADR-007 v0.1 日历优先周视图

Status: Proposed

决策：

- v0.1 日历默认做周视图。

原因：

- 周视图更适合把 Todo/Event 安排到具体时间。
- 比月视图更能服务“今日 + 正在”的首页逻辑。
- 比日视图更适合规划接下来几天。

影响：

- 月视图和日视图可后续增加。
- Google Calendar 同步仍保存完整时间数据，不受视图限制。

## ADR-008 v0.1 详情使用右侧抽屉

Status: Proposed

决策：

- Item 详情编辑使用右侧抽屉。

原因：

- 不打断看板、列表、日历上下文。
- 适合频繁修改状态、时间、版块。
- 比独立详情页更轻，符合个人工作台定位。

影响：

- 移动端可转为全屏 sheet。
- 深链详情页可以后续补充。
