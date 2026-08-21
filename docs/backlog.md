# TodoTodoList 开发任务拆分 v0.1

这份 backlog 以当前确认方案为假设：单用户、首页为「收集箱 + 今日 + 正在」、Next.js + React、GitHub 私有库作为远端数据仓库、IndexedDB 作为本地缓存和离线队列、Google Calendar 第一阶段直接做双向同步。若剩余 P0 决策变化，需要重新调整任务。

## Epic 1: 项目基础

### TDL-001 初始化 Web 项目

目标：

- 建立可运行的前端项目。

验收标准：

- `npm run dev` 可以启动本地开发服务器。
- 首页能渲染基础 App Shell。
- TypeScript、lint、format 基础配置可用。

### TDL-002 建立基础路由与布局

目标：

- 实现左侧导航、顶部快速新增入口和主内容区。

验收标准：

- 支持首页、收集箱、全部、看板、日历、版块、设置入口。
- 当前路由有选中态。
- 移动端布局不出现明显横向溢出。

## Epic 2: 数据模型与本地存储

### TDL-003 定义核心类型

目标：

- 定义 Item、Section、Settings、SyncMetadata 类型。

验收标准：

- 类型覆盖 Todo / Idea / Event。
- 状态覆盖 wanted / active / paused / abandoned / done。
- 类型定义与 `docs/technical-design.md` 保持一致。

### TDL-004 建立 IndexedDB 数据层

目标：

- 使用 IndexedDB 保存本地数据。

验收标准：

- 支持 items、sections、settings、syncMetadata stores。
- 提供 create、update、delete、list、get 方法。
- 刷新页面后数据不丢失。

### TDL-005 初始化默认数据

目标：

- 首次打开应用时创建默认版块。

验收标准：

- 自动创建收集箱、工作、生活。
- 收集箱不能删除。
- 重复打开不会重复创建默认版块。

## Epic 3: Item 管理

### TDL-006 快速新增 Item

目标：

- 用户可以快速创建 Todo / Idea / Event。

验收标准：

- 只输入标题即可创建。
- 默认类型为 Idea。
- 默认状态为 wanted。
- 默认进入收集箱。
- 可以选择类型、状态、版块和时间。

### TDL-007 Item 详情编辑

目标：

- 用户可以编辑 Item 的完整字段。

验收标准：

- 点击列表、看板卡片或日历项可打开详情。
- 可编辑标题、描述、类型、状态、版块、标签、时间。
- 保存后视图立即更新。

### TDL-008 删除与软删除

目标：

- 支持删除 Item，保留未来同步需要的删除标记。

验收标准：

- 删除前有确认。
- 数据层记录 deletedAt。
- 默认视图不显示 deletedAt 存在的 Item。

## Epic 4: 列表与过滤

### TDL-009 全部事项列表

目标：

- 展示所有非删除 Item。

验收标准：

- 列表展示标题、类型、状态、版块、时间。
- 支持按更新时间排序。
- 空状态文案可见。

### TDL-010 过滤器

目标：

- 用户可以按属性筛选事项。

验收标准：

- 支持类型、状态、版块、是否有时间过滤。
- 多个过滤器可以组合。
- 过滤状态在当前页面切换期间保留。

## Epic 5: 状态看板

### TDL-011 看板视图

目标：

- 按状态展示 Item。

验收标准：

- 展示想要、正在、搁置、放弃、完成五列。
- 每列显示数量。
- 卡片展示标题、类型、版块和时间。

### TDL-012 修改状态

目标：

- 用户可以从看板修改 Item 状态。

验收标准：

- 支持菜单修改状态。
- 若实现拖拽，拖动到其他列后状态更新。
- 状态修改会更新 updatedAt。

## Epic 6: 版块管理

### TDL-013 版块列表

目标：

- 展示所有版块及事项数量。

验收标准：

- 显示收集箱、工作、生活和自定义版块。
- 每个版块显示未完成事项数量。
- 归档版块默认隐藏。

### TDL-014 自定义版块

目标：

- 用户可以创建和编辑版块。

验收标准：

- 支持新建、重命名、改色、调整排序。
- 支持归档版块。
- 归档版块不会删除其中事项。

## Epic 7: 本地日历

### TDL-015 周日历视图

目标：

- 展示本周有时间的 Todo 和 Event。

验收标准：

- startAt 存在的 Item 显示在日历。
- abandoned 默认不显示。
- done 是否显示由设置控制。

### TDL-016 从日历创建 Event

目标：

- 用户可以从日历时间格创建 Event。

验收标准：

- 点击空白时间打开新增表单。
- 默认类型为 Event。
- 默认填入点击的日期和时间。

## Epic 8: GitHub 私有库远端数据源

### TDL-017 GitHub 连接配置

目标：

- 配置用户自己的 GitHub 私有库作为远端数据仓库。

验收标准：

- 支持 owner、repo、branch、path。
- 可以测试连接和写入权限。
- token 不暴露在前端代码或持久化浏览器存储中。

### TDL-018 初始化远端数据目录

目标：

- 在 GitHub 私有库中创建可读的数据结构。

验收标准：

- 创建 manifest.json、sections.json、settings.json 和 items 分片。
- 创建 sources.json。
- 文件格式可以被外部脚本直接读取。
- 重复初始化不会破坏已有数据。

### TDL-019 GitHub 拉取与恢复

目标：

- 从 GitHub 私有库读取远端数据到 IndexedDB。

验收标准：

- 能读取 manifest 和 item 分片。
- 能从远端恢复 sections、settings、items。
- 拉取失败不破坏本地现有数据。

### TDL-020 GitHub 推送与合并

目标：

- 把本地 outbox 变更同步到 GitHub。

验收标准：

- 写入时处理 GitHub 文件 sha。
- sha 冲突时重新拉取并 item 级合并。
- 成功后更新 manifest 和 sync metadata。

### TDL-021 配置人工文件源

目标：

- 用户可以配置 `findwork/**/*.md` 这类人工 Markdown 文件源。

验收标准：

- 支持 source id、path、mode、defaultSectionId、defaultType、defaultStatus。
- 配置写入 sources.json。
- 支持 read-only 和 read-write。

### TDL-022 Markdown frontmatter 导入

目标：

- 把人工 Markdown 文件导入为 Item。

验收标准：

- 支持 YAML frontmatter。
- 没有 frontmatter 时使用 H1 或文件名作为 title。
- Markdown body 映射到 description。
- 保存 sourcePath、sourceSha、frontmatterHash、bodyHash。

### TDL-023 Markdown checkbox 导入

目标：

- 把 Markdown checkbox 导入为 Todo。

验收标准：

- `- [ ]` 导入为未完成 Todo。
- `- [x]` 导入为 done Todo。
- 支持 `<!-- tdl:id=item_xxx -->` 作为稳定 ID。
- 第一版不要求自动回写 checkbox 状态。

### TDL-024 人工文件 frontmatter 回写

目标：

- 系统修改 Item 后能安全回写人工 Markdown 文件 metadata。

验收标准：

- 默认只更新 frontmatter。
- 不重写 Markdown body。
- GitHub sha 变化时重新拉取并提示冲突。
- 冲突时默认保留远端正文。

## Epic 9: Google Calendar 双向同步

### TDL-025 Google OAuth 连接

目标：

- 用户授权读写 Google Calendar。

验收标准：

- 授权用途说明清晰，明确会读写用户选择的日历。
- token 不暴露在前端明文中。
- 用户可以断开连接。

### TDL-026 CalendarLink 数据模型

目标：

- 建立本地 Item 与 Google Event 的映射。

验收标准：

- 保存 itemId、calendarId、eventId、etag、lastPulledAt、lastPushedAt。
- 支持一个 Item 关联一个 Google Event。
- 断开同步时能保留本地 Item。

### TDL-027 本地推送到 Google Calendar

目标：

- 本地 Event / 有 startAt 的 Todo 可以写入 Google Calendar。

验收标准：

- 新建本地 Event 后创建 Google Event。
- 修改标题、描述、时间后更新 Google Event。
- 删除或放弃已同步 Item 时有明确删除或取消同步行为。

### TDL-028 Google Calendar 拉取到本地

目标：

- Google Calendar 事件变化可以同步回本地。

验收标准：

- 首次同步能拉取选定日历事件。
- 增量同步能处理新增、修改、cancelled。
- syncToken 失效时能重新全量同步。

### TDL-029 Google Calendar 冲突处理

目标：

- 识别并处理双边修改。

验收标准：

- 本地和 Google 双边修改时展示冲突。
- 用户可以选择保留本地版本或 Google 版本。
- 复杂重复事件不被静默覆盖。

## Epic 10: 导入导出

### TDL-030 JSON 导出

目标：

- 导出完整本地数据。

验收标准：

- 导出文件包含 items、sections、settings、syncMetadata。
- 文件名包含日期。
- 导出 JSON 可被再次导入。

### TDL-031 JSON 导入

目标：

- 从 snapshot 恢复数据。

验收标准：

- 导入前校验 app 和 version。
- 导入前展示数量预览。
- 支持覆盖或合并。
- id 相同使用 updatedAt 较新的版本。

## 建议开发顺序

1. TDL-001 到 TDL-005：项目和数据地基。
2. TDL-006 到 TDL-010：完成本地 Item 管理闭环。
3. TDL-011 到 TDL-014：看板和版块。
4. TDL-015 到 TDL-020：日历和 GitHub 远端数据源。
5. TDL-021 到 TDL-024：人工 Markdown 文件源。
6. TDL-025 到 TDL-029：Google Calendar 双向同步。
7. TDL-030 到 TDL-031：导入导出。

## 暂不拆分

以下功能先不进入第一版 backlog：

- 多人协作。
- 复杂重复事项。
- 浏览器通知提醒。
- Google Calendar 多日历同步。
- GitHub 高频实时同步。
- 非 Markdown 文件解析。
- 自动重写人工 Markdown 正文。
- 原生移动端 App。
