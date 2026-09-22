# TodoTodoList

TodoTodoList is a personal execution workspace. The persistent server stores items, calendar links and feedback; the local Goal Tree and Codex handle planning and analysis. GitHub remains an optional file source and snapshot archive.

## Repository and local workspace

- Clone this repository into a directory of your choice; it is an independent application repository.
- This repository stores application source, synthetic examples and general deployment instructions. Personal workspace paths, deployment addresses, account data and operational records belong in private configuration or a separate private runbook.
- `.env*` (except `.env.example`), private operational files, runtime data, dependencies and build output stay outside Git. Cloning the source does not restore production credentials or user data.
- The optional GitHub snapshot/file source configured in settings is a separate integration. Example paths such as `findwork/**/*.md` refer to the synthetic files in `examples/`, not a user's local workspace.

The current app includes:

- Inbox, today, active, list, board, calendar, and sync views.
- Todo / Idea / Event / “不要做”反向待办 / “沉淀”记录 item types.
- Statuses: wanted, active, paused, abandoned, done.
- Custom sections with rename, color, and archive controls.
- Search plus type, status, section, schedule, and source filters.
- Soft delete with confirmation before items leave the default views.
- Sidebar view settings for showing completed calendar items and abandoned board items.
- Optional startup merge from the GitHub JSON snapshot and debounced save after local changes.
- A monthly calendar with direct event creation, multi-day items, drag-to-move, and resize handles.
- A reverse-todo list for time-boxed decisions about what not to do, integrated with home, filters, detail editing, calendar ranges, snapshots, and human-readable Git files.
- A dedicated capture view for fragmentary notes, early ideas, and up to six pasted or uploaded screenshots per record.
- Markdown + YAML frontmatter import from files such as `findwork/**/*.md`.
- Frontmatter-only writeback that preserves Markdown body content.
- A bearer-token REST/OpenAPI API. With TODOTODOLIST_STATE_PATH enabled, browser and API Item CRUD share the same server state.
- An iPhone home-screen PWA starting at `/today`, offline feedback queue, append-only corrections, daily digests and an independent execution worker. See [operations and acceptance](docs/execution-operations.md); actual phone delivery and Calendar authorization require separate verification.
- Local Git repo simulation for development.
- Optional single-user password login.
- Google Calendar OAuth helper, event import, local event creation, and safe event writeback.
- Vercel, Node.js, and Docker deployment paths.

## Quick Start

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open:

```txt
http://127.0.0.1:3000
```

Seed the local Git simulation repo:

```bash
npm run local-git:seed
```

In the app, use the Sync view to import from `.tmp/local-git-repo/todotodolist/sources.json`.
Repeated imports merge by item `updatedAt`, so older remote records do not overwrite newer local edits.

## Environment

Copy the example file when deploying or testing integrations:

```bash
cp .env.example .env
```

Important variables:

```txt
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
GITHUB_BRANCH=main
GITHUB_SNAPSHOT_PATH=todotodolist/snapshot.json
HUMAN_SOURCE_ID=findwork
HUMAN_SOURCE_PATH=findwork/**/*.md
HUMAN_SOURCE_SECTION=work
TODOTODOLIST_PASSWORD=
TODOTODOLIST_AUTH_SECRET=
TODOTODOLIST_TRUST_PROXY=false
TODOTODOLIST_PROXY_HOPS=1
TODOTODOLIST_API_TOKEN=
TODOTODOLIST_API_ALLOWED_ORIGINS=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:3000/api/google-calendar/oauth/callback
GOOGLE_REFRESH_TOKEN=
GOOGLE_REFRESH_TOKEN_PATH=.tmp/google-calendar-token.json
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_SECTION=work
GOOGLE_CALENDAR_WEBHOOK_URL=https://todo.example.com/api/google-calendar/webhook
GOOGLE_CALENDAR_SYNC_STATE_PATH=.tmp/google-calendar-sync-state.json
GOOGLE_CALENDAR_FALLBACK_POLL_SECONDS=300
GOOGLE_CALENDAR_INITIAL_DAYS_BACK=30
GOOGLE_CALENDAR_INITIAL_DAYS_FORWARD=365
GOOGLE_CALENDAR_WATCH_TTL_SECONDS=518400
```

`TODOTODOLIST_PASSWORD` enables the simple login system. Leave it empty for local development without login. Set `TODOTODOLIST_AUTH_SECRET` to a strong random value in production. By default failed attempts share a safe global rate-limit key because request forwarding headers are client-controlled. Only set `TODOTODOLIST_TRUST_PROXY=true` when the app is behind a trusted reverse proxy; set `TODOTODOLIST_PROXY_HOPS` to the number of trusted proxy hops so the server can select the correct address from `X-Forwarded-For`.

The Sync view can save the full IndexedDB snapshot to GitHub and read it back for merge/replace recovery. By default this uses `todotodolist/snapshot.json`; set `GITHUB_SNAPSHOT_PATH` to choose a different repo path. Enable the sidebar setting `启动合并 GitHub 快照` when you want the app to merge newer records from that snapshot automatically on startup. Enable `变更后保存 GitHub 快照` when local edits should be saved back to GitHub after a short debounce.

Set `TODOTODOLIST_API_TOKEN` to enable `/api/v1/items` CRUD for external platforms and AI tools. The API uses the configured GitHub snapshot as durable storage, requires a Bearer token (or `X-API-Key`), supports soft deletes and optimistic updates with `ETag` / `If-Match`, and publishes an OpenAPI 3.1 document at `/api/v1/openapi`. `TODOTODOLIST_API_ALLOWED_ORIGINS` is only needed for approved browser-based cross-origin clients. See [`docs/external-api.md`](docs/external-api.md) for setup, curl examples, and the recommended API-vs-direct-GitHub-file architecture.

For Google Calendar, open `/api/google-calendar/oauth/start` and approve access. The callback automatically stores the refresh token at `GOOGLE_REFRESH_TOKEN_PATH`; `GOOGLE_REFRESH_TOKEN` remains a fallback for manual deployments. The Sync view can then import recent Google Calendar events into the workspace calendar. Local scheduled Todo/Event items can be created in Google Calendar from their detail drawer. Google-linked events write back title, description, and schedule changes when you edit, drag, or resize them. Deleting a Google-linked item also deletes the remote Google Calendar event before soft-deleting the local item. Remote cancelled/deleted Google events become local soft deletes on the next import.

For near-real-time two-way sync, expose the HTTPS webhook route at `/api/google-calendar/webhook`, set its absolute public URL in `GOOGLE_CALENDAR_WEBHOOK_URL`, and enable `Google 日历实时同步` in the sidebar. The server registers a renewable Google Events watch channel, uses `nextSyncToken` for incremental pulls, retains unacknowledged changes on disk, and falls back to a periodic incremental poll because Google push delivery is not guaranteed. Persist both `GOOGLE_REFRESH_TOKEN_PATH` and `GOOGLE_CALENDAR_SYNC_STATE_PATH`; a single shared writable volume is required when the app is deployed in a container.

For the complete Google Cloud setup, OAuth authorization, acceptance testing, troubleshooting, and rollback procedure, see [`docs/google-calendar-sop.md`](docs/google-calendar-sop.md).

## Verification

Run the normal checks:

```bash
npm test
npm run build
npm run check
```

The GitHub Actions CI workflow runs the same checks on push and pull request.

Check dependency advisories against the public npm registry:

```bash
npm audit --registry=https://registry.npmjs.org
```

The project currently overrides `postcss` to a patched version because the latest Next.js release still depends on an older vulnerable range.

## Docker

Build the image:

```bash
docker build -t todotodolist:latest .
```

Run it:

```bash
docker run --rm \
  -p 3000:3000 \
  --env-file .env \
  todotodolist:latest
```

Or start from the compose example:

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up --build -d
```

Health check:

```txt
GET /api/health
```

## GitHub Human Files

The recommended human-readable source shape is:

```txt
todotodolist/
  sources.json
findwork/
  product-plan.md
  ideas/
    calendar-sync.md
```

Example source config:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "findwork",
      "label": "Find Work",
      "path": "findwork/**/*.md",
      "mode": "read-write",
      "defaultSectionId": "work",
      "defaultType": "idea",
      "defaultStatus": "wanted",
      "importCheckboxes": true,
      "writeBack": "frontmatter-only"
    }
  ]
}
```

See [GitHub human-readable file sync](./docs/github-human-files.md) for mapping and writeback rules.

## JSON 备份与恢复

在工作区右上角使用 JSON 按钮：

- 下载：导出完整的 `todotodolist-snapshot-YYYY-MM-DD.json` 文件。
- 上传：选择快照文件，预览事项、版块、设置数量后，选择合并较新数据或覆盖本地缓存。

覆盖模式会先清空本地 IndexedDB 缓存再恢复快照。合并模式在 ID 已存在时保留 `updatedAt` 较新的记录。

## Documentation

- [Docs index](./docs/README.md)
- [Product plan](./docs/product-plan.md)
- [Technical design](./docs/technical-design.md)
- [Git sync design](./docs/git-sync-design.md)
- [Deployment plan](./docs/tech-stack-and-deployment.md)
- [Implementation roadmap](./docs/implementation-roadmap.md)

## Current Limits

- Google Calendar supports renewable webhook notifications, incremental `nextSyncToken` pulls, at-least-once browser delivery, local event creation/writeback, and remote deletion. The browser applies queued changes while the workspace is open; multi-instance deployments need a shared/transactional state store instead of the default local state file.
- The default deployed path should use GitHub API mode, not a full Git clone.
- Local Git worktree mode is intended for local development and self-hosted deployments.
- Multi-user auth needs a proper OAuth-backed account system later.


## iPhone push and owner feedback (first slice)

Open `/review` to answer check-ins and manage this device's notifications. Follow [`docs/pwa-feedback.md`](docs/pwa-feedback.md) to configure VAPID keys, a persistent `TODOTODOLIST_CHECKIN_PATH`, the public HTTPS origin, and the optional reminder worker. Feedback and push state are server-side files, separate from the GitHub Item snapshot; include them in private backups. The local Goal Tree can publish reviewed check-ins, read feedback, and import a selected owner reply as a node note.

Calendar end times no longer mark items done. Incoming schedule changes preserve the existing item's status; older automatically completed items are not silently reset. Actual completion remains an explicit owner decision. Past imported Google events whose stored status is still active are displayed separately as “历史待确认” in the home page, status filter, and board, and no longer count as active work. This is a time-based display classification, including existing imports; it does not rewrite execution status or feedback. All-day events remain current through their inclusive final day. No real calendar-driven reminders or daily AI flow are enabled by this change.

## Goal Tree execution

Use the [execution operations guide](docs/execution-operations.md) for server-authoritative mode, migration, daily backups, iPhone notifications and rollback. `npm run execution:worker` continues synchronization without an open browser. The local CLI and LaunchAgent live in the Goal Tree project.
