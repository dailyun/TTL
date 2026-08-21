# TodoTodoList 决策清单 v0.1

这份清单用于和用户确认项目方向。状态说明：

- 建议：当前产品方案推荐的默认选择。
- 待确认：需要用户明确拍板。
- Proposed：已写入 ADR，作为 v0.1 默认方案，除非用户反对。
- 可后置：不影响第一版启动，可以后续再定。

## P0 开发前必须确认

| 决策 | 建议 | 状态 | 影响 |
| --- | --- | --- | --- |
| 目标用户 | 单用户个人工具优先 | Proposed | 决定是否需要账号、权限、多用户数据模型 |
| 首页形态 | 收集箱 + 今日 + 正在 | 已确认 | 决定第一屏信息架构和开发优先级 |
| 主存储 | GitHub 私有库作为用户可读取的远端数据仓库，IndexedDB 作为本地缓存 | 已确认 | 不依赖传统数据库部署，提升数据自由度 |
| GitHub 私有库定位 | 用户拥有的远端数据源，不只是备份 | 已确认 | 需要设计文件结构、冲突、版本和 token 安全 |
| GitHub 人工文件源 | 支持 `findwork/**/*.md` 这类 Markdown 文件同步 | 已确认 | 需要 frontmatter、来源路径、正文保护和回写策略 |
| Google Calendar v1 范围 | 直接做双向同步 | 已确认 | 需要处理 OAuth、写入、删除、冲突、时区和重复事件 |
| 技术栈 | Next.js + React | Proposed | 决定项目脚手架和部署方式 |

## P1 MVP 范围确认

| 决策 | 建议 | 状态 | 影响 |
| --- | --- | --- | --- |
| Item 类型 | Todo / Idea / Event | Proposed | 决定数据模型和新增表单 |
| 状态集合 | 想要 / 正在 / 搁置 / 放弃 / 完成 | Proposed | 决定看板列和事项生命周期 |
| 默认版块 | 收集箱 / 工作 / 生活 | 建议 | 决定初始种子数据 |
| 自定义版块 | 进入 MVP | Proposed | 影响版块管理页面是否第一版实现 |
| 日历视图 | MVP 做周视图 | Proposed | 影响日历组件和时间编辑工作量 |
| 拖拽看板 | 进入 MVP 或 v0.2 | Proposed | 影响交互复杂度 |
| JSON 导入导出 | 进入 MVP | 建议 | 保证数据可控和可恢复 |

## P2 可后置

| 决策 | 建议 | 状态 | 影响 |
| --- | --- | --- | --- |
| 提醒通知 | v0.3 后再做 | 可后置 | 涉及浏览器通知和重复提醒 |
| 重复任务 | v1.0 后再做 | 可后置 | 涉及复杂规则和日历同步 |
| Markdown 描述 | 进入 GitHub 人工文件源能力 | 已进入核心设计 | 影响 frontmatter、正文解析和回写策略 |
| 多设备自动同步 | 随 GitHub 远端数据源一起设计 | 已进入核心设计 | 涉及冲突合并和后台任务 |
| Google Calendar 双向同步 | 第一阶段同步能力 | 已确认 | 涉及删除、冲突、时区和重复事件 |
| 多人协作 | v2.0 或独立产品方向 | 可后置 | 会改变账号、权限和数据库架构 |

## 推荐默认答案

如果目标是快速做出个人可用版本，建议采用以下答案：

```txt
目标用户：单用户个人工具
首页：首页 = 收集箱 + 今日 + 正在
主存储：GitHub 私有库作为远端数据仓库，IndexedDB 作为本地缓存和离线层
GitHub：私有库中的 JSON/Markdown 数据可被其他工具自由读取
Google Calendar：第一版直接做双向同步
技术栈：Next.js + React
MVP：快速新增、列表、看板、版块、周视图日历、JSON 导入导出
```

## 用户确认后要更新的文档

用户对 Proposed 项提出修改后，需要同步更新：

- `docs/product-plan.md`
- `docs/prd.md`
- `docs/ux-structure.md`
- `docs/technical-design.md`
- `docs/implementation-roadmap.md`
- `docs/adr.md`
- `docs/mvp-scope.md`

## 决策依据

- 关键取舍见 `docs/adr.md`。
- v0.1 范围见 `docs/mvp-scope.md`。

## 新增技术约束

- 不能把 GitHub Personal Access Token 直接暴露在前端。
- GitHub 文件结构必须稳定、可读、可被其他脚本或工具消费。
- GitHub 人工 Markdown 文件默认只回写 frontmatter，不能静默覆盖正文。
- 本地 IndexedDB 不能成为唯一数据源，必须能从 GitHub 恢复完整数据。
- Google Calendar 双向同步必须有冲突策略和删除策略，不能只做乐观写入。
