# TodoTodoList 实施路线 v0.1

## 1. 里程碑

### M0 产品确认

产出：

- 产品方案。
- PRD。
- 页面结构。
- 技术设计草案。

验收：

- 已明确单用户优先或多人优先。
- 已明确首页形态。
- 已明确主数据策略。
- 已明确 Google Calendar 第一阶段范围。

### M1 本地原型

产出：

- Next.js + React 可运行 Web 应用。
- 本地 IndexedDB 持久化。
- 快速新增。
- 列表视图。
- 默认版块。
- 状态修改。

验收：

- 用户能创建 Todo / Idea / Event。
- 刷新页面后数据仍存在。
- 能按类型、状态、版块过滤。

### M2 GitHub 远端数据源

产出：

- GitHub 私有库连接。
- manifest + 数据分片初始化。
- 从 GitHub 拉取到 IndexedDB。
- 本地变更推送到 GitHub。
- `sources.json` 人工文件源配置。
- `findwork/**/*.md` 这类 Markdown 文件导入。
- frontmatter-only 安全回写。
- 基础冲突处理。

验收：

- 用户能把私有库作为远端数据源。
- GitHub 文件可被外部工具直接读取。
- 用户能把 `findwork` 下的 Markdown 文件同步进系统。
- 系统回写不会静默覆盖人工 Markdown 正文。
- 刷新或换设备后能从 GitHub 恢复完整数据。
- token 不暴露在前端代码中。

### M3 看板与组织

产出：

- 状态看板。
- 拖拽修改状态。
- 自定义版块。
- 标签和搜索。

验收：

- 用户能用看板管理想要、正在、搁置、放弃、完成。
- 用户能创建工作、生活以外的版块。
- 用户能搜索历史事项。

### M4 本地日历

产出：

- 周视图日历。
- 有时间的 Todo / Event 展示。
- 从日历创建 Event。
- 点击日历项打开详情。

验收：

- 用户能看到今天和本周安排。
- 用户能把 Todo 安排到具体时间。
- 用户能从日历创建事件。

### M5 Google Calendar 双向同步

产出：

- Google OAuth。
- 读取选定日历。
- 本地 Event 推送到 Google Calendar。
- Google Calendar 事件同步回本地。
- 基础冲突处理。

验收：

- 用户授权后能看到 Google Calendar 事件。
- 本地修改能更新 Google Calendar。
- Google Calendar 修改能回写本地 Event。
- 删除和取消事件不会静默丢数据。

### M6 数据导入导出

产出：

- JSON snapshot 导出。
- JSON snapshot 导入。
- 覆盖 / 合并策略。

验收：

- 导出的文件可重新导入。
- 导入前能看到数据数量。
- 合并时不会重复创建相同 id 的事项。

## 2. 首批开发任务

建议第一批任务：

1. 初始化 Web 项目。
2. 建立 Item / Section / Settings 类型。
3. 建立 IndexedDB 封装。
4. 实现默认种子数据：收集箱、工作、生活。
5. 实现快速新增。
6. 实现列表视图。
7. 实现详情抽屉。
8. 实现状态修改。
9. 实现版块过滤。
10. 实现 GitHub manifest 和月分片读写。
11. 实现 sources.json 和 Markdown frontmatter 导入。
12. 实现 GitHub 人工文件 frontmatter-only 回写。
13. 实现 Google Calendar CalendarLink 数据结构。

## 3. 主要风险

### 范围膨胀

风险：

- 同时做 Todo、想法、日历、同步，很容易拖慢第一版。

控制：

- 本地闭环、GitHub 远端数据源和 Google 双向同步都进入核心路线，但分里程碑交付。

### 同步复杂度

风险：

- 双向同步涉及冲突、删除、重复事件、时区、token 失效。

控制：

- Google Calendar 第一版限制为单日历、基础事件字段和明确冲突提示。
- GitHub 第一版使用稳定 JSON/Markdown 文件和 item 级合并，避免高频实时写入。
- 人工 Markdown 正文默认由用户掌控，系统只回写 frontmatter。

### 数据模型过度抽象

风险：

- 为未来能力预留太多字段，导致第一版体验笨重。

控制：

- UI 只暴露必要字段。
- 数据层保留扩展字段，但不强迫用户填写。

## 4. 建议立即决策

为了进入开发，需要先确认：

- `Next.js` 还是 `Vite + React`。
- 首页默认形态已确认为收集箱 + 今日 + 正在。
- 是否将自定义版块放进 v0.1。
- Google Calendar 双向同步第一版是否只支持单日历。
- 是否现在就初始化代码项目。
