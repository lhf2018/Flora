# Flora 技术方案

> **一句话**：Flora 是一套「代码库 → 花园全景」的可复用工具链。对任意仓库选路径或跑一条命令，就能得到一张位置稳定、状态会变的活地图；向下可诊断，沿时间可回放。

---

## 0. 实现状态（与代码同步）

| 能力 | 状态 | 说明 |
|---|---|---|
| Studio 选路径出树 | ✅ | 页面内目录浏览 + `POST /api/analyze` |
| 情绪全景 + 诊断抽屉 | ✅ | Canvas 渲染；报告摘要 / 模块列表 / 依赖下钻 |
| 物种造型（按语言） | ✅ | 造型=语言，颜色=健康；见 §4.4 |
| JS/TS Adapter | ✅ | import/require + workspace 包名 |
| Python / Go / JVM Adapter | ✅ | 见 §5.1；与 npm monorepo 可并存 |
| 架构规则引擎 | ✅ | `flora.rules.yaml` 分层 + 禁止边 + 循环 |
| 时间轴存储 | ✅ | `.flora/history/*.json` + `timeline.json` |
| 延时回放 UI | ✅ | Studio 底部滑条 / 生成回放 / 播放 |
| 布局缓存 | ✅ | 小图新鲜布局，大图读缓存 |
| tsconfig paths 别名 | ✅ | `@/` 等解析到工作区内模块 |
| PR 双花园对比 | ✅ | `flora compare` + Studio 左右并排；worktree 分析 base |
| 每日推送 PNG / webhook | ❌ | 未做 |
| Web Component / React 包 | ❌ | 渲染在 `@flora/render`，尚未封装自定义元素 |
| 覆盖率驱动枯萎 | 部分 | 有 lcov 则接入；无则不误杀 |

**当前仓库结构（实际）**：

```
flora/
├── packages/
│   ├── core/          # 发现、多语言 Adapter、规则、时间轴、compare、analyze
│   ├── render/        # Canvas 花园 + 物种剪影
│   └── cli/           # flora studio | analyze | timeline | compare
├── apps/
│   └── studio/        # Studio 前端（构建产物由 CLI 托管）
├── schemas/
│   └── garden-snapshot.schema.json
├── docs/
│   ├── README.md              # 文档索引
│   ├── USER_GUIDE.md          # 用户指南
│   ├── CLI.md                 # CLI / HTTP API
│   └── TECHNICAL_DESIGN.md
└── examples/
    └── sample-monorepo/   # JS 循环依赖 + flora.rules.yaml + py_wallet
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
- `report`：摘要 KPI、循环组、热点、耦合 Top

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

1. npm / pnpm workspaces  
2. 额外扫描并存的 Python 包（`pyproject.toml` / `__init__.py`）与 Go module  
3. 否则一级目录；再否则整仓一株  

**依赖边 Adapter**（按扩展名分发，可并存）：

| Adapter | 扩展名 | 提取方式 |
|---|---|---|
| javascript | `.ts/.tsx/.js/...` | import / export from / require；workspace 包名；**tsconfig paths** |
| python | `.py` | `import` / `from ... import`；相对包解析 |
| go | `.go` | `import "..."`, import 块 |
| jvm | `.java/.kt` | `import a.b.c` |

实现位置：`packages/core/src/adapters.ts` + `aliases.ts`，由 `discover.ts` 统一走文件并汇总边。  
`node:` 内置模块与明显外部包引用会被跳过，并在 notes 中统计「外部依赖引用」。

### 5.2 架构规则引擎

配置文件（自动查找）：`flora.rules.yaml` / `.yml` / `.json` / `.flora/rules.yaml`。

```yaml
layers:
  - name: domain
    paths:
      - packages/domain/**
  - name: application
    paths:
      - packages/order/**
      - packages/payment/**
  - name: ui
    paths:
      - packages/web/**

forbidden:
  - from: domain
    to: application
    message: "domain 不得依赖 application 层"
    severity: error
  - when: cycle
    message: "禁止循环依赖"
    severity: error
```

行为：

- `layers.paths` 覆盖启发式 layer  
- `forbidden` 跨层边 → `vine.kind = illegal`，植物挂 violation  
- `when: cycle` → 循环边保持 `cycle`，参与植株记违规  
- 无配置文件时默认仅启用「禁止循环依赖」

示例：`examples/sample-monorepo/flora.rules.yaml`。

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

- `flora compare [path] --base <ref> [--head HEAD] [--comment]`  
- `POST /api/compare` → `{ diff, comment, summary }`  

**流程**：

1. `listGitBranches` → Studio 下拉框（本地 + remote，默认 base=`main`、head=当前分支）  
2. `analyzeAtRef(branch)`：解析分支 tip commit，`git worktree add --detach` 后分析（**不是**工作区脏树；仅 `.` / `WORKTREE` 才分析脏工作区）  
3. 将 base 中与 head 共有的 plant id 坐标对齐到 head  
4. `diffGardens` 产出变差/好转/增删与藤蔓变化  
5. Studio 左右双 `GardenRenderer`，`highlightIds` + 角标  

详见 [CLI.md](./CLI.md) 与 [USER_GUIDE.md](./USER_GUIDE.md)。

### 5.5 CLI

```bash
flora studio [--port 4173] [--no-open]
flora analyze [path] [-g auto|package|directory|file] [--rules file]
flora timeline [path] [-d 30] [-f 12] [-g auto]
flora compare [path] -b <base> [-H HEAD] [-g auto] [--rules file] [--comment]
```

pnpm 包装：

```bash
pnpm studio
pnpm analyze:sample
pnpm build
pnpm --filter @flora/cli start compare <abs-path> -- --base main --comment
```

完整参数表：[CLI.md](./CLI.md)。

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

优先薄配置：**规则文件**即可纠正分层。完整 `flora.config.yaml` 仍为规划项；当前常用：

- `flora.rules.yaml` — 架构规则  
- 环境/CLI 参数 — granularity、rules 路径、timeline days/frames  

原则：**零配置能跑，配置只用于纠正分层与规则。**

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

已验证切口：`flora studio` 选路径出树 → 诊断 → 生成回放看生长 → PR 双花园对比。  
本地文档入口：[docs/README.md](./README.md)。  
下一批优先：日报静态图推送、CI Bot 挂评论、规则/解析加深。
