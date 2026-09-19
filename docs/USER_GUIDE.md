# Flora 用户指南

把任意代码库长成一座架构花园：模块是植物，依赖是藤蔓，违规会污染土地。

- **造型** = 语言 / 文件类型（松=TS、橡=JS、柳=Python、枫=Java、花=前端）  
- **颜色** = 健康（绿健康 · 花色开花 · 褐枯萎 · 灰濒死 · 深色缠绕）

---

## 1. 安装与构建

需要 Node.js ≥ 20、pnpm 9。

```bash
pnpm install
pnpm build          # core / render / cli / studio
pnpm studio         # http://127.0.0.1:4173
```

日常「选路径出树」用 `pnpm studio` 即可。改前端时可另开：

```bash
pnpm --filter @flora/core build && pnpm --filter @flora/render build
pnpm dev:studio     # Vite 热更新；分析 API 仍需 `pnpm studio`
```

---

## 2. Studio 工作流

### 2.1 长出今日花园

1. **浏览文件夹…** 选仓库根（或粘贴绝对路径）  
2. 上方填路径（或点「浏览」）→ **开始生长**。默认「自动」切法；点顶栏 **显示** 可改「一株代表什么 / 大约几棵」。  
3. 生长后左侧出现 **摘要**（可收起）；点株打开诊断抽屉 → **下钻此株**  
4. 可选：底部 **生成回放**；顶栏 **对比** 选分支 → 双花园

产物：目标仓 `.flora/snapshot.json`。notes 会写规则、地图、污染、结构腐化、叙事目标等。

### 2.2 时间轴回放

1. **生成回放**（需 git）：优先按近期提交做 **worktree 真实分析**；失败则回退「出生/活跃度近似」  
2. 拖滑条或 **回放**  
3. 只要更快、不 checkout：CLI 加 `--approx`

### 2.3 PR 双花园

对比两分支**各自 tip**（已提交树），不是工作区脏改动。

1. 生长项目后侧栏自动拉分支  
2. 选 **Base** / **Head** → **对比双花园**（变差/新增/移除会高亮）  
3. **刷新分支** / **退出对比**

```bash
pnpm --filter @flora/cli start compare G:/code/my-app -- --base main --head feature/x --comment
```

---

## 3. 怎么读这座花园

| 看见什么 | 含义 |
|---|---|
| 绿色植株 | 健康 |
| 粉色花点 | 开花（健康且近期活跃） |
| 褐黄 | 枯萎（覆盖率低、孤儿、热点等） |
| 灰白缩小 | 濒死（严重违规等） |
| 根须缠绕 | 循环、过高耦合、上帝模块 / 不稳定 |
| 紫色虚线藤 | 循环依赖 |
| 青绿点线藤 | HTTP/API 契约（fetch / Spring / FastAPI 等，跨语言） |
| 偏红违规藤 | 跨层 / entry-only / import 黑名单 |
| 地面暗斑 | 污染源及沿藤扩散的次生污染 |
| 植株旁小三角 | 健康趋势下滑（相对近期快照） |
| 「其余 · N」 / 「名 · 名 +N」 | 叙事折叠：同级模块合成一株，不会整园收成一棵 `src` |

点选一株：相关藤加粗。抽屉含健康 / **趋势** / 覆盖 / 耦合 / 活跃、扇入出、**不稳定性 I**、结构标记、违规与双向依赖（HTTP 边会标 HTTP）。左侧「问题热点」优先列上帝模块、孤儿、缠绕、枯萎与健康下滑。

---

## 4. CLI 常用命令

路径请用**绝对路径**（`pnpm --filter` 时 cwd 多为 `packages/cli`）：

```bash
pnpm studio

pnpm --filter @flora/cli start analyze G:/code/my-app -- --target 12
pnpm --filter @flora/cli start analyze G:/code/my-app -- --rules flora.rules.yaml -g package

pnpm --filter @flora/cli start timeline G:/code/my-app -- --days 30 --frames 8
pnpm --filter @flora/cli start timeline G:/code/my-app -- --approx

pnpm --filter @flora/cli start compare G:/code/my-app -- --base main --head feature/x --comment
```

完整参数见 [CLI.md](./CLI.md)。

---

## 5. 配置（可选）

| 文件 | 作用 |
|---|---|
| `flora.rules.yaml` | 分层、禁止边、入口约束、import 黑名单；声明 layers 会**自动加厚** |
| `flora.modules.yaml` | 合并 / 拆分 / 忽略，或强制粒度 |

语法见 [CONFIG.md](./CONFIG.md)。「大约几棵」用 Studio 滑杆或 CLI `--target`，不写在 yaml 里。

---

## 6. 示例仓

`examples/sample-monorepo`：workspaces、故意循环、跨层规则、Python、模块地图、前端 `fetch` ↔ 订单路由 / Python wallet。

```bash
pnpm analyze:sample
```

预期约 5 株、循环藤、违规藤、污染扩散。详见 [示例说明](../examples/sample-monorepo/README.md)。

---

## 7. 落盘目录

目标仓库：

```
.flora/
  snapshot.json
  timeline.json
  layout-cache.json
  history/
```

本机最近项目：`~/.flora/recent.json`（Windows：`%USERPROFILE%\.flora\recent.json`）。

---

## 8. 常见问题

**路径不对 / 植株过少**  
用绝对路径或 Studio 浏览。切法选「自动」，把「大约几棵」调高，或点株下钻。

**满园都是 Java，或完全看不到 Java**  
用 **自动**，不要用「按源文件」。文件切法若扫进全部 `.java`，枫树会盖住前端；自动会同时留下 Maven 模块和静态前端。下钻某一模块才进入 Java 包。若仍只有一种语言，先确认不是「按源文件」，再重新「开始生长」（旧快照不会自己变）。

**植株过多 / 图面挤**  
把「大约几棵」调低；或改成「按软件包」；或用 `flora.modules.yaml` merge。

**对比失败**  
需为 git 仓；选两个不同分支；可「刷新分支」。

**依赖边偏少**  
外部包与 `import type` 不计。workspace 会用 `package.json` 补软边。仍缺则检查相对路径 / 包名 / tsconfig paths。

**边界不对**  
`flora.modules.yaml` 的 merge/split/ignore，或改「一株代表什么」、点株下钻。

**时间轴很慢**  
真实提交切片要多次 worktree 分析。可 `--approx` 或减少 `--frames`。

**Studio 空白 / 很旧**  
`pnpm build` 后再 `pnpm studio`。
