# CLI 与 Studio API

入口：`pnpm --filter @flora/cli start <command> …`  
（也可用已构建的 `node packages/cli/dist/bin.js`。）

路径请尽量用**绝对路径**。

---

## CLI

### `studio`

| 选项 | 默认 | 说明 |
|---|---|---|
| `-p, --port <port>` | `4173` | `127.0.0.1` |
| `--no-open` | — | 不自动打开浏览器 |

```bash
pnpm studio
pnpm --filter @flora/cli start studio -- --port 4177 --no-open
```

### `analyze`

写出 `.flora/snapshot.json`，默认追加当日 timeline 帧。

| 参数 / 选项 | 默认 | 说明 |
|---|---|---|
| `[path]` | `.` | 项目根 |
| `-g, --granularity` | `auto` | `auto` \| `package` \| `directory` \| `file` |
| `--target <n>` | auto 时约 `12` | 叙事目标株数（4–36）。过少下钻；过多按父目录成簇。`file` 不按此折叠，而是按语言均衡采样 |
| `--rules <file>` | 自动查找 | 架构规则 |

```bash
pnpm --filter @flora/cli start analyze G:/code/my-app -- --target 12
pnpm --filter @flora/cli start analyze G:/code/my-app -- -g package --rules flora.rules.yaml
```

规则自动查找：`flora.rules.yaml` / `.yml` / `.json` / `.flora/rules.yaml`。  
模块地图：`flora.modules.yaml` 等（见 [CONFIG.md](./CONFIG.md)）。

### `timeline`

优先按 git **提交 worktree** 真实分析；失败或 `--approx` 时用出生/活跃度近似。

| 参数 / 选项 | 默认 | 说明 |
|---|---|---|
| `[path]` | `.` | 项目根 |
| `-d, --days <n>` | `30` | 回溯天数 |
| `-f, --frames <n>` | `8` | 帧数（上限约 16） |
| `-g, --granularity` | `auto` | 同 analyze |
| `--target <n>` | — | 同 analyze |
| `--approx` | off | 强制近似模式（不 checkout） |

```bash
pnpm --filter @flora/cli start timeline G:/code/my-app -- --days 30 --frames 8
pnpm --filter @flora/cli start timeline G:/code/my-app -- --approx
```

写出 `.flora/timeline.json` 与 `.flora/history/*.json`。

### `compare`

对比两分支 tip（临时 worktree，不含脏工作区）。

| 参数 / 选项 | 默认 | 说明 |
|---|---|---|
| `[path]` | `.` | 需为 git 仓 |
| `-b, --base <branch>` | **必填** | 基准分支 |
| `-H, --head <branch>` | **必填** | 对比分支 |
| `-g, --granularity` | `auto` | 同 analyze |
| `--rules <file>` | 自动查找 | 规则 |
| `--comment` | off | 打印 Markdown 评论体 |

```bash
pnpm --filter @flora/cli start compare G:/code/my-app -- --base main --head feature/x --comment
```

---

## Studio HTTP API

Base：`http://127.0.0.1:<port>`（本地 CORS 已放开）。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | `{ "ok": true }` |
| `GET` | `/api/recent` | `~/.flora/recent.json` |
| `GET` | `/api/fs/roots` | 浏览根 |
| `GET` | `/api/fs/list?path=` | 列子目录 |
| `POST` | `/api/pick-folder` | 原生对话框（可选；失败回退 fs API） |
| `POST` | `/api/analyze` | 分析 / 下钻 |
| `GET` | `/api/timeline?rootPath=` | 已有时间轴 |
| `GET` | `/api/timeline/progress` | 生成中的帧进度 |
| `POST` | `/api/timeline/build` | 生成时间轴 |
| `GET` | `/api/branches?rootPath=` | 分支列表 |
| `POST` | `/api/compare` | 双花园 diff |

### `POST /api/analyze`

```json
{
  "rootPath": "G:/code/my-app",
  "granularity": "auto",
  "targetPlants": 12,
  "focusPath": null,
  "ignore": []
}
```

- `focusPath`：相对或绝对子路径 → **点株下钻**（不覆盖根 snapshot / 不追加 timeline）  
- 响应：`{ snapshot, summary, timeline?, drilled? }`

### `POST /api/timeline/build`

```json
{
  "rootPath": "G:/code/my-app",
  "days": 30,
  "frames": 8,
  "granularity": "auto",
  "targetPlants": 12,
  "mode": "auto"
}
```

`mode`：`auto` \| `commits` \| `approx`。响应含 `mode` 字段提示实际使用的模式。  
`commits` 默认并发 2，结果缓存在目标仓 `.flora/commit-cache/`。生成时可轮询 `GET /api/timeline/progress`。

### `POST /api/compare`

```json
{
  "rootPath": "G:/code/my-app",
  "baseRef": "main",
  "headRef": "feature/x",
  "granularity": "auto",
  "targetPlants": 12
}
```

响应：`{ diff, comment, summary }`（`diff` 含 base/head snapshot、plant/vine changes、高亮 id 列表）。

静态资源：`apps/studio/dist`；未构建时返回内置降级页。

---

## 核心库导出（概要）

`@flora/core`：

| 符号 | 用途 |
|---|---|
| `analyze` | 分析；支持 `targetPlants` / `focusPath` |
| `buildTimeline` / `loadTimeline` | 时间轴（commits / approx） |
| `compareRefs` / `diffGardens` / `formatDiffComment` / `listGitBranches` | PR 对比 |
| `analyzeAtRef` | 指定 git ref 分析（worktree） |
| `discoverModuleGraph` / `fitModulesToTarget` | 发现与叙事压缩 |
| `loadRules` / `loadModulesMap` | 规则与模块地图 |
| `computeStructureFlags` / `diffusePollutions` | 结构与污染 |
| `ALL_ADAPTERS` | 多语言解析 |

`@flora/render`：`GardenRenderer`（`highlightIds` / `badges` / `title`）、`mountGarden`。

类型以各包 `dist/*.d.ts` 为准。
