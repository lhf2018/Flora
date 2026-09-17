# Flora 技术方案

> **一句话**：Flora 是一套「代码库 → 花园全景」的可复用工具链。对任意仓库选路径或跑一条命令，就能得到一张位置稳定、状态会变的活地图；向下可诊断，沿时间可回放。

---

## 0. 实现状态（与代码同步）

| 能力 | 状态 | 说明 |
|---|---|---|
| Studio 选路径出树 | ✅ | 页面内目录浏览 + `POST /api/analyze` |
| 情绪全景 + 诊断抽屉 | ✅ | Canvas；报告 / 热点 / 结构标记 / 依赖下钻 |
| 物种造型（按语言） | ✅ | 造型=语言，颜色=健康；见 §4.4 |
| JS/TS Adapter | ✅ | import/require/dynamic；跳过 type-only；包名 + paths |
| Python / Go / JVM Adapter | ✅ | 见 §5.1；与 npm monorepo 可并存 |
| 架构规则引擎 | ✅ | layers + 加厚禁令 + entry-only + import 黑名单 |
| 模块地图 | ✅ | `flora.modules.yaml` merge/split/ignore/粒度 |
| 结构腐化 | ✅ | 上帝模块 / 不稳定 / 热点；孤儿保守（认 package.json + 排除共享库） |
| 污染扩散 | ✅ | 沿藤蔓 BFS 衰减 |
| 时间轴存储 | ✅ | `.flora/history/*.json` + `timeline.json` |
| 延时回放 UI | ✅ | Studio 底部滑条 / 生成回放 / 播放 |
| 布局缓存 | ✅ | 小图新鲜布局，大图读缓存 |
| tsconfig paths 别名 | ✅ | `@/` 等解析到工作区内模块 |
| workspace 声明依赖边 | ✅ | package.json deps 补全漏边；纠孤儿误报 |
| PR 双花园对比 | ✅ | 分支 tip + Studio 下拉；`GET /api/branches` |
| 每日推送 PNG / webhook | ❌ | 未做 |
| Web Component / React 包 | ❌ | 尚未封装自定义元素 |
| 覆盖率驱动枯萎 | 部分 | 有 lcov 则接入；无则不误杀 |

**当前仓库结构（实际）**：

```
flora/
├── packages/
│   ├── core/          # 发现、结构腐化、规则、modules 地图、compare…
│   ├── render/        # Canvas 花园 + 物种剪影
│   └── cli/           # flora studio | analyze | timeline | compare
├── apps/
│   └── studio/
├── schemas/
│   └── garden-snapshot.schema.json
├── docs/
│   ├── README.md
│   ├── USER_GUIDE.md
│   ├── CONFIG.md
│   ├── CLI.md
│   └── TECHNICAL_DESIGN.md
└── examples/
    └── sample-monorepo/   # rules + modules + 循环 + py_wallet
```

---

## 1. 目标与定位

### 1.1 要解决什么

架构健康度长期被埋在指标、报告、diff 里。Flora 把它们翻译成**一套统一的视觉语法**（植物 / 藤蔓 / 污染），让团队每天扫一眼就能感知生态变化。

### 1.2 产品形态

**分析内核 + 渲染器 + 交付面**三层工具。

| 层级 | 形态 | 职责 |
|---|---|---|
| **Core** | `@flora/core` | 扫仓库 → `GardenSnapshot` / `GardenTimeline` |
| **Render** | `@flora/render` | Snapshot → Canvas 交互花园 |
| **Surface** | `@flora/cli` + Studio | 选路径、分析、时间轴回放、PR 双花园；（规划）CI Bot / 日报 |

对外承诺：**打开页面 → 选一个路径 → 开始构建。** 需要演化感时点「生成回放」；需要 PR 观感时点「对比双花园」。

```
┌─────────────────────────────────────────┐
│  Flora Studio                           │
│     [ 浏览文件夹… ]  或粘贴路径          │
│     聚合粒度 · 开始生长                  │
│     Base/Head · 对比双花园               │
│     分析摘要 / 模块列表 / 最近项目        │
└─────────────────────────────────────────┘
        ↓
   全景花园 + 诊断抽屉
   （对比模式：左右双画布）
        ↓
   时间轴：◀ 滑条 ▶  [回放]  [生成回放]
```

---

## 2. 核心原则

1. **位置稳定**：同一模块坐标尽量不变（布局缓存；回放共用当日布局）。
2. **颜色只有一套语义**：绿=健康，红/紫=违规，黄褐=枯萎，白/灰=死亡，花色=奖励。
3. **造型编码类型，颜色编码健康**：物种（松/柳/竹…）表示语言/文件类型，不占用颜色通道。
4. **情绪入口，理性出口**：默认全景；点植物才是指标与依赖。
5. **推送优先于交互**（产品原则；推送尚未实现）。
6. **反游戏化**：无分数、无排行榜。

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Studio │ CLI (analyze / timeline / compare / studio)       │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  @flora/render — Layout · Species · Vines · Diff highlights │
└────────────────────────────┬────────────────────────────────┘
                             │ GardenSnapshot / GardenTimeline / GardenDiff
┌────────────────────────────▼────────────────────────────────┐
│  @flora/core                                                │
│  Discover → Aliases → Adapters → Metrics → Rules            │
│           → Layout → Timeline → Compare (worktree)          │
└──────┬──────────┬──────────┬──────────┬─────────────────────┘
   JS/TS/Py/Go  Coverage   Git log   flora.rules.yaml
```

**人机主路径**：

```
选路径 → analyze（别名 + 多语言边 + 规则）→ Snapshot
      → 可选 buildTimeline（git 出生/活跃度切片）
      → 可选 compareRefs（worktree 分析 base ↔ head）
      → Studio 渲染 / 回放 / 双花园
```

---

## 4. 数据模型

### 4.1 `GardenSnapshot`

中间格式字段（实现以 `@flora/core` 类型为准）：

- `meta`：projectId / commit / branch / capturedAt / rootPath / strategy / notes
- `plants[]`：id、label、path、layer、**species**、**languages**、metrics、state、violations、dependsOn、dependedBy、cycleWith
- `vines[]`：from / to / weight / strength / kind(`normal|illegal|cycle`)
- `pollutions[]`：error 违规 epicenter
- `layout.positions`：稳定坐标（画布逻辑尺寸约 **1280×860**）
- `report`：摘要 KPI、循环组、热点（含结构腐化）、耦合 Top  
- plant `metrics` 可选：`instability` / `godModule` / `orphan` / `hotCore`  

### 4.1b `GardenDiff`（PR 对比）

由 `diffGardens` / `compareRefs` 产出：

- `base` / `head`：两侧 Snapshot（布局按 head 坐标对齐）  
- `summary` / `bullets`：人类可读摘要  
- `plantChanges` / `vineChanges`：模块与藤蔓差分  
- `worsenedIds` / `improvedIds` / `addedIds` / `removedIds`：高亮用 id 集合  
- `formatDiffComment(diff)` → Markdown 评论体  

### 4.2 `GardenTimeline`

```ts
interface GardenTimeline {
  projectId: string;
  range: { from: string; to: string }; // YYYY-MM-DD
  frames: Array<{
    date: string;
    snapshotRef: string; // .flora/history/YYYY-MM-DD.json
    delta?: FrameDelta;
  }>;
}

interface FrameDelta {
  wilted: string[];
  recovered: string[];
  newPollution: string[];
  bloomed: string[];
  newCycles: string[];
}
```

落盘：

```
.flora/
  snapshot.json          # 最新一帧
  timeline.json          # 索引
  layout-cache.json
  history/
    2026-09-01.json
    ...
```

### 4.3 植物健康状态（颜色）

| 状态 | 含义（默认规则） |
|---|---|
| healthy | 无严重违规，耦合正常 |
| blooming | 健康且近期 churn 高 |
| wilting | 覆盖率偏低等 |
| dying | 长期无覆盖 / 严重违规堆积 |
| entangled | 循环依赖或耦合过高 / 跨层 error |

### 4.4 植物物种（造型）

由模块内语言直方图 + 可选 layer 推导（`deriveSpecies`）：

| 物种 | 典型来源 |
|---|---|
| pine | TypeScript |
| oak | JavaScript |
| willow | Python |
| bamboo | Go |
| fir | Rust |
| maple | Java / Kotlin / C# |
| blossom | 前端/UI（tsx、css、vue… 或 ui 层） |
| fern | Markdown 文档为主 |
| cactus | 脚本/配置为主 |
| shrub | 混合 / 未知 |

`package.json` / `tsconfig*.json` 等配置噪声不参与物种统计。

---

## 5. Core：出树与规则

### 5.1 模块发现 + 多语言 Adapter

**模块发现顺序（auto）**：

1. 若存在 `flora.modules.yaml` → 可强制 granularity / merge / split / ignore  
2. npm / pnpm workspaces（包很多 → package；仅 1–2 包且有 features 目录 → 功能叙事）  
3. `src/features|modules|packages|domains` 或叙事向的 `src/*`  
4. 额外扫描并存的 Python / Go  
5. 否则一级目录；再否则整仓一株  

**依赖边精度**：

- 跳过 `import type` / `export type`  
- 识别动态 `import()`  
- 标记深入包内部的 deep import（非 index/入口）  
- tsconfig paths + workspace 包名  
- **workspace `package.json` 声明依赖**补成软边（前端配套库即使 import 漏解析也会连上）  

**结构腐化**（不只依赖）：上帝模块、孤儿、不稳定性 I、热点核心；污染沿藤蔓 BFS 扩散。

**规则加厚**：声明 layers 后自动补常见跨层禁令；`preferEntryOnly` / `when: entry-only` / `import:` 黑名单。

### 5.2 架构规则与模块地图

完整字段与示例见 **[CONFIG.md](./CONFIG.md)**。

**规则文件**（自动查找）：`flora.rules.yaml` / `.yml` / `.json` / `.flora/rules.yaml`。

行为摘要：

- `layers.paths` 覆盖启发式 layer  
- 声明 layers 后 **thickenRules** 补常见跨层禁令  
- `forbidden` 跨层 / `import:` / `when: entry-only|deep-import|cycle` → 违规藤或循环藤  
- 无配置文件时默认仅「禁止循环依赖」

**模块地图**：`flora.modules.yaml` — `granularity` / `ignore` / `merge` / `split`，在发现之后叠加。

**结构腐化与污染**（`structure.ts`）：

- 指标：`instability`、`godModule`、`orphan`、`hotCore`  
- error 违规与上帝模块为污染源，沿藤 BFS 扩散（距离 1–2 衰减）  

示例：`examples/sample-monorepo/flora.rules.yaml`、`flora.modules.yaml`。

### 5.3 时间轴与延时回放

**写入**：

- 每次 `analyze`（默认）`appendTimelineFrame` → 按日覆盖写入 history  
- `flora timeline` / `POST /api/timeline/build` → `buildTimeline`  

**`buildTimeline` 策略（无需 checkout 旧提交）**：

1. 以当前 analyze 为终态  
2. 用 git 取各模块「首次出现日期」  
3. 在 `[now-days, now]` 均匀取样 N 帧：过滤尚未出生的模块；按窗口内 commit 数调节 churn/枯萎；前期弱化循环藤的显现  
4. 写出 `timeline.json` + `history/*.json`  

**Studio**：

- 底部时间轴：日期滑条、上一帧/下一帧、回放（~850ms/帧）、生成回放  
- API：`GET /api/timeline?rootPath=`，`POST /api/timeline/build`

### 5.4 PR 双花园对比

**CLI / API**：

- `flora compare [path] --base <branch> --head <branch> [--comment]`  
- `GET /api/branches?rootPath=` → 下拉选项  
- `POST /api/compare` → `{ diff, comment, summary }`  

**流程**：

1. `listGitBranches` → Studio 下拉（本地 + remote；默认 base≈`main`、head≈当前分支）  
2. `analyzeAtRef(branch)`：分支 **tip commit** + 临时 worktree（非脏工作区）  
3. 布局按 head 对齐 → `diffGardens`  
4. 双画布高亮变差 / 新增 / 移除  

详见 [CLI.md](./CLI.md) 与 [USER_GUIDE.md](./USER_GUIDE.md)。

### 5.5 CLI

```bash
flora studio [--port 4173] [--no-open]
flora analyze [path] [-g auto|package|directory|file] [--rules file]
flora timeline [path] [-d 30] [-f 12] [-g auto]
flora compare [path] -b <base> -H <head> [-g auto] [--rules file] [--comment]
```

pnpm 包装：

```bash
pnpm studio
pnpm analyze:sample
pnpm build
pnpm --filter @flora/cli start compare <abs-path> -- --base main --head feature/x --comment
```

配置说明：[CONFIG.md](./CONFIG.md)。完整参数表：[CLI.md](./CLI.md)。

### 5.6 Studio 出树体验

- **页面内目录浏览**（盘符 → 进入 → 选择此文件夹）；原生系统对话框仅作降级  
- 零配置默认：workspaces / 目录聚合 + 循环规则 + 有则挂覆盖率  
- 结果：`.flora/snapshot.json` + 最近项目列表（`~/.flora/recent.json`）  
- 对比模式：侧栏 Base/Head → 双画布；退出后恢复单花园与时间轴  

---

## 6. Render

- 2D Canvas；分层带标签；选中/悬停高亮相关藤、淡化其余  
- 物种剪影 + 健康色；图例在画布左上（健康色一行 + 当前物种一行）  
- 对比模式：`highlightIds` 光晕、`badges` 角标、`title` 角标标题；双画布共用布局对齐  
- 「今日花园」状态栏与时间轴为舞台底部独立条，不叠在画布上  
- 诊断抽屉：健康度/覆盖率/耦合/活跃度、文件与扇入扇出、违规、依赖双向列表、物种与语言占比  

明确不做：全 3D、卡片 dashboard、积分游戏。

---

## 7. 交付面（规划 vs 已有）

| 交付 | 状态 |
|---|---|
| Studio 本地页 | ✅ |
| CLI analyze / timeline / compare | ✅ |
| 每日推送图 + webhook | 规划中 |
| PR Bot 双花园（评论体） | ✅ CLI `--comment`；Bot 集成规划中 |
| `<flora-garden>` / `@flora/react` | 规划中 |

---

## 8. 配置面

优先薄配置：**规则文件 + 可选模块地图**即可纠正分层与边界。完整 `flora.config.yaml` 仍为规划项；当前常用：

- `flora.rules.yaml` — 架构规则（见 [CONFIG.md](./CONFIG.md)）  
- `flora.modules.yaml` — 模块地图  
- CLI / Studio 参数 — granularity、rules 路径、timeline days/frames、compare 分支  

原则：**零配置能跑，配置只用于纠正分层、边界与禁令。**

---

## 9. 分阶段交付（更新）

### Phase 0 — 骨架 ✅

- Schema、目录发现、Studio 选路径、情绪视角、CLI analyze  

### Phase 1 — 真分析 + 真隐喻 ✅（主路径）

- JS/TS + 多语言 Adapter、循环检测、5 态 + 物种、污染、布局缓存、诊断 Drawer、规则引擎  
- 未完成：静态 PNG 导出流水线、覆盖率强依赖场景打磨  

### Phase 2 — 时间 ⏳ / 传播 ❌

- ✅ timeline 存储、拖拽、延时回放、帧差分（UI 摘要）  
- ❌ 日报 webhook  

### Phase 3 — 对比与生态 ⏳

- ✅ `flora compare` / Studio 双花园 / Markdown 评论体  
- ❌ CI 模板、Web Component 文档站；多语言 Adapter 可持续加深  

---

## 10. 关键技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 中间格式 | `GardenSnapshot` | 分析与渲染解耦 |
| 默认渲染 | 2D Canvas | 每日可读、可导出 |
| 布局 | 分层 + 力导 + 条件缓存 | 位置稳定 |
| 语言接入 | 进程内多 Adapter | 单包维护成本低于多 package |
| 时间轴 | git 元数据切片，不 checkout | 快、可在任意脏工作区跑 |
| PR 对比 | 临时 worktree + 布局对齐 | 真 ref 差分且不脏工作区 |
| 别名 | 读 tsconfig paths | 减少 monorepo 漏边 |
| 规则 | 自研 YAML 子集 | 无额外依赖，覆盖当前 schema |
| 选目录 | 页内 FS API 为主 | Windows 下原生对话框不可靠 |
| 门禁 | 默认关闭 | 避免 KPI 对抗 |

---

## 11. 成功标准（对照）

1. **可生成**：Studio 选根目录即可出花园 — ✅  
2. **可辨认**：布局缓存 / 回放共位 — ✅ 基本满足  
3. **可感知**：状态色 + 污染 + 循环藤 — ✅  
4. **可下钻**：诊断抽屉 — ✅  
5. **可传播**：回放 ✅；双花园评论体 ✅；日报图 ❌  

---

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| 大仓植物过多 | 默认 package/目录聚合；file 粒度需显式选择 |
| 依赖解析不准 | 多 Adapter + tsconfig paths + 忽略外部包；规则纠分层；后续可加 `modules.json` |
| 时间轴非真实 checkout | 文档标明「基于出生/活跃度的演化近似」；真对比用 compare / worktree |
| 隐喻过载 | 颜色只表健康；类型走造型 |
| 没人打开交互页 | 下一步做推送图 |
| Windows 相对路径易错 | 用户文档强调绝对路径；Studio 用页内浏览 |

---

## 13. 非目标

- 传统 dashboard 主界面  
- 全 3D 漫游  
- 积分 / 徽章 / 排行榜  
- 用颜色编码第三维度  
- 每天随机重摆模块  

---

## 14. 总结

Flora = **可插拔分析内核**（多语言 Adapter + 规则 + 时间轴）+ **隐喻渲染**（物种造型 × 健康色）+ **Studio/CLI 交付**。

已验证切口：选路径出树 → 结构/规则诊断 → 回放 → 分支 tip 双花园。  
本地文档入口：[docs/README.md](./README.md)（含 [CONFIG.md](./CONFIG.md)）。  
下一批优先：日报推送、CI Bot、merge-base PR 语义。
