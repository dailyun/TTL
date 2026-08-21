# 对外 REST / OpenAPI 接口

TodoTodoList 提供一个面向其他平台、自动化流程和 AI 工具的 HTTP API。接口负责鉴权、字段校验、软删除和 GitHub 写入冲突重试；数据继续保存在项目已使用的 GitHub snapshot 中。

## 1. 为什么优先使用 API，而不是让平台直接改 GitHub 文件

推荐架构：

```txt
外部平台 / AI 工具
        │ Bearer token + JSON
        ▼
TodoTodoList /api/v1
        │ 校验、并发控制、软删除
        ▼
GitHub Contents API
        │
        ▼
todotodolist/snapshot.json
```

API 方案更适合完整 CRUD：

- 外部调用方不需要知道 snapshot 的内部完整结构。
- 更新单条事项时不会误删 sections、settings 或其他事项。
- API 使用 GitHub 文件 SHA 做乐观并发重试。
- `ETag` / `If-Match` 可以防止 AI 或自动化覆盖刚发生的新修改。
- 删除统一为软删除，能够继续参与跨设备同步。
- schema 升级时，外部平台只需要继续遵守稳定的 `/api/v1` 合约。

直接写 GitHub Markdown 仍然适合以下场景：

- 低频、异步的“投递箱”式采集。
- 希望内容天然是可人工编辑、可 review 的 Markdown。
- 外部平台只负责创建文件，之后由 TodoTodoList 导入。

直接编辑 `todotodolist/snapshot.json` **不推荐**。它要求调用方正确读取整个文件、保留未知字段、比较 SHA、合并并发修改并写回完整快照，出错时可能覆盖其他数据。

## 2. 环境变量

```env
# 必填：足够长的随机值，和网页登录密码分开设置
TODOTODOLIST_API_TOKEN=

# 可选：只在需要浏览器前端跨域直连 API 时配置，多个 origin 用英文逗号分隔
TODOTODOLIST_API_ALLOWED_ORIGINS=https://automation.example.com,https://internal.example.com

# API 使用现有 GitHub snapshot 存储配置
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
GITHUB_BRANCH=main
GITHUB_SNAPSHOT_PATH=todotodolist/snapshot.json
```

生成 token 示例：

```bash
openssl rand -hex 32
```

安全要求：

- 不要把 `TODOTODOLIST_API_TOKEN` 放进浏览器公开代码、Git 仓库或 AI 提示词正文。
- 第三方平台应使用 secret/credential 管理功能保存 token。
- GitHub token 只保存在 TodoTodoList 服务端，不提供给外部平台。
- 建议在生产环境只通过 HTTPS 调用。

如果未设置 `TODOTODOLIST_API_TOKEN`，数据接口返回 `503 api_not_configured`，不会降级为匿名访问。

## 3. API 发现与 OpenAPI

```txt
GET /api/v1
GET /api/v1/openapi
```

`/api/v1/openapi` 返回 OpenAPI 3.1 JSON，可导入支持 OpenAPI 的 AI agent、工作流平台或 API 客户端。

数据接口支持两种等价的鉴权方式：

```http
Authorization: Bearer <TODOTODOLIST_API_TOKEN>
```

或：

```http
X-API-Key: <TODOTODOLIST_API_TOKEN>
```

推荐使用 Bearer token。

## 4. Item CRUD

### 查询事项

```bash
curl -sS \
  -H "Authorization: Bearer $TODOTODOLIST_API_TOKEN" \
  "https://your-domain.example/api/v1/items?status=active&type=todo&limit=50"
```

支持的查询参数：

| 参数 | 说明 |
| --- | --- |
| `type` | `todo` / `idea` / `event` / `avoid` / `note` |
| `status` | `wanted` / `active` / `paused` / `abandoned` / `done` |
| `sectionId` | 版块 ID |
| `source` | `local` / `github` / `google_calendar` |
| `q` | 搜索标题、描述和标签 |
| `updatedSince` | ISO 8601 时间，只返回此时间之后更新的事项 |
| `includeDeleted` | `true` 时包含软删除事项，默认 `false` |
| `limit` | 1–200，默认 50 |
| `offset` | 分页偏移量，默认 0 |

### 查询单条事项

```bash
curl -i \
  -H "Authorization: Bearer $TODOTODOLIST_API_TOKEN" \
  "https://your-domain.example/api/v1/items/ITEM_ID"
```

响应带有 `ETag`。需要安全更新时，把它原样放入后续 `If-Match` 请求头。

### 创建事项

```bash
curl -sS \
  -X POST \
  -H "Authorization: Bearer $TODOTODOLIST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "n8n-email-20260717-001",
    "type": "todo",
    "title": "回复合作邮件",
    "description": "由自动化工作流创建",
    "sectionId": "inbox",
    "status": "wanted",
    "tags": ["email", "automation"]
  }' \
  "https://your-domain.example/api/v1/items"
```

`id` 可省略，服务端会生成 UUID。对于可能重试的自动化流程，建议传稳定且唯一的 `id`，重复创建会返回 `409 item_already_exists`，从而避免产生重复事项。

`avoid`（反向待办）必须同时提供有效的 `startAt` 和 `endAt`，并且结束时间晚于开始时间。

### 更新事项

```bash
curl -sS \
  -X PATCH \
  -H "Authorization: Bearer $TODOTODOLIST_API_TOKEN" \
  -H 'If-Match: "2026-07-17T08:00:00.000Z"' \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}' \
  "https://your-domain.example/api/v1/items/ITEM_ID"
```

若事项已被其他客户端修改，旧 ETag 会得到 `412 item_changed`。调用方应重新 GET，确认最新内容后再决定是否更新。

当前通用 API 只修改 `source: local` 的事项。来自 GitHub human file 或 Google Calendar 的事项可以查询，但 PATCH/DELETE 会返回 `409 provider_writeback_required`，避免只改 snapshot、却没有同步回真正的来源。此类事项应走对应的 provider 同步接口。

传 `null` 可以清空 `startAt`、`endAt` 或 `allDay`。恢复软删除事项：

```json
{ "deletedAt": null }
```

### 删除事项

```bash
curl -sS \
  -X DELETE \
  -H "Authorization: Bearer $TODOTODOLIST_API_TOKEN" \
  -H 'If-Match: "2026-07-17T08:00:00.000Z"' \
  "https://your-domain.example/api/v1/items/ITEM_ID"
```

DELETE 是软删除：API 设置 `deletedAt` 和新的 `updatedAt`，不会直接从 snapshot 中移除记录。

## 5. 查询版块

创建事项前可先读取有效 `sectionId`：

```bash
curl -sS \
  -H "Authorization: Bearer $TODOTODOLIST_API_TOKEN" \
  "https://your-domain.example/api/v1/sections"
```

如果 snapshot 尚不存在，第一次 POST 会创建带 `inbox`、`work`、`life` 三个默认版块的合法快照。

## 6. 与网页端同步

API 写入的是 `GITHUB_SNAPSHOT_PATH` 指向的 snapshot。网页端有三种接收方式：

1. 在同步视图手动读取 GitHub snapshot。
2. 启用“启动合并 GitHub 快照”，下次打开工作区时自动合并。
3. 网页端本地修改后启用“变更后保存 GitHub 快照”，继续把本地更新合并回同一文件。

合并以每条记录的 `updatedAt` 为准，API 删除产生的 tombstone 也会被同步。

## 7. AI / 自动化平台接入建议

- **OpenAPI agent / GPT Action 类工具**：导入 `/api/v1/openapi`，将 Bearer token 配置为平台 secret。
- **n8n / Make / Zapier**：使用 HTTP Request 节点；创建时传稳定 `id`，更新时尽量使用 `If-Match`。
- **脚本或 CLI agent**：先 GET 查询，再 PATCH；不要让模型直接生成或覆盖整个 snapshot。
- **只做内容投递的工具**：可以写入 `findwork/**/*.md`，然后走现有 human-file import；不要直接编辑 snapshot。

当前 API 聚焦 Item CRUD，版块暂时只读。以后如需完整工具协议，可在稳定的 service 层上继续增加 MCP server，而无需改变底层 GitHub snapshot 格式。
