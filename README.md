# TodoTodoList

![TodoTodoList workflow overview: capture, organize, schedule, reflect](docs/assets/header.svg)

**A personal workspace for ideas, tasks, calendars, and the decisions to leave things undone.**

[简体中文](README.zh-CN.md) · [Setup and integrations](docs/setup-and-integrations.md) · [Contributing](CONTRIBUTING.md) · [Report a bug](https://github.com/dailyun/TTL/issues/new?template=bug_report.yml)

TodoTodoList brings scattered notes and scheduled work into one single-user workspace. Capture an idea, turn it into a task, place it on the calendar, and record what actually happened. Connect Markdown files, GitHub snapshots, Google Calendar, or external tools when you need them.

The project is under active development. Start locally with synthetic examples; Calendar authorization and phone notifications need their own setup and device verification.

## What you can do

| Workflow | What TodoTodoList provides |
| --- | --- |
| Capture before organizing | An inbox for tasks, ideas, events, notes, and screenshots |
| Decide what deserves attention | Today, active, list, board, and calendar views with filters and custom sections |
| Protect time | Time-boxed reverse todos for things you decide not to do |
| Keep notes readable | Markdown + YAML frontmatter import and frontmatter-only writeback |
| Connect your calendar | Optional Google Calendar import, event creation, editing, and deletion |
| Connect other tools | Bearer-token REST API, OpenAPI schema, and optional server-authoritative state |
| Review actual progress | Explicit completion, check-ins, feedback, and a PWA with an offline feedback queue |

## Try it locally

Use **Node.js 22** (the CI version), npm, and Git. No GitHub token, Google account, or AI API key is required for the basic local workspace.

```bash
git clone https://github.com/dailyun/TTL.git
cd TTL
npm ci
npm run local-git:seed
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

1. Add an idea or task to the inbox, then open it to edit its status and section.
2. Try the list, board, and calendar views to explore the same items.
3. Open **Sync** to import the seeded local Git files. The examples are synthetic; re-running the seed command replaces only `.tmp/local-git-repo`.
4. Try JSON export and import to see how workspace backup works.

Local development leaves password login disabled by default. Configure authentication before exposing an instance to the internet; see the [setup guide](docs/setup-and-integrations.md#environment).

## Choose your integrations

| Need | Start here |
| --- | --- |
| Environment variables, Node.js or Docker deployment | [Setup and integrations](docs/setup-and-integrations.md) |
| Markdown import and writeback | [GitHub human-readable files](docs/github-human-files.md) |
| Google Calendar authorization and two-way sync | [Calendar setup and acceptance](docs/google-calendar-sop.md) |
| REST API for scripts and external tools | [External API](docs/external-api.md) |
| Persistent server state, workers, backups, and rollback | [Execution operations](docs/execution-operations.md) |
| iPhone PWA notifications and feedback | [PWA feedback](docs/pwa-feedback.md) |
| Product and architecture decisions | [Documentation index](docs/README.md) |

## Data and deployment boundaries

- The default local workspace uses browser storage. Server-authoritative state and integrations require configuration; cloning source does not restore user data.
- GitHub snapshots, server state, Calendar credentials, and feedback files have separate persistence requirements. Follow the operations guide for backups.
- Calendar edits and deletion can write back to Google Calendar after authorization. Start with a test calendar.
- This is a single-user application. Multi-user authentication and multi-instance transactional storage are outside the current supported setup.
- Calendar end times do not mark tasks done; completion remains an explicit decision.

## Develop and contribute

```bash
npm test
npm run build
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for a local development workflow and focused contribution ideas. Bug reports with clear reproduction steps and feature requests describing a real workflow are welcome.
