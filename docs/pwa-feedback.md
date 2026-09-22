# iPhone 推送与回顾：首版部署说明

本文保留独立回顾服务的部署方式。完整事项、日历和后台执行流程见 [完整联动运行说明](execution-operations.md)。文中域名、路径及事项均为示例，实际账号、设备和部署验收记录应私密保存。

## 已有能力与边界

- `/review`：查看回顾，选择完成、部分完成、未做或跳过，补充文字；登录后提交的反馈保存到服务端。
- 主屏幕 manifest、图标、Service Worker、此设备通知开关、30 秒后的测试提醒。点击通知打开对应回顾；测试提醒只发给发起测试的设备。
- 独立提醒进程每 10 秒检查已保存的回顾，不调用模型；网页关闭、Mac 离线时，服务器仍可发送和保存回复。
- Bearer API 创建、改期、取消回顾和读取反馈；本机目标树 CLI 可以逐条导入本人反馈为节点备注。不会据此自动完成整个节点。
- Google 事件时间已过不再自动设为完成；同步保留已有事项的本人状态。以前产生的完成状态未批量重置，需本人核对。

**仍待实现：** 目标树完整事项派发、Google 事件与回顾的自动关联/改期、每日待办生成、晨晚询问规则、反馈的本机持续消费。当前改期 API 只修改回顾时间，不改 Google 日程。独立回顾服务不会创建 Google 日程。

现有 Item 仍使用 IndexedDB + GitHub snapshot。新回顾、订阅、发送记录与原始反馈统一保存为服务端 JSON；它们不进入浏览器 snapshot，也不随现有 GitHub 导出一起备份。只支持单服务器的持久化磁盘/本机卷；Vercel 等临时文件系统不支持此存储版本。

## 1. 配置与持久化

保留已有部署、登录与 Google/GitHub 配置，新增以下环境变量。不要把凭据发到对话或提交到 Git。

```dotenv
TODOTODOLIST_PUBLIC_URL=https://todo.example.com
TODOTODOLIST_CHECKIN_PATH=/data/check-ins.json
# 已有独立 API token，可复用；和网页登录密码分开
TODOTODOLIST_API_TOKEN=<在服务器的私密环境配置中设置>
```

`TODOTODOLIST_PASSWORD` 与 `TODOTODOLIST_AUTH_SECRET` 继续用于本人网页登录。生产环境未配置登录密码时，回顾接口拒绝访问。反向代理须保留 HTTPS 站点的正常 Cookie/Origin；`TODOTODOLIST_PUBLIC_URL` 必须和浏览器地址一致。

在项目目录生成一次 VAPID 密钥，脚本只写权限为 `0600` 的新文件，不打印密钥、不覆盖旧文件：

```sh
npm run push:keys -- --subject https://todo.example.com --output .env.web-push
```

`.env.web-push` 包含 `WEB_PUSH_SUBJECT`、`WEB_PUSH_PUBLIC_KEY`、`WEB_PUSH_PRIVATE_KEY`。把它保存在服务器的私密配置中并备份；后续部署复用原密钥。改变密钥需要设备重新订阅。`data/`、`.tmp/` 与私密 `.env*` 已排除 Git 和 Docker 构建上下文。

## 2. 启动服务与提醒进程

### Docker Compose 示例

将新增字段合入现有部署配置，保留原端口、域名和挂载目录。仓库 `docker-compose.example.yml` 提供 app + 可选 `reminders` 服务；`./data:/data` 必须是持久卷。确认 `.env` 包含原部署参数及上述公开地址/API token：

```sh
docker compose --env-file .env --env-file .env.web-push \
  -f docker-compose.example.yml --profile reminders up -d --build
```

提醒容器通过配置的 HTTPS 公网地址调用本站 API，不直接访问用户文件，也不持有 Google 或 VAPID 私钥。此命令是部署示例，不表示已在真实服务器执行。

### 直接运行 Node

Node 22；设置 `TODOTODOLIST_CHECKIN_PATH` 为该服务器可写的持久绝对路径。进程由现有 systemd/PM2 等托管并随服务器启动：

```sh
npm ci
npm run build
node --env-file=.env --env-file=.env.web-push node_modules/next/dist/bin/next start
# 另一个受托管进程；默认访问同机 127.0.0.1:3000
node --env-file=.env scripts/reminder-worker.mjs
```

若应用端口不同，设置 `TODOTODOLIST_REMINDER_API_URL`。只接受 HTTPS 或 loopback HTTP。可加 `--once` 运行一次检查；**会发送当前到期回顾**，不是 dry-run。没有 VAPID 配置时返回明确失败，回顾页面仍可填写。

## 3. iPhone 验收

需 iOS/iPadOS 16.4 或更高版本，见 [Apple WebKit 说明](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)。

1. Safari 打开 HTTPS 站点，在分享菜单选择“添加到主屏幕”。从新图标打开并登录。
2. 进入“提醒与回顾”，点“开启此设备通知”，由本人允许系统通知权限。
3. 点“30 秒后测试提醒”，关闭网页并锁屏；服务器提醒进程应持续运行。
4. 手机实际收到后，点通知，应直达同一测试回顾。选择“部分完成”，补充“手机测试”，保存后刷新验证。
5. 本机 `todo-feedback` 应读到同一原始回答；无目标关联的手机测试仅用于读取，不能导入真实树。
6. 关闭此设备通知，再验证该设备停止收到；重新开启后创建新测试。Mac 关闭时重复步骤 3–4。

“推送服务已接受”仅表示服务端收到推送服务的成功回执；手机可能因离线、专注模式、系统设置而延迟。页面不会把它写成“已送达/已阅读”。Service Worker 不缓存带身份的页面或 API 响应，也不提供离线提交保证。

## 4. 本机目标树的调用方式

在本机私密环境设置 `TODOTODOLIST_URL=https://todo.example.com` 与相同的 `TODOTODOLIST_API_TOKEN`，不需要 Google 凭据。工具项目中执行：

```sh
python3 -m goal_tree todo-feedback --after 0 --limit 100
python3 -m goal_tree todo-check-in --file /path/to/reviewed-check-in.json
python3 -m goal_tree todo-import-feedback FEEDBACK_ID
```

`todo-check-in` 发布一条已经商定的回顾，须先审阅 JSON；不是创建 Todo Item 或日历事件的命令。负载只有标题、问题、提醒时间与稳定 ID，不需要本机路径。例子是虚构的，时间应由本人选定：

```json
{
  "id": "example-one-occurrence",
  "title": "演示行动的回顾",
  "prompt": "这一次完成得怎么样？",
  "dueAt": "2030-01-01T20:00:00+08:00",
  "goalTreeLink": { "treeId": "example_tree", "nodeId": "example_node" },
  "occurrenceId": "example-occurrence"
}
```

同一 ID 和内容重试不会重复新建；相同 ID 改内容返回 409，改期/取消使用 PATCH 与当前版本。只导入来源 `owner_web` 且树/节点精确匹配的反馈；经过目标树统一 note 操作、版本检查与去重。导入后重新读取 context 分析，状态修改仍遵循已有授权。

`todo-feedback` 返回 `nextCursor` 与 `hasMore`。首版不自动推进本机游标；先处理并保存反馈，再由调用方保存读取位置，避免丢失尚未落盘的记录。

## 5. API 与运行语义

| 接口 | 鉴权 / 行为 |
| --- | --- |
| `GET/POST /api/v1/check-ins` | Bearer；读取或创建回顾；GET 可用 `id` 精确定位，列表最近 200 条 |
| `PATCH /api/v1/check-ins/{id}` | Bearer；`version` + `dueAt` 或 `status: cancelled`；旧版本 412 |
| `GET /api/v1/feedback?after=0&limit=100` | Bearer；不可变原始反馈流；可加 `id` |
| `POST /api/v1/notifications/dispatch` | Bearer；检查并发送到期回顾，供提醒进程使用 |
| `POST /api/check-ins/{id}/feedback` | 本人登录 Cookie + 同站 Origin；外部 AI token 不可冒充本人提交 |
| `/api/notifications` 与订阅/测试子接口 | 本人登录；公开配置不返回私钥或订阅凭据 |

领取发送任务在文件锁内提交，网络发送在锁外；每个回顾版本/设备最多有一条发送记录。改期、取消或回答后，发送前再次核对当前版本；已经发出的网络请求无法撤回。推送超时/进程中断后标为“结果待核实”，不盲目重发；明确 429/5xx 最多尝试三次、间隔五分钟；404/410 移除失效订阅。每轮最多处理 20 次发送。

`skipped` 表示跳过问询，实际是否执行仍未知。回答只改变该条回顾状态；不修改 Item、Google 事件或目标节点状态。原始反馈暂不提供编辑/删除 UI。

## 6. 备份、排错与回退

- 备份整个 `check-ins.json`、现有 Google 文件和私密环境配置；这些含个人回答/订阅凭据，勿放公开库。文件原子替换适用于同一文件系统；协作锁不保护手工无锁编辑。不要在容器临时层保存。
- 页面提示服务端未配置：检查 VAPID 三项环境变量；最近检查时间为空：启动提醒进程并查看其 HTTP 错误。
- 401：重新登录或检查 API token；403：检查 HTTPS Origin/公开地址；500：查看卷权限/JSON 损坏，勿删除文件来掩盖故障。
- 暂停通知：先停止 reminders 进程；页面和反馈保留。回退应用前备份文件，保留相同 VAPID 密钥；已进入推送服务的请求无法撤回。
- 每次部署分别验证浏览器回复、刷新持久化、导入去重、移动布局与鉴权；iPhone 锁屏通知和实际 Google 关联需独立验收。实例的验收结果与数据数量不写入公共仓库。
