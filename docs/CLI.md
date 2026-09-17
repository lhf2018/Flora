# CLI 与 Studio API

## CLI

入口：`pnpm --filter @flora/cli start <command> …`  
（包内也可用已构建的 `node packages/cli/dist/bin.js`。）

### `studio`

打开本地 Studio 并托管静态页。

| 选项 | 默认 | 说明 |
|---|---|---|
| `-p, --port <port>` | `4173` | 监听端口（`127.0.0.1`） |
| `--no-open` | — | 不自动打开浏览器 |

```bash
pnpm studio
pnpm --filter @flora/cli start studio -- --port 4177 --no-open
```

### `analyze`

扫描仓库，写出 `.flora/snapshot.json`，并默认追加当日 history 帧。

| 参数 / 选项 | 默认 | 说明 |
|---|---|---|
| `[path]` | `.` | 项目根路径 |
| `-g, --granularity` | `auto` | `auto` \| `package` \| `directory` \| `file` |
| `--rules <file>` | 自动查找 | 架构规则文件 |

```bash
pnpm --filter @flora/cli start analyze G:/code/my-app
pnpm --filter @flora/cli start analyze G:/code/my-app -- -g package --rules flora.rules.yaml
```

规则自动查找顺序：`flora.rules.yaml` / `.yml` / `.json` / `.flora/rules.yaml`。

### `timeline`

按 git 元数据生成多帧时间轴（无需 checkout）。

| 参数 / 选项 | 默认 | 说明 |
|---|---|---|
| `[path]` | `.` | 项目根路径 |
| `-d, --days <n>` | `30` | 回溯天数 |
| `-f, --frames <n>` | `12` | 帧数 |
| `-g, --granularity` | `auto` | 同 analyze |

```bash
pnpm --filter @flora/cli start timeline G:/code/my-app -- --days 30 --frames 12
```

写出 `.flora/timeline.json` 与 `.flora/history/*.json`。

### `compare`

PR 双花园：对比两个分支的最新 tip。

| 参数 / 选项 | 默认 | 说明 |
|---|---|---|
| `[path]` | `.` | 项目根路径（需为 git 仓库） |
| `-b, --base <branch>` | **必填** | 基准分支 |
| `-H, --head <branch>` | **必填** | 对比分支 |
| `-g, --granularity` | `auto` | 同 analyze |
| `--rules <file>` | 自动查找 | 规则文件 |
| `--comment` | off | 打印 Markdown 评论体 |

```bash
pnpm --filter @flora/cli start compare G:/code/my-app -- --base main --head feature/x --comment
```

两侧均取分支 tip 的已提交树（临时 worktree），不含未提交脏改动。

---

## Studio HTTP API

Base：`http://127.0.0.1:<port>`（CORS 已放开，供本地页调用）。

### `GET /api/health`

```json
{ "ok": true }
```

### `GET /api/recent`

最近分析过的项目（读 `~/.flora/recent.json`）。

```json
{ "recent": [{ "path": "...", "projectId": "...", "at": "ISO-8601" }] }
```

### `GET /api/fs/roots`

可选根（盘符 / 家目录等），供页内浏览。

### `GET /api/fs/list?path=<dir>`

列子目录：

```json
{
  "path": "G:\\code",
  "parent": "G:\\",
  "entries": [{ "name": "Flora", "path": "G:\\code\\Flora" }]
}
```

### `POST /api/pick-folder`

体：`{ "startPath"?: string }`  
尝试原生文件夹对话框；失败时 UI 应回退到 `/api/fs/*`。

### `POST /api/analyze`

```json
{
  "rootPath": "G:/code/my-app",
  "granularity": "auto",
  "ignore": []
}
```

响应：

```json
{
  "snapshot": { "...GardenSnapshot..." },
  "summary": "5 模块 · 6 依赖 · …",
  "timeline": null
}
```

### `GET /api/timeline?rootPath=<path>`

若存在 timeline，返回索引及各帧内嵌 snapshot。

### `POST /api/timeline/build`

```json
{
  "rootPath": "G:/code/my-app",
  "days": 30,
  "frames": 12,
  "granularity": "auto"
}
```

### `GET /api/branches?rootPath=<path>`

列出本地 + remote 分支及 tip short SHA，供 Studio 下拉框。

```json
{
  "branches": [
    { "name": "main", "tip": "abc1234", "current": false, "remote": false }
  ],
  "current": "feature/x",
  "defaultBase": "main",
  "defaultHead": "feature/x"
}
```

### `POST /api/compare`

对比**两个分支各自最新 tip**（已提交树，经临时 worktree；不是工作区脏改动）。

```json
{
  "rootPath": "G:/code/my-app",
  "baseRef": "main",
  "headRef": "feature/x",
  "granularity": "auto",
  "rulesPath": null
}
```

响应：

```json
{
  "diff": {
    "baseRef": "main",
    "headRef": "HEAD",
    "base": { "...snapshot..." },
    "head": { "...snapshot..." },
    "summary": "…",
    "bullets": ["…"],
    "plantChanges": [],
    "vineChanges": [],
    "worsenedIds": [],
    "improvedIds": [],
    "addedIds": [],
    "removedIds": []
  },
  "comment": "### Flora 花园对比 …",
  "summary": "…"
}
```

静态资源：已构建的 `apps/studio/dist`；未构建时返回内置降级 HTML。

---

## 核心库导出（概要）

`@flora/core` 常用：

| 符号 | 用途 |
|---|---|
| `analyze` | 单次分析 → Snapshot |
| `buildTimeline` / `loadTimeline` | 时间轴 |
| `compareRefs` / `diffGardens` / `formatDiffComment` | PR 对比 |
| `analyzeAtRef` | 指定 git ref 分析 |
| `ALL_ADAPTERS` | 多语言解析器 |

`@flora/render`：

| 符号 | 用途 |
|---|---|
| `GardenRenderer` | Canvas 花园；支持 `highlightIds` / `badges` / `title` |
| `mountGarden` | 快捷挂载 |

类型以各包 `dist/*.d.ts` 为准。
