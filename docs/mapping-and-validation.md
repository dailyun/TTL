# TodoTodoList 映射与格式校验方案 v0.1

这份文档回答三个问题：

1. GitHub 私有库中的人工文件如何进入系统。
2. 系统 Item 如何映射回 Markdown/frontmatter。
3. 如何防止格式错误、错误覆盖和不可恢复的数据损坏。

## 1. 数据流总览

```txt
GitHub Private Repo
  -> sources.json
  -> findwork/**/*.md
  -> Markdown parser
  -> frontmatter schema validation
  -> Item / child Todo mapping
  -> IndexedDB cache
  -> UI
  -> outbox
  -> frontmatter-only writeback
  -> GitHub Contents API
```

核心原则：

- Markdown 正文属于用户，系统默认不重写正文。
- frontmatter 是系统和人工之间的结构化协议。
- checkbox 可以被导入为 Todo，但 v0.1 不自动回写 checkbox 状态。
- 所有写回必须基于 GitHub sha，防止覆盖别人刚改的文件。

## 2. sources.json 到文件源

### 输入

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

### 校验

| 字段 | 规则 |
| --- | --- |
| version | 必须为 `1` |
| id | 必填，非空字符串 |
| path | 必填，GitHub repo 内 glob |
| mode | `read-only` 或 `read-write` |
| defaultType | `todo` / `idea` / `event` |
| defaultStatus | `wanted` / `active` / `paused` / `abandoned` / `done` |
| writeBack | `none` / `frontmatter-only` / `full-file` |

### 错误处理

- `sources.json` 无法解析：停止该 GitHub source，同步状态标记 error。
- 单个 source 配置错误：跳过该 source，不影响其他 source。
- glob 没匹配到文件：不是错误，显示空结果。

## 3. Markdown 到 Item 映射

### frontmatter 示例

```md
---
id: item_findwork_product_plan
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
---

# 研究 GitHub 私库同步

正文内容。
```

### 字段映射

| Markdown/frontmatter | Item 字段 | 规则 |
| --- | --- | --- |
| `id` | `id` | 有则使用；无则由 `sourcePath` 生成稳定 ID |
| `type` | `type` | 无则使用 source.defaultType |
| `status` | `status` | 无则使用 source.defaultStatus |
| `sectionId` | `sectionId` | 优先级高于 `section` |
| `section` | `sectionId` | 兼容人工写法 |
| `title` | `title` | 优先级最高 |
| 第一个 H1 | `title` | 没有 `title` 时使用 |
| 文件名 | `title` | 没有 `title` 和 H1 时使用 |
| `tags` | `tags` | 必须是字符串数组 |
| `startAt` | `startAt` | ISO 字符串或日期 |
| `endAt` | `endAt` | ISO 字符串或日期 |
| `allDay` | `allDay` | boolean |
| Markdown body | `description` | 原样 trim 后存入 |
| 文件路径 | `sourceLink.sourcePath` | 例如 `findwork/product-plan.md` |
| GitHub sha | `sourceLink.sourceSha` | 写回前比较 |

## 4. Checkbox 到 Todo 映射

### 输入

```md
- [ ] 调研 GitHub Contents API <!-- tdl:id=item_research_github_contents -->
- [x] 确认用户希望人工可读写
```

### 规则

| Markdown | Todo |
| --- | --- |
| `- [ ]` | status = `wanted` |
| `- [x]` | status = `done` |
| `<!-- tdl:id=... -->` | 使用该稳定 ID |
| 无 marker | 使用 `sourcePath + line + title` 生成稳定 ID |
| 所属文件 | `parentId = rootItem.id` |

### v0.1 限制

- checkbox 只读导入。
- 不自动重写 checkbox 行。
- 如果用户要双向同步 checkbox，需要后续做 Markdown AST 级编辑。

## 5. Item 到 frontmatter 回写

### 可自动回写字段

```ts
{
  id,
  type,
  status,
  sectionId,
  title,
  tags,
  startAt,
  endAt,
  allDay,
  updatedAt
}
```

### 不自动回写字段

- Markdown body / description。
- checkbox 状态。
- 用户自定义的未知 frontmatter 字段。

说明：

- 未知 frontmatter 字段会保留。
- 系统 patch 只覆盖明确字段。
- 如果用户在 UI 中修改 description，v0.1 只更新 Item，本文件回写需要用户确认。

## 6. 防格式错误策略

### 解析层

- 使用 `gray-matter` 解析 frontmatter。
- 使用 `zod` 校验 `sources.json`、source 配置和 frontmatter 字段。
- 不符合 schema 的文件不会静默导入为错误数据。

### 导入层

错误分类：

| 类型 | 处理 |
| --- | --- |
| frontmatter YAML 语法错误 | 跳过该文件，记录错误 |
| type/status 枚举错误 | 使用默认值或提示修复，取决于严格模式 |
| tags 不是数组 | 跳过 tags，记录 warning |
| startAt/endAt 无法解析 | 不导入时间字段，记录 warning |
| 文件无标题 | 使用文件名 |

v0.1 推荐：

- 对 `sources.json` 使用严格模式，错误则阻止该 source。
- 对单个 Markdown 文件使用宽松模式，尽量导入正文，但记录 warning。

### 写回层

写回前必须：

1. 读取 GitHub 当前文件。
2. 比较当前 sha 和 `sourceSha`。
3. sha 不一致时拒绝自动写回。
4. 重新解析当前文件。
5. 只更新 frontmatter。
6. 提交 GitHub Contents API PUT。

拒绝自动写回的情况：

- sha 不一致。
- 当前文件 frontmatter 无法解析。
- writeBack = `none`。
- 用户修改 description 但目标是人工 Markdown 正文。
- 文件不是 Markdown。

## 7. 冲突处理

### 冲突类型

| 冲突 | 默认处理 |
| --- | --- |
| frontmatter 双边修改 | 提示用户选择 |
| body 被远端修改 | 保留远端 body |
| 本地删除、远端修改 | 提示恢复或删除 |
| 远端删除、本地修改 | 提示重新创建或放弃 |
| checkbox 行移动 | 保留已有 Todo，但提示来源行变化 |

### 数据保留

每个从 Markdown 导入的 Item 保存：

```ts
sourceLink: {
  provider: "github",
  sourceId,
  sourcePath,
  sourceSha,
  frontmatterHash,
  bodyHash,
  writeBack
}
```

这些字段用于判断：

- 文件是否变化。
- frontmatter 是否变化。
- body 是否变化。
- 是否可以安全回写。

## 8. 当前实现状态

已实现：

- `sources.json` schema。
- `findwork/**/*.md` 本地扫描。
- Markdown/frontmatter 导入。
- checkbox 导入。
- frontmatter-only 回写。
- GitHub Contents / Tree API 客户端。
- 真实 GitHub 导入脚本。
- 真实 GitHub frontmatter 回写脚本。
- 自动化测试。

待实现：

- IndexedDB 持久化。
- UI 设置页。
- 冲突 UI。
- Google Calendar 同步。
- Next.js API routes。
