# TodoTodoList MVP 范围冻结草案 v0.1

这份文档用于把第一版范围收束到可以开工的粒度。除非用户明确反对，以下内容作为 v0.1 默认范围。

## 1. v0.1 产品目标

做出一个可运行的个人工作台，支持：

- 快速记录想法、Todo 和事件。
- 用工作、生活和自定义版块组织内容。
- 用想要、正在、搁置、放弃、完成管理状态。
- 首页展示收集箱、今日和正在。
- 用 GitHub 私有库作为远端数据仓库。
- 支持从 `findwork/**/*.md` 这类人工 Markdown 文件源同步内容。
- 用 IndexedDB 提供本地缓存和离线体验。
- 与一个 Google Calendar 做双向同步。

## 2. v0.1 必须交付

### 产品能力

- 快速新增 Item。
- Todo / Idea / Event 三种类型。
- 收集箱 / 工作 / 生活默认版块。
- 自定义版块。
- 状态管理：想要 / 正在 / 搁置 / 放弃 / 完成。
- 首页：收集箱 + 今日 + 正在。
- 列表视图。
- 看板视图。
- 周日历视图。
- 详情抽屉。
- JSON 导入导出。

### 数据能力

- IndexedDB 本地缓存。
- outbox 同步队列。
- GitHub manifest 初始化。
- GitHub 月分片读写。
- GitHub `sources.json` 人工文件源。
- Markdown frontmatter 解析。
- 人工 Markdown 文件 frontmatter-only 回写。
- 从 GitHub 拉取并恢复完整数据。
- 本地变更推送到 GitHub。
- item 级合并。

### Google Calendar 能力

- Google OAuth。
- 选择一个日历。
- 本地 Event 推送到 Google Calendar。
- 有 startAt 的 Todo 可选择同步。
- Google Calendar 事件同步回本地。
- 基础冲突识别。
- 删除 / 放弃 / 取消同步有明确提示。

## 3. v0.1 明确不做

- 多用户和团队协作。
- 权限系统。
- 评论和分配。
- 多 Google Calendar 同时同步。
- 复杂重复事件编辑。
- 浏览器通知提醒。
- AI 自动拆任务。
- 原生移动端 App。
- 端到端加密。
- 实时多人编辑。
- 非 Markdown 文件的富解析。
- 自动重写人工 Markdown 正文。

## 4. 默认技术选择

- Framework: Next.js + React。
- Deployment: Vercel 优先，自部署 Node.js 备选。
- Local DB: IndexedDB + Dexie。
- State: Zustand。
- Data fetching/cache: TanStack Query。
- Calendar UI: FullCalendar。
- Drag and drop: dnd-kit。
- Validation: Zod。
- Data source: GitHub Private Repo + JSON/Markdown files。

## 5. 成功标准

v0.1 可以视为成功，当且仅当：

- 用户可以完成从记录、分类、推进状态到安排日程的闭环。
- 刷新页面后数据不丢。
- GitHub 私有库中可以看到可读 JSON 数据。
- `findwork/**/*.md` 这类人工 Markdown 文件可以同步进系统。
- 系统回写不会静默覆盖人工 Markdown 正文。
- 换设备或清空本地后能从 GitHub 恢复。
- 本地创建/修改的 Event 可以同步到 Google Calendar。
- Google Calendar 中的修改可以同步回本地。
- 冲突不会静默覆盖用户数据。

## 6. 第一批实现顺序

建议顺序：

1. Next.js 项目基础。
2. 类型定义和 IndexedDB。
3. 默认版块和种子数据。
4. 快速新增、列表和详情抽屉。
5. 首页三栏。
6. 看板和状态修改。
7. 周日历。
8. GitHub manifest + 月分片读写。
9. GitHub sources.json + Markdown frontmatter 导入。
10. outbox 和 item 级合并。
11. Google Calendar OAuth。
12. CalendarLink 和双向同步。
13. 冲突提示。
14. JSON 导入导出。

## 7. 仍需用户最终确认

- 是否接受 Next.js + React 作为技术栈。
- GitHub 文件结构是否接受 manifest + 月分片。
- Google Calendar v0.1 是否只做单日历。
- 是否同意 v0.1 不做提醒和复杂重复事件。
- 人工文件源 v0.1 是否只支持 Markdown。
