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

本机线上保留旧镜像 `todotodolist:pre-execution-20260917` 和 `/opt/todotodolist/backups/pre-execution-*`。回退：停止新 worker → 保存当前数据 → 恢复原 Compose/环境文件 → 使用旧镜像启动原 app（仍为 127.0.0.1:3030）→ 检查 `/api/health` 与登录。旧版不理解新执行文件；保留新文件及反馈，不丢弃。原 Caddy、域名、Google 授权和其他服务不需要修改。

## 故障定位

- `Google HTTP 400/401/403`：先区分过期/撤销授权与配置错误；必要时由本人重新 OAuth 授权。队列和反馈保留，不能把失败算作已排期。
- `Google HTTP 412`：日程被修改，先读当前事件；不强行覆盖本人安排。
- “待同步”：查看网络、登录及队列错误；相同 ID 重试。撤回未提交请求是明确的本人操作。
- Mac 离线：晨报仍显示已保存日程；AI 建议显示生成时间。恢复登录后台后补拉，不虚构新的分析。
- 模型失败：反馈已记录，分析队列保留；不影响服务器提醒。实际用量存于本机运行状态，未知不填 0。
- 通知 `accepted`：推送服务接受，不是手机送达证据；真机需分别验证锁屏接收和点击回复。


### 可执行回退（当前服务器）

先检查所需旧镜像、备份与目录；检查不会停服务：

```sh
sudo python3 /opt/todotodolist/app/scripts/rollback-execution.py \
  --backup /opt/todotodolist/backups/pre-execution-20260917T153020Z
```

需要回退时，在同一命令末尾加 `--apply`。脚本先停止新 app/worker，私密备份当前数据和 Compose，再恢复旧 app、原 Compose 与旧环境，使用保留镜像启动。它保留现有 `/data` 和最新 Google 授权，不用旧数据覆盖新反馈。检查 `curl --fail http://127.0.0.1:3030/api/health`，再检查登录。

重新进入新版：找到脚本输出的 `before-rollback-*` 目录，停止旧 Compose；恢复该目录的 `docker-compose.yml`、`execution.env`，将 `app` 符号链接改回 `release-path.txt` 指向的目录，执行 `docker compose up -d`。不要覆盖现存 data。回退期间旧版新改动仍须重新导入并审阅冲突；不会静默丢弃新版已有反馈。

每日私密备份位于 `/data/backups/YYYY-MM-DD/`，包含统一执行文件、Google 授权、同步状态及 SHA-256 清单；备份错误在状态接口可见。完整主机灾难恢复仍需异机保存 `/opt/todotodolist/backups` 和 `/opt/todotodolist/data/backups`，这些目录含私密凭据，不提交 Git。


## OAuth 域名迁移修复（2026-09-18）

实际故障：公开站点是 `wanting.furina.win`，旧 Google 配置的 `GOOGLE_REDIRECT_URI` 仍为 `wanting.furina.club`。浏览器的 state Cookie 不能跨这两个域名读取，因此旧回调报 `Google callback state mismatch`。

现有 Google 注册回调保持不变：旧域名的 OAuth start/callback 只会 303 转到 `TODOTODOLIST_PUBLIC_URL` 配置的固定公开域名，随后照常检查当前站点登录和 state Cookie。旧回调不读取或保存授权结果；code 交换仍使用 Google 已注册的原 redirect_uri。只转发 code/state/error，禁止用户输入目标 URL，并设置 no-store/no-referrer。

更换公开域名时，同步维护 `TODOTODOLIST_PUBLIC_URL`。如果 Google 控制台已添加新的 callback，可再统一 `GOOGLE_REDIRECT_URI`，届时无需域名中转。不能通过取消 state 检查来修复连接问题。缺失、过期或不匹配的 state 返回中文重试页，重新从当前站点授权入口开始。

本人随后已在 Google 客户端添加 `.win` 回调 URI。本次服务器将 `GOOGLE_REDIRECT_URI` 与 webhook 一并统一到 `.win`，正常流程不再经过旧域名。域名中转逻辑仅用于以后配置迁移；当前请从 `.win` 重新开始授权。

## 手机导航修复（2026-09-18）

iPhone 截图显示：本应固定在底部的导航落到了顶部，并且 8 个入口和同步提示挤进固定的五列高度。导航原本位于带 `backdrop-filter` 的侧栏中，该祖先会影响 fixed 定位；手机导航现已移到侧栏外，保留五个入口：首页、今日、日历、回顾、更多。全部事项、沉淀、看板、同步放在“更多”面板，桌面继续显示完整侧栏。同步/冲突提示移到内容区，长日历链接允许换行。

验证使用独立演示数据（16 条事项、13 项冲突）：320、375、420、860、861、1280 像素宽度无页面横向溢出；滚动后底部位置稳定，菜单切换与关闭正常，今日/回顾在窄屏下正常。TypeScript 检查与生产构建通过，隔离容器和线上均核对了导航结构、五个入口及实际 CSS。桌面浏览器的宽度检查不代替 iPhone 真机复核。

当前发布目录 `/opt/todotodolist/releases/mobile-nav-20260918`，镜像 `todotodolist:mobile-nav-20260918`；app healthy、worker running。上线后核对事项和反馈 ID 无缺失，Google 同步无错误。代码修复没有处理或覆盖用户的数据冲突。

本次回退材料：`/opt/todotodolist/backups/pre-mobile-nav-20260918` 的原 Compose/环境文件，`/data/backups/pre-mobile-nav-20260918` 的一致性数据备份，以及 `todotodolist:before-mobile-nav-20260918` 旧镜像。仅回退界面时恢复原 Compose，并把 `app` 指回 `releases/execution-20260917`，执行 `docker compose up -d --no-build`；不要用备份覆盖线上新反馈和授权。手机联网完全退出 Web App 后重新打开以加载新资源，不需清除网站数据。

## 历史 Google 日程分类（2026-09-18，已部署）

已结束、原状态仍为 active 的 Google 导入事件，在首页和看板单列“历史待确认”，不计入“正在”；全部事项支持对应筛选与标签。旧记录同样适用，页面每分钟及恢复焦点时重新判断；改期至未来后恢复当前分类。全天事件在含结束日在内的整个日期过去后才归为历史。已完成、搁置、放弃等本人状态以及本机目标树行动不被覆盖；不回写 Google、不迁移或批量改写历史完成状态。

本机验证：114 项测试、TypeScript 检查和生产构建通过。独立演示页面核对过去事件在首页“正在”为 0、历史待确认为 1，看板分类一致；手动完成演示事件后“完成”为 1、历史待确认为 0。已部署线上，未进行 iPhone 真机复核。

部署入口：`ssh ubuntu@51.79.157.90`，由现有服务器账号登录并使用 sudo；凭据不保存到源码或文档。当前 `/opt/todotodolist/app` 指向 `releases/calendar-history-20260918`，app 和 worker 使用 `todotodolist:calendar-history-20260918`。镜像内 114 项测试通过，公网健康检查与含“历史待确认”的新版 JS 资源均返回 200；只读核对 48 条事项、1 条反馈无缺失，原始事项状态无改写，8 条历史事件归入历史待确认。

本次配置回退材料：`/opt/todotodolist/backups/pre-calendar-history-20260918T052625Z`；一致性数据备份：`/data/backups/pre-calendar-history-20260918`。仅回退界面时恢复备份 Compose，把 app 链接改回 `releases/mobile-nav-20260918`，然后执行 `docker compose up -d --no-build`；不要覆盖现有数据。

## 迁移冲突来源与回顾顺序（2026-09-23）

只读核对线上 13 条 open 冲突，来自 9 月 18 日的两次 device_migration。9 条当前只存在 createdAt/updatedAt 差异；其余涉及两个预置示例事项的删除/时间差异，以及两份 default 设置的自动 GitHub 快照开关差异。前五项 ID 是预置示例事项；inbox/life/work 是默认版块，default 是设置对象。客户端首次同步提交本地缓存，服务端按完整对象比较；不同 operationId 分别保存冲突，所以初始化时间差也会触发冲突，同名实体可出现多条。不是 13 个真实行动都需要重新决定。

按本人要求，把今日页“回顾实际发生的事”移到“迁移 / 同步冲突”前面。本次不自动选择版本、不清除冲突、不改同步算法。

已发布 `todotodolist:review-order-20260923`，当前 app 链接为 `releases/review-order-20260923`。以线上 calendar-history-20260918 为基础仅交换两个区域，未包含本机其他在途修改。独立生产构建通过；公网健康和新版 JS 返回 200，新资源中回顾区域先于冲突区域。部署后 73 条事项无缺失，13 条冲突及本人反馈原样保留。配置回退目录 `/opt/todotodolist/backups/pre-review-order-20260922T183005Z`，数据备份 `/data/backups/pre-review-order-20260923`；回退使用 calendar-history-20260918 镜像，不覆盖最新数据。本机全项目类型检查被其他在途的 app/api/v1/openapi/route.ts 语法错误阻塞，未把此结果视为本次独立版本失败或改动相关 API。

## 公共日历接口（2026-09-23）

目标树各本机会话经同一私密 API 凭据使用 `/api/v1/calendar`，不依赖会话 Google 连接器。GET 必须提供 from/until（含截止日），可按 treeId/nodeId 筛选；Google 不可用时返回 503，不拿旧缓存当新空档。POST 的 kind 为 plan/link/move/cancel，精确参数见 OpenAPI 1.2.0 和 `src/execution/calendar-api.ts`。

- 默认 preview=true；提交带同一请求的 previewToken 和 operationId。版本/预览变化返回 412，操作号用于不同内容返回 409；相同操作重试返回已有结果。任何日期无法安排时整批不创建。
- 有限期计划在 calendarPlans 中聚合，每次执行有独立 Google 事件（非原生 RRULE），保留10分钟提醒默认值；截止后不会继续生成。单次执行反馈不完成整个计划。
- 明确 eventId/seriesId 的 link 只保存关联，不重建或改期 Google 事件。calendarBindings 让未来同系列实例继承节点，既有本人反馈原文不改，接口可补充明确关联来源。没有结构化绑定的描述文字不是关联证据。
- move/cancel 需要当前 occurrence 版本和节点关联；Google 写入使用 etag，避免覆盖本人改期。Google 接受写入但回应丢失时，通过稳定事件 ID / 写入标识核对后重试；不把其他手动改动当自己的成功。
- applied 只表示持久化成功，calendarConfirmed 与 jobs 表示 Google 结果；失败不能当成功。本机队列由既有登录服务重试，版本冲突保留待处理。新有限期计划不自动随节点暂停而批量撤销，暂停整组需明确选择执行范围并逐项取消。

服务器仅接收选定标题、稳定 ID 和安排参数，本机档案与完整材料不外发。仅限同一已配置账号的主日历。命令、Skill 入口与授权边界见目标树 `docs/calendar-operations.md`。
