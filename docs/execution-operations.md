# 完整联动运行说明

## 数据与进程

- `TODOTODOLIST_STATE_PATH=/data/execution.json` 启用服务器作为事项的唯一主数据源；旧 `TODOTODOLIST_CHECKIN_PATH` 可继续兼容单独回顾数据。统一文件包括 `workspace.snapshot`、执行记录、日历请求、变更序列、冲突、设备和本人反馈历史。
- 网页和 bearer API 使用同一文件操作层；跨进程 `proper-lockfile`、临时文件 fsync/rename、版本检查和稳定请求 ID 防止并发覆盖和重复。
- 常驻进程 `node --import tsx scripts/execution-worker.ts` 每 30 秒运行；Google 增量同步默认每 5 分钟补查，Webhook 加快检测，订阅自动续期。浏览器关闭也继续工作。
- `GOOGLE_REFRESH_TOKEN_PATH`、`GOOGLE_CALENDAR_SYNC_STATE_PATH` 和 execution 文件必须保存在同一个私密持久卷。Google 410 会重建镜像，不删除事项或反馈。
- 由系统创建的日程使用稳定事件 ID 和 private 执行关联；重试先读取该 ID。修改和删除带 ETag，412 保留本人修改并提示冲突。
- 服务器排期有且只有已选行动；缺时长、授权错误、没有空闲时间分别显示等待状态。默认 Asia/Shanghai 12:00–22:00，缓冲 10 分钟，09:00/22:30 通知，可在今日页设置。

## API

所有 `/api/v1/*` 需要独立 `TODOTODOLIST_API_TOKEN`。网页 `/api/workspace` 及反馈写入需要已有登录 Cookie 和同源 JSON 请求。不要把 API token 放进手机网页。

| 接口 | 用途 |
| --- | --- |
| `GET/POST /api/v1/actions` | 读取执行工作区 / 幂等发布已选行动 |
| `GET /api/v1/schedule` | 日程、关联、日历同步与后台状态 |
| `GET/POST /api/v1/calendar` | 有界日期读取、有限期计划预览/提交、明确 ID 关联、单次改期/取消 |
| `GET /api/v1/changes?after=N&limit=100` | 增量变更序列 |
| `GET/POST /api/v1/daily` | 读取已有建议 / 保存已验证本机 Codex 摘要 |
| `POST /api/v1/planner-status` | 本机最近连接与失败状态 |
| `POST /api/v1/execution/tick` | 手动执行一轮后台，多个进程共用租约 |
| `GET /api/v1/feedback?after=N` | 本人反馈及追加更正，独立游标 |
| `/api/v1/items` 与 `/api/v1/sections` | 既有 API，同步读写服务器快照 |

发布字段：`operationId,id,title,description,goalTreeLink:{treeId,nodeId},durationMinutes?,autoSchedule,recurrence?,status,expectedUpdatedAt?`。已存在事项必须给当前 `expectedUpdatedAt`；操作 ID 相同内容不同返回 409。步骤状态分别报告事项保存、待排期、Google 已确认、回顾已建立。

## iPhone

1. Safari 打开 HTTPS 站点，登录，分享 → 添加到主屏幕。
2. 从桌面打开，进入“通知设置与测试”，点击“开启此设备通知”并允许系统通知。
3. 点击“30 秒后测试提醒”，关闭网页并锁屏；收到后点入回顾、填写，再回“今日”检查服务器已确认。
4. 断网时输入和提交保存在此设备；显示待同步。重新连接/登录后重试。更正保留旧反馈。手机浏览器缓存被系统清理前，未提交内容仅存在该设备，需尽快联网确认。

PWA 默认 `/today`；完整工作台仍为 `/`。Service Worker 仅缓存客户端页面和静态资源，私密 API 数据在 IndexedDB；不缓存 API token。离线首次安装没有页面缓存时需先联网打开一次。

## 迁移

先备份当前镜像、Compose、环境文件和完整 `/data`。在独立容器与数据卷运行迁移后再切换。

```sh
node --import tsx scripts/migrate-execution.ts --github
# 或从已导出的快照迁移
node --import tsx scripts/migrate-execution.ts /private/snapshot.json
```

原始快照按 SHA-256 保存到数据目录的 `migration-archive`，报告核对 ID、内容、删除标记和附件。已有同 ID 不同内容进入冲突列表；今日页对比后选择，不按时间静默覆盖。每台设备首次访问时把尚未同步的 IndexedDB 内容提交为迁移请求。未打开过的新版本设备尚未迁移，不能提前宣布所有设备完成。

旧 check-ins 文件迁移前复制到新的 `TODOTODOLIST_STATE_PATH`（停写并先备份），现有 version 1 会在统一操作层扩展 `workspace`，保留反馈、设备及送达状态；不要初始化一个空文件覆盖历史。

## 备份、恢复与回退

```sh
node --import tsx scripts/backup-execution.ts /data/backups
```

常驻 worker 也会每日将 execution、Google token 和同步状态备份到 `/data/backups/北京时间日期/`，保存 SHA-256 清单；失败保留在后台状态。上述手动命令在锁内复制数据并输出校验和。Google token、sync state、私密环境文件和原始迁移快照也需备份；不进 Git 或公共文件服务。

恢复时先停止 app 和 worker；校验备份 SHA-256，复制到新的数据目录，用隔离容器读取并核对 ID、反馈及关联，再切换挂载目录。保留故障后的数据供合并，不覆盖用户恢复期间新增的反馈。重试队列和游标与同一备份一起恢复，不能只还原其中一部分。

回退前保存当前镜像标识、Compose、环境文件、运行数据和当前 release 位置；这些记录只放私密运维目录。停止 app/worker 后核对旧版本是否理解现有数据结构，再恢复兼容的镜像与配置，检查 `/api/health`、登录和后台。保留最新数据与授权，不能用旧 JSON 覆盖之后新增的反馈。已有新有限期计划时，不应直接启动不理解它的旧 worker。

仓库中的历史回退脚本适用于其指定的旧目录布局。其他部署应先检查实际参数和备份结构，不照搬默认目录执行。真实服务器地址、账号、域名、备份路径与校验清单不属于公共操作示例。

## 故障定位

- `Google HTTP 400/401/403`：先区分过期/撤销授权与配置错误；必要时由本人重新 OAuth 授权。队列和反馈保留，不能把失败算作已排期。
- `Google HTTP 412`：日程被修改，先读当前事件；不强行覆盖本人安排。
- “待同步”：查看网络、登录及队列错误；相同 ID 重试。撤回未提交请求是明确的本人操作。
- Mac 离线：晨报仍显示已保存日程；AI 建议显示生成时间。恢复登录后台后补拉，不虚构新的分析。
- 模型失败：反馈已记录，分析队列保留；不影响服务器提醒。实际用量存于本机运行状态，未知不填 0。
- 通知 `accepted`：推送服务接受，不是手机送达证据；真机需分别验证锁屏接收和点击回复。

## OAuth 与公开域名

`TODOTODOLIST_PUBLIC_URL` 应与用户打开的站点一致；Google 控制台的注册回调与 `GOOGLE_REDIRECT_URI` 一致。迁移域名时，旧入口只能转到固定配置的公开地址，再核验登录和 state Cookie，不允许任意目标跳转或跳过 state 校验。缺失、过期或不匹配的 state 应重新从当前站点发起授权。

## 手机导航与历史日程

移动端导航放在会影响 fixed 定位的模糊侧栏之外，固定五个入口，其余视图通过“更多”访问。同步冲突提示在内容区域显示；今日页优先展示执行回顾，再展示迁移冲突。长链接允许换行。

已结束且状态仍为 active 的 Google 导入事件单列“历史待确认”，不混入“正在”；本人完成、搁置、放弃状态保留。日程结束不是完成证据。布局需分别验证窄屏、滚动、菜单操作和 iPhone 实机。

## 公共日历接口

目标树各本机会话经同一私密 API 凭据使用 `/api/v1/calendar`，不依赖会话 Google 连接器。GET 必须提供 from/until（含截止日），可按 treeId/nodeId 筛选；Google 不可用时返回 503，不拿旧缓存当新空档。POST 的 kind 为 plan/link/move/cancel，精确参数见 OpenAPI 1.2.0 和 `src/execution/calendar-api.ts`。

- 默认 preview=true；提交带同一请求的 previewToken 和 operationId。版本/预览变化返回 412，操作号用于不同内容返回 409；相同操作重试返回已有结果。任何日期无法安排时整批不创建。
- 有限期计划在 calendarPlans 中聚合，每次执行有独立 Google 事件（非原生 RRULE），保留10分钟提醒默认值；截止后不会继续生成。单次执行反馈不完成整个计划。
- 明确 eventId/seriesId 的 link 只保存关联，不重建或改期 Google 事件。calendarBindings 让未来同系列实例继承节点，既有本人反馈原文不改，接口可补充明确关联来源。没有结构化绑定的描述文字不是关联证据。
- move/cancel 需要当前 occurrence 版本和节点关联；Google 写入使用 etag，避免覆盖本人改期。Google 接受写入但回应丢失时，通过稳定事件 ID / 写入标识核对后重试；不把其他手动改动当自己的成功。
- applied 只表示持久化成功，calendarConfirmed 与 jobs 表示 Google 结果；失败不能当成功。本机队列由既有登录服务重试，版本冲突保留待处理。新有限期计划不自动随节点暂停而批量撤销，暂停整组需明确选择执行范围并逐项取消。

服务器仅接收选定标题、稳定 ID 和安排参数，本机档案与完整材料不外发。仅限同一已配置账号的主日历。客户端命令、Skill 入口与授权边界由使用者的本机规划项目管理。

## 验证与公开记录范围

发布前运行测试、TypeScript 检查与生产构建；隔离验证鉴权、日期、Google 不可用、重复请求、改期竞争和恢复。真实部署时核对事项 ID、状态、附件和反馈不丢失，并单独验收手机通知及早晚周期。测试通过或推送服务接受请求不能代替实际使用验收。

公开文档记录功能、约束和复现方法。实例的服务器地址、用户目录、设备/反馈数量、个人安排、真实 ID、备份清单和发布日志保留在私密运维记录中。不要把线上状态快照粘贴回本文件。

Google 日历与 Todo 字段归属的后续改造见 [信源分工计划](source-of-truth-plan.md)；公共接口可用不代表待发意图拆分和旧迁移冲突治理已完成。
