# GitHub 人工可读写文件同步 v0.1

本设计补充 GitHub 私有库数据源能力：除了系统管理的结构化 JSON，用户还可以在私有库中维护人工可读、可写的 Markdown 文件，并让这些文件同步进 TodoTodoList。

示例目标：

```txt
findwork/
  product-plan.md
  meeting-notes.md
  ideas/
    calendar-sync.md
```

这些文件可以被系统读取为 Todo / Idea / Event，也可以被系统安全地回写 metadata。

## 1. 设计原则

- 人可以直接读：正文使用 Markdown。
- 人可以直接写：用户可以在 GitHub、编辑器或脚本里修改文件。
- 系统可解析：使用 YAML frontmatter 提供结构化字段。
- 回写不破坏正文：系统优先只改 frontmatter，尽量保留 Markdown body 原样。
- 可配置目录：不仅支持 `todotodolist/`，也支持 `findwork/` 这类用户自己的工作目录。
- 可追踪来源：每个同步出的 Item 需要保存 `sourcePath` 和 `sourceSha`。

## 2. GitHub repo 推荐结构

```txt
todotodolist/
  manifest.json
  sections.json
  settings.json
  items/
    2026/
      07.json
  sync/
    github.json
    google-calendar.json
  sources.json

findwork/
  product-plan.md
  meeting-notes.md
  ideas/
    calendar-sync.md
```

说明：

- `todotodolist/` 是系统结构化数据区。
- `findwork/` 是用户人工工作区。
- `sources.json` 声明哪些人工目录需要被系统同步。

## 3. sources.json

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

字段说明：

| 字段 | 含义 |
| --- | --- |
| id | 文件源 ID |
| label | UI 中展示名称 |
| path | GitHub repo 内 glob 路径 |
| mode | `read-only` 或 `read-write` |
| defaultSectionId | 未声明版块时的默认版块 |
| defaultType | 未声明类型时的默认类型 |
| defaultStatus | 未声明状态时的默认状态 |
| importCheckboxes | 是否把 Markdown checkbox 导入为 Todo |
| writeBack | `none` / `frontmatter-only` / `full-file` |

## 4. Markdown 文件格式

推荐格式：

```md
---
id: item_01JABC
type: idea
status: wanted
section: work
title: 研究 GitHub 私库同步
tags:
  - github
  - sync
startAt:
endAt:
updatedAt: 2026-07-07T12:00:00.000Z
todotodolist:
  sync: true
  source: findwork
---

# 研究 GitHub 私库同步

目标：让人工写的 Markdown 也能进入系统。

- [ ] 调研 GitHub Contents API
- [ ] 设计 frontmatter schema
- [x] 确认用户希望人工可读写
```

映射规则：

- frontmatter 的 `title` 优先作为 Item title。
- 如果没有 `title`，使用第一个 H1。
- 如果没有 H1，使用文件名。
- Markdown body 作为 Item description。
- `type` 缺省使用 source.defaultType。
- `status` 缺省使用 source.defaultStatus。
- `section` 缺省使用 source.defaultSectionId。
- `tags` 映射到 Item tags。
- `startAt` / `endAt` 映射到日历时间。

## 5. Checkbox 导入规则

如果 `importCheckboxes = true`，Markdown 中的 checkbox 可以被导入为子 Todo：

```md
- [ ] 调研 GitHub Contents API
- [x] 确认用户希望人工可读写
```

建议映射：

- `- [ ]` 生成 status = wanted 或 active 的 Todo。
- `- [x]` 生成 status = done 的 Todo。
- 子 Todo 记录 `parentSourcePath` 和行号或稳定 marker。
- 如果 checkbox 行后带 `<!-- tdl:id=item_xxx -->`，使用该 id 保持稳定。

示例：

```md
- [ ] 调研 GitHub Contents API <!-- tdl:id=item_01JDEF -->
```

第一版可以先只导入 checkbox，不自动回写 checkbox 状态；后续再支持双向更新。

## 6. 回写策略

### frontmatter-only

默认推荐。系统只更新 frontmatter：

- id
- type
- status
- section
- title
- tags
- startAt / endAt
- updatedAt
- todotodolist metadata

优点：

- 最大限度保护人工编辑的正文。
- 冲突更容易处理。

缺点：

- 如果用户在系统里改 description，正文回写需要额外确认。

### full-file

系统可以重写整份 Markdown 文件。

只建议用于系统创建的文件，不建议用于已有人工文件。

### read-only

系统只读取，不回写。适合用户不希望应用修改的知识库目录。

## 7. 冲突策略

冲突来源：

- 用户在 GitHub/编辑器中修改 Markdown。
- 用户在 TodoTodoList 中修改同一 Item。
- GitHub 文件 sha 发生变化。

MVP 策略：

- 拉取时保存 `sourceSha`。
- 回写前重新读取文件 sha。
- sha 不一致时，重新解析文件并做字段级比较。
- frontmatter 字段冲突时提示用户选择本地或远端。
- Markdown body 冲突时默认保留远端正文，不自动覆盖人工编辑。

## 8. Item 扩展字段

```ts
interface ItemSourceLink {
  provider: "github";
  sourceId: string;
  sourcePath: string;
  sourceSha?: string;
  frontmatterHash?: string;
  bodyHash?: string;
  writeBack: "none" | "frontmatter-only" | "full-file";
}
```

Item 可增加：

```ts
sourceLink?: ItemSourceLink;
```

## 9. MVP 建议范围

v0.1 支持：

- 配置一个或多个人工文件源。
- 支持 `findwork/**/*.md` 这类 Markdown glob。
- 解析 YAML frontmatter。
- 将 Markdown 文件导入为 Idea / Todo / Event。
- 支持 checkbox 只读导入为 Todo。
- 支持 frontmatter-only 回写。
- 展示来源路径和同步状态。

v0.1 暂不支持：

- 自动重写整份人工 Markdown。
- 深度双向同步 checkbox 状态。
- 复杂 Markdown AST 编辑。
- 非 Markdown 富文本格式。

## 10. 示例用户流程

1. 用户在 GitHub 私有库中新建 `findwork/product-plan.md`。
2. 文件包含 frontmatter 或普通 Markdown。
3. TodoTodoList 同步 `findwork/**/*.md`。
4. 系统把文件导入为 Idea。
5. 用户在系统中把状态改为 active。
6. 系统只回写 frontmatter 中的 `status: active` 和 `updatedAt`。
7. 用户仍然可以继续在 GitHub 或本地编辑器里修改正文。

## 11. 当前代码验证入口

本仓库已提供核心验证脚本：

```bash
npm run demo:human-files
npm run demo:human-writeback
```

连接真实 GitHub 私有库时，配置环境变量后运行：

```bash
GITHUB_TOKEN=... \
GITHUB_OWNER=your-name \
GITHUB_REPO=your-private-repo \
GITHUB_BRANCH=main \
HUMAN_SOURCE_PATH='findwork/**/*.md' \
npm run github:import-human-files
```

该脚本会通过 GitHub Contents / Git Tree API 读取匹配文件，解析为系统 Item，并输出导入结果。

真实 GitHub 私有库 frontmatter-only 回写：

```bash
GITHUB_TOKEN=... \
GITHUB_OWNER=your-name \
GITHUB_REPO=your-private-repo \
GITHUB_BRANCH=main \
HUMAN_WRITEBACK_PATH='findwork/product-plan.md' \
HUMAN_WRITEBACK_STATUS=active \
npm run github:writeback-human-file
```

字段映射和防格式错误策略见 `docs/mapping-and-validation.md`。
