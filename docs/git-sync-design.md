# TodoTodoList Git 同步设计 v0.1

## 1. 当前本地模拟库

为了模拟 GitHub 私有库，当前已创建本地 Git 仓库：

```txt
.tmp/local-git-repo/
  .git/
  todotodolist/
    sources.json
  findwork/
    product-plan.md
    ideas/
      calendar-sync.md
```

验证结果：

```txt
sourceCount: 1
fileCount: 2
itemCount: 7
```

说明：

- `.tmp/` 已被 `.gitignore` 排除，不会进入主项目仓库。
- 这个 repo 用于本地模拟 GitHub 私有库。
- 当前核心导入逻辑可以直接从这个本地 Git 工作区读取 `findwork/**/*.md`。

## 2. 同步方式结论

默认推荐两层同步模型：

```txt
GitHub Private Repo
  -> GitHub Tree / Contents API
  -> Server API
  -> Parsed Item / IndexedDB cache
```

默认不在用户浏览器或服务端缓存完整 Git 仓库。

本地开发、自部署、高级用户可以使用 Git worktree 模式：

```txt
Git clone / local repo
  -> read files from filesystem
  -> parse Markdown/frontmatter
  -> write frontmatter
  -> git commit / push
```

## 3. 为什么默认不缓存完整 Git 仓库

默认 Web/SaaS 部署不 clone 完整仓库，原因：

- 浏览器不能安全持有 Git 凭证和完整仓库。
- Serverless 环境文件系统通常是临时的，不适合长期保存 clone。
- clone 私有库可能拉取用户不希望应用读取的其他文件。
- 仓库可能很大，冷启动慢，存储成本高。
- 并发请求共享同一个 worktree 容易产生锁和冲突。
- Git 命令执行需要额外沙箱和安全边界。

因此 v0.1 默认使用 GitHub API：

- Tree API 列出匹配文件。
- Contents API 读取单个文件。
- Contents API 带 sha 写回单个文件。
- IndexedDB 只缓存解析后的 Item、source metadata 和同步状态。

## 4. 本地会缓存什么

### 浏览器 IndexedDB

缓存：

- Item。
- Section。
- Settings。
- Sync metadata。
- sourcePath / sourceSha / frontmatterHash / bodyHash。
- outbox。

不缓存：

- 完整 Git 仓库。
- `.git` 对象数据库。
- GitHub token。

### 服务端 API

默认不持久缓存。

可以短时缓存：

- GitHub tree 结果。
- 单文件内容。
- 请求级解析结果。

但 token 和完整 repo 不写入本地磁盘。

## 5. GitHub API 模式

### 读取

```txt
GET /git/trees/{branch}?recursive=1
  -> filter findwork/**/*.md
GET /contents/{path}?ref={branch}
  -> decode base64
  -> parse frontmatter/body/checkbox
```

### 写回

```txt
GET /contents/{path}?ref={branch}
  -> get current sha
  -> compare expectedSha
  -> update frontmatter only
PUT /contents/{path}
  -> message
  -> base64 content
  -> sha
  -> branch
```

### 冲突

- 如果 sha 不一致，拒绝自动写回。
- 重新拉取文件，重新解析。
- body 冲突默认保留远端正文。
- frontmatter 冲突交给用户选择。

## 6. Git worktree 模式

适合：

- 本地开发。
- 自部署。
- 用户明确希望完整 repo 在本机。
- 需要用 git diff、commit、branch、merge。

流程：

```txt
git clone git@github.com:user/private.git
git pull --ff-only
read findwork/**/*.md
parse to Items
write frontmatter
git diff
git commit -m "Update TodoTodoList metadata"
git push
```

优点：

- 人可以直接用 Git 工具查看 diff。
- 可以离线编辑。
- 可以批量提交。
- Git 历史清晰。
- 适合本地优先或自托管用户。

缺点：

- 需要本地磁盘保存完整仓库。
- 私有库凭证管理复杂。
- 多请求并发时容易出现 lock。
- 大仓库 clone 成本高。
- Serverless 平台不适合维护长期 worktree。
- 要处理 merge/rebase/conflict。
- 应用要防止读取超出授权范围的文件。

## 7. 推荐策略

v0.1 推荐：

- Web 默认使用 GitHub API 模式。
- 本地开发使用 `.tmp/local-git-repo` 模拟。
- 不在浏览器缓存完整 Git 仓库。
- 不在 Vercel/Serverless 上 clone 完整仓库。
- 自部署版本后续可增加 Git worktree backend。

## 8. 当前代码对应关系

GitHub API 模式：

- `src/github-human-files/github-client.ts`
- `src/github-human-files/github-source.ts`
- `app/api/github/import-human-files/route.ts`
- `app/api/github/writeback-human-file/route.ts`

本地模拟模式：

- `.tmp/local-git-repo`
- `src/github-human-files/local-source.ts`
- `examples/github-repo`

验证命令：

```bash
npm run demo:human-files
npm run demo:human-writeback
npm test
```

真实 GitHub：

```bash
GITHUB_TOKEN=... \
GITHUB_OWNER=... \
GITHUB_REPO=... \
GITHUB_BRANCH=main \
HUMAN_SOURCE_PATH='findwork/**/*.md' \
npm run github:import-human-files
```
