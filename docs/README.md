# TodoTodoList 文档索引

这是 TodoTodoList 的产品与技术设计文档入口。

## 文档

- [iPhone PWA 推送与回顾](./pwa-feedback.md)：首版部署、持久化卷、提醒进程、回顾 API、本机反馈与真机验收。

- [产品方案](./product-plan.md)：产品定位、用户、功能范围、Google Calendar 与 GitHub 私有库调研结论。
- [PRD](./prd.md)：MVP 用户故事、验收标准、功能优先级和非目标。
- [页面与交互结构](./ux-structure.md)：首页、快速新增、列表、看板、日历、设置等页面设计。
- [低保真线框](./wireframes.md)：核心页面的信息布局草图。
- [技术设计草案](./technical-design.md)：数据模型、IndexedDB、GitHub 远端数据源、Google Calendar 双向同步和安全注意事项。
- [技术栈与部署方案](./tech-stack-and-deployment.md)：框架、技术选型、API、环境变量和部署方式。
- [映射与格式校验方案](./mapping-and-validation.md)：GitHub 文件、frontmatter、正文、checkbox 与 Item 的映射和错误防护。
- [Git 同步设计](./git-sync-design.md)：GitHub API 模式、本地 Git 模拟库、是否缓存完整仓库以及 Git 的缺点。
- [同步策略](./sync-strategy.md)：GitHub 私有库远端数据源和 Google Calendar 双向同步方案。
- [GitHub 人工可读写文件同步](./github-human-files.md)：`findwork/**/*.md` 这类 Markdown 文件源的导入和回写规则。
- [对外 REST / OpenAPI 接口](./external-api.md)：供其他平台和 AI 工具使用的 Item CRUD、鉴权、并发控制及 API 与直接写 GitHub 文件的取舍。
- [架构决策记录](./adr.md)：关键产品和技术决策的取舍说明。
- [MVP 范围冻结草案](./mvp-scope.md)：第一版交付范围、非目标和成功标准。
- [实施路线](./implementation-roadmap.md)：里程碑、首批任务、风险和开发前决策。
- [开发任务拆分](./backlog.md)：按 Epic 和任务粒度拆分的开发 backlog。
- [决策清单](./decisions.md)：需要用户确认的产品与技术选择。

## 当前推荐路线

- 单用户个人工作台优先。
- 首页采用「收集箱 + 今日 + 正在」。
- Item 分为 Todo / Idea / Event。
- 状态包含想要、正在、搁置、放弃、完成。
- GitHub 私有库作为用户可自由读取的远端数据仓库。
- 支持 `findwork/**/*.md` 这类人工 Markdown 文件源同步进系统。
- IndexedDB 作为本地缓存、离线层和同步队列。
- Google Calendar 第一阶段直接做双向同步。
- 技术栈推荐 Next.js + React。
- GitHub 文件结构推荐 manifest + 月分片。
- Google Calendar v0.1 推荐限制为单日历双向同步。

## 当前可运行验证

```bash
npm run check
npm test
npm run demo:human-files
npm run demo:human-writeback
```

## 下一步

核心方向已确认，剩余 Proposed 项按 [架构决策记录](./adr.md) 的默认方案推进；如果用户反对，再回到 [决策清单](./decisions.md) 调整。下一步可以进入：

1. 第一版可运行 Web 原型。
2. 更详细的页面线框。
3. API 与数据 schema 定稿。
4. 开发任务拆分。
