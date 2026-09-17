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
