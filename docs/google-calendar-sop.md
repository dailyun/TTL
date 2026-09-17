# TodoTodoList 接入 Google Calendar SOP

- 文档版本：1.0
- 更新日期：2026-07-10
- 适用范围：TodoTodoList 当前单用户、单 Google Calendar 集成
- 目标：完成 Google OAuth 授权，使应用可以导入、创建、修改和删除 Google Calendar 事件

## 1. 当前能力与边界

当前应用支持：

- 从一个 Google Calendar 手动导入近期事件。
- 将本地有开始时间的 `Todo` 或 `Event` 创建为 Google Calendar 事件。
- 写回标题、描述、开始时间、结束时间和全天日期。
- 在日历中拖动或拉伸 Google 来源事项后写回远端。
- 删除 Google 来源事项时，先删除远端事件，再对本地事项执行软删除。
- 使用 Google event `etag` 检测并阻止覆盖远端新版本。
- 使用 Google Events watch Webhook 接收变化通知，并通过 `nextSyncToken` 增量拉取。
- 服务端保留尚未被浏览器确认的变更，页面恢复后会继续投递。
- 推送通道临近过期时自动续订，并用低频增量轮询弥补漏推。

当前限制：

- 只配置一个日历，不提供应用内日历选择器。
- 手动导入默认覆盖过去 14 天到未来 90 天；实时同步首次覆盖范围默认是过去 30 天到未来 365 天。
- 实时结果写入浏览器 IndexedDB，因此页面关闭时服务端会积累待投递变更，重新打开页面后再应用到本地。
- 默认同步状态文件适合单实例部署；多实例需要把同步状态迁移到共享、具备并发控制的存储。
- 复杂重复规则不在当前编辑范围内。
- OAuth 回调会把 refresh token 写入 `GOOGLE_REFRESH_TOKEN_PATH`；部署者需要为该路径提供持久化存储。

应用申请的 Google scope 为：

```txt
https://www.googleapis.com/auth/calendar.events
```

该 scope 允许应用查看和修改用户有权访问的日历事件，但不用于管理整个日历列表或日历设置。

## 2. 角色和前置条件

执行人需要具备：

- Google Cloud 项目管理权限。
- 目标 Google 账号的 Calendar 使用权限。
- TodoTodoList 部署环境变量修改和重启权限。
- 生产域名及 HTTPS 配置权限。

生产接入前确认：

- TodoTodoList 已启用 `TODOTODOLIST_PASSWORD`。
- `TODOTODOLIST_AUTH_SECRET` 已设置为独立强随机值。
- `.env` 未纳入 Git。
- 生产回调地址使用 HTTPS。
- 已确定目标日历 ID 和本地默认版块 ID。

## 3. 准备回调地址

回调地址必须与 Google OAuth Client 中的 Authorized redirect URI **完全一致**，包括：

- 协议：`http` 或 `https`
- 域名或 IP
- 端口
- 路径
- 末尾斜杠

本地开发推荐：

```txt
http://127.0.0.1:3000/api/google-calendar/oauth/callback
```

生产示例：

```txt
https://todo.example.com/api/google-calendar/oauth/callback
```

不要混用以下地址：

```txt
http://localhost:3000/...
http://127.0.0.1:3000/...
```

Google 会将它们视为不同的 redirect URI。

## 4. 配置 Google Cloud

### 4.1 创建或选择项目

1. 登录 Google Cloud Console。
2. 创建一个专用于 TodoTodoList 的项目，或选择已有项目。
3. 记录项目名称和项目 ID，便于后续审计。

建议不要复用权限范围复杂的生产项目。

### 4.2 启用 Google Calendar API

1. 进入 API Library。
2. 搜索 `Google Calendar API`。
3. 进入 API 页面并点击 Enable。
4. 确认项目的 Enabled APIs 列表中已经出现 Google Calendar API。

### 4.3 配置 Google Auth Platform

在 Google Auth Platform 中完成以下配置。

#### Branding

至少填写：

- App name：例如 `TodoTodoList`
- User support email
- Developer contact email

#### Audience

按账号类型选择：

- 仅 Google Workspace 组织内部使用：可选择 Internal。
- 个人 Gmail 或组织外账号：选择 External。

如果 External 应用仍处于 Testing：

1. 把实际授权账号加入 Test users。
2. `calendar.events` 不属于仅身份信息 scope，因此 External + Testing 状态下授权和 refresh token 会在 7 天后过期，不适合作为长期生产配置。
3. 稳定生产使用前，应根据 Google 当前要求切换发布状态并完成需要的验证流程。

#### Data Access

添加应用所需 scope：

```txt
https://www.googleapis.com/auth/calendar.events
```

不要额外申请当前应用不使用的 Calendar 或 Google Account scope。

### 4.4 创建 OAuth Client

1. 进入 Clients。
2. 创建 OAuth client。
3. Application type 选择 `Web application`。
4. Name 填写可识别名称，例如：

```txt
TodoTodoList Production
```

5. 在 Authorized redirect URIs 中添加第 3 节确定的回调地址。
6. 保存后取得：

```txt
Client ID
Client secret
```

Client secret 只允许写入服务端环境变量，不得放入浏览器代码、截图、Issue 或 Git。

## 5. 第一阶段环境变量配置

首次授权前配置以下变量，`GOOGLE_REFRESH_TOKEN` 暂时留空：

```env
GOOGLE_CLIENT_ID=<Google OAuth Client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth Client secret>
GOOGLE_REDIRECT_URI=https://todo.example.com/api/google-calendar/oauth/callback
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_SECTION=work
GOOGLE_CALENDAR_WEBHOOK_URL=https://todo.example.com/api/google-calendar/webhook
GOOGLE_CALENDAR_SYNC_STATE_PATH=/data/google-calendar-sync-state.json
GOOGLE_CALENDAR_FALLBACK_POLL_SECONDS=300
GOOGLE_CALENDAR_INITIAL_DAYS_BACK=30
GOOGLE_CALENDAR_INITIAL_DAYS_FORWARD=365
GOOGLE_CALENDAR_WATCH_TTL_SECONDS=518400
```

变量说明：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | 是 | Web application OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | 是 | OAuth Client secret，只保存在服务端 |
| `GOOGLE_REDIRECT_URI` | 是 | 必须与 Google Cloud 中配置的 URI 完全一致 |
| `GOOGLE_REFRESH_TOKEN` | 否 | 手动部署的后备值；正常授权会写入 `GOOGLE_REFRESH_TOKEN_PATH` |
| `GOOGLE_CALENDAR_ID` | 是 | 默认使用 `primary`；也可填写目标次级日历 ID |
| `GOOGLE_CALENDAR_SECTION` | 是 | Google 事件导入后的本地版块 ID，如 `work` |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | 实时同步必填 | 公网可访问、证书有效的 HTTPS Webhook 完整地址 |
| `GOOGLE_CALENDAR_SYNC_STATE_PATH` | 实时同步必填 | 持久化 sync token、通道信息和待投递变更的文件路径 |
| `GOOGLE_CALENDAR_FALLBACK_POLL_SECONDS` | 否 | 漏推兜底轮询周期，默认 300 秒，最小 15 秒 |
| `GOOGLE_CALENDAR_INITIAL_DAYS_BACK` | 否 | 首次增量同步向过去覆盖的天数，默认 30 |
| `GOOGLE_CALENDAR_INITIAL_DAYS_FORWARD` | 否 | 首次增量同步向未来覆盖的天数，默认 365 |
| `GOOGLE_CALENDAR_WATCH_TTL_SECONDS` | 否 | 推送通道申请寿命，默认 6 天、最大 7 天 |

如果使用 Docker Compose，确认上述变量已经传入容器。仓库中的 `docker-compose.example.yml` 已包含这些变量。

配置后重启应用。

## 6. 执行 OAuth 授权

### 6.1 检查 OAuth 基础配置

登录 TodoTodoList 后访问：

```txt
/api/google-calendar/status
```

首次授权前预期：

```json
{
  "oauthConfigured": true,
  "importConfigured": false,
  "hasClientId": true,
  "hasClientSecret": true,
  "hasRedirectUri": true,
  "hasRefreshToken": false
}
```

如果 `oauthConfigured` 为 `false`，不要继续授权，先检查环境变量并重启应用。

### 6.2 发起授权

在已登录 TodoTodoList 的同一浏览器中打开：

```txt
/api/google-calendar/oauth/start
```

应用会：

1. 生成一次性 OAuth state。
2. 将 state 写入 HttpOnly、SameSite=Lax cookie。
3. 跳转到 Google 授权页面。
4. 请求离线访问并要求确认 consent。

### 6.3 选择账号并授权

1. 选择实际需要同步 Calendar 的 Google 账号。
2. 确认显示的应用名称和权限范围。
3. 同意 Calendar event 访问权限。
4. Google 将浏览器重定向到 `GOOGLE_REDIRECT_URI`。

如果应用未验证，个人或测试部署可能出现未验证应用提示。必须确认当前 OAuth Client 确实由本项目创建后再继续，不得在来源不明的授权页输入账号信息。

### 6.4 保存 refresh token

授权成功后，回调会把 refresh token 自动写入 `GOOGLE_REFRESH_TOKEN_PATH`。确认回调页提示保存成功，然后关闭页面；不需要复制 token 或重启应用。

如果自动保存失败，先检查目标目录是否存在且应用进程有写权限，再重新授权。`GOOGLE_REFRESH_TOKEN` 只作为无法提供持久化文件时的手动后备方案。

安全要求：

- 不要把回调页面截图发送到聊天工具。
- 不要把 token 写入 README、日志或 Git。
- 回调响应已设置 `Cache-Control: no-store`，成功页面不会回显 token。

### 6.5 确认授权完成

重启后再次访问：

```txt
/api/google-calendar/status
```

预期：

```json
{
  "oauthConfigured": true,
  "importConfigured": true,
  "hasRefreshToken": true
}
```

## 7. 日历 ID 配置

### 7.1 主日历

同步当前授权账号的主日历时使用：

```env
GOOGLE_CALENDAR_ID=primary
```

这是推荐的首次接入配置。

### 7.2 次级或共享日历

同步其他日历时：

1. 打开 Google Calendar Web。
2. 进入目标日历的 Settings and sharing。
3. 找到 Integrate calendar。
4. 复制 Calendar ID。
5. 将它写入：

```env
GOOGLE_CALENDAR_ID=<calendar id>
```

6. 重启应用。

授权账号必须对该日历拥有读取事件权限；创建、修改和删除还需要对应写权限。

## 8. 上线验收

### 8.1 状态检查

- [ ] `/api/google-calendar/status` 返回 `importConfigured=true`。
- [ ] 页面不暴露 Client secret 或 refresh token。
- [ ] 应用登录保护已开启。

### 8.2 Google 到本地

1. 在目标 Google Calendar 中创建一个测试事件：

```txt
标题：TDL-GCAL-PULL-TEST
时间：未来 24 小时内
描述：Google to TodoTodoList acceptance test
```

2. 在 TodoTodoList 进入同步视图。
3. 点击“从 Google Calendar 拉取近期日程”。
4. 确认事件出现在日历和配置的本地版块中。
5. 分别验证普通定时事件和全天事件，日期不得提前或延后一天。

### 8.2.1 实时增量同步

1. 确认 `GOOGLE_CALENDAR_WEBHOOK_URL` 可从公网通过 HTTPS 访问，且该地址直接指向 `/api/google-calendar/webhook`。
2. 在侧栏启用“Google 日历实时同步”。
3. 刷新同步页状态，确认“实时同步”显示“推送通道运行中”。
4. 在 Google Calendar 新建或修改一个未来事件，不点击手动导入。
5. 保持 TodoTodoList 页面打开，确认通常在数秒内出现变更。
6. 关闭页面，再修改另一个事件；重新打开页面后确认积累的变更被投递。
7. 删除 Google 端测试事件，确认本地收到软删除。

### 8.3 本地到 Google

1. 在 TodoTodoList 创建一个带开始时间的 `Event` 或 `Todo`。
2. 打开事项详情。
3. 点击“同步到 Google Calendar”。
4. 确认 Google Calendar 中出现同名事件。
5. 确认本地事项来源变成 Google Calendar，并记录 `calendarId`、`eventId` 和 `etag`。

### 8.4 修改写回

依次测试：

- 修改标题。
- 修改描述。
- 修改开始时间和结束时间。
- 将事件拖到另一天。
- 调整多日事件开始或结束日期。
- 修改全天事件日期。

每次操作后刷新 Google Calendar，确认远端内容一致。

### 8.5 冲突测试

1. 先完成一次 Google 事件导入。
2. 在 Google Calendar 中修改该事件。
3. 不重新导入，直接在 TodoTodoList 修改同一事件的标题或时间。
4. 预期 TodoTodoList 提示远端版本已更新，不覆盖 Google 新版本。
5. 重新导入日程。
6. 确认远端版本进入本地，并可基于新版本再次修改。

### 8.6 删除测试

1. 创建专用测试事件并同步到 Google。
2. 在 TodoTodoList 删除该事项。
3. 确认 Google 事件被删除。
4. 确认本地事项被软删除，不再出现在默认视图。

不要使用真实重要日程执行删除验收。

## 9. 常见故障排查

### `redirect_uri_mismatch`

检查：

- `GOOGLE_REDIRECT_URI` 是否与 Google Cloud 完全一致。
- `http`/`https` 是否一致。
- `localhost`/`127.0.0.1` 是否一致。
- 端口、路径和末尾斜杠是否一致。
- 修改环境变量后是否重启应用。

### 回调提示 state mismatch

可能原因：

- OAuth 流程超过 10 分钟。
- 授权开始和回调使用了不同域名。
- 浏览器阻止或清除了 OAuth state cookie。
- 多次同时发起授权，后一次覆盖了前一次 state。

处理方式：关闭旧授权页面，从 `/api/google-calendar/oauth/start` 重新开始一次完整流程。

### Google 没有返回 refresh token

处理顺序：

1. 确认授权请求使用的是正确账号。
2. 从 `/api/google-calendar/oauth/start` 重新授权；应用已经设置 `access_type=offline` 和 `prompt=consent`。
3. 必要时在 Google Account 的第三方访问管理中撤销该应用访问，再重新授权。
4. 检查 OAuth 应用是否长期停留在 Testing 状态。

### `invalid_grant`

常见原因：

- refresh token 被撤销或过期。
- OAuth Client 被删除或重建。
- Client ID、Client secret 和 refresh token 不属于同一个 OAuth Client。
- 用户撤销了应用权限或修改了相关账号安全设置。

处理方式：清空旧 token，重新执行第 6 节授权流程。

### `accessNotConfigured` 或 API 未启用

确认当前 OAuth Client 所属 Google Cloud 项目已经启用 Google Calendar API。

### `insufficientPermissions`

确认：

- Data Access 中包含 `calendar.events` scope。
- 用户已经重新授权新增后的 scope。
- 授权账号对目标 Calendar 具有足够权限。

### 可以授权但不能导入

检查：

- `/api/google-calendar/status` 是否为 `importConfigured=true`。
- `GOOGLE_CALENDAR_ID` 是否正确。
- 测试事件是否位于过去 14 天到未来 90 天的默认导入范围内。
- refresh token 是否仍有效。

### 可以导入但不能修改或删除

检查目标 Calendar 是否为只读共享日历。读取权限不等于写入或删除权限。

### 写回提示远端冲突

说明本地保存的 etag 已过期：

1. 重新执行 Google Calendar 导入。
2. 检查远端新内容。
3. 基于最新版本重新修改。

不得通过删除 etag 或关闭冲突检测强行覆盖。

## 10. 回滚和撤销授权

### 暂停同步

1. 删除或清空部署环境中的：

```env
GOOGLE_REFRESH_TOKEN=
```

2. 重启应用。
3. 确认 `/api/google-calendar/status` 返回 `importConfigured=false`。

本地已导入的数据不会因此自动删除。

### 完全撤销

1. 在 Google Account 中撤销 TodoTodoList 的第三方访问权限。
2. 删除部署环境中的 refresh token。
3. 重启应用。
4. 如不再使用，删除 Google Cloud OAuth Client 或禁用 Calendar API。

### Token 泄露处置

如果 refresh token、Client secret 或回调页面截图发生泄露：

1. 立即撤销 Google Account 中的应用访问。
2. 在 Google Cloud 中轮换 Client secret；严重时重建 OAuth Client。
3. 重新执行 OAuth 授权获取新 refresh token。
4. 更新部署环境并重启。
5. 检查 Google Cloud 和部署日志，确认是否有异常访问。

## 11. 变更管理

以下变更需要重新检查或重新授权：

- 修改生产域名或 OAuth callback 路径。
- 修改 Google OAuth Client。
- 增加新的 Google scope。
- 切换授权账号。
- 切换目标 Calendar ID。
- 从单用户扩展到多用户。
- 将 OAuth 应用从 Testing 切换到正式发布状态。

变更后至少重新执行第 8.1、8.2、8.3 和 8.5 节。

## 12. 官方参考

- [Google Calendar API 概览](https://developers.google.com/workspace/calendar/api/guides/overview)
- [Google OAuth 2.0 Web Server 应用流程](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Calendar API Events](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Google Calendar 增量同步](https://developers.google.com/workspace/calendar/api/guides/sync)


## 实际完成状态（2026-09-17 校准）

日历事件结束只表示计划时间已过。首次导入非取消事件保持 `active`；后续改期/增量导入保留原事项状态（包括本人设置的完成、搁置或放弃），更新日程字段。以前由结束时间自动产生的 `done` 不批量重置，避免覆盖本人结果。新的回顾页单独记录一次执行的反馈，暂不自动修改 Item/Google/长期目标状态。
