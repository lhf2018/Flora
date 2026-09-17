# Flora 用户指南

把任意代码库长成一座架构花园：模块是植物，依赖是藤蔓，违规会污染土地。

- **造型** = 语言 / 文件类型（松=TS、柳=Python…）  
- **颜色** = 健康（绿健康 · 花色开花 · 褐枯萎 · 灰濒死 · 深色缠绕）

---

## 1. 安装与构建

需要 Node.js ≥ 20、pnpm 9。

```bash
pnpm install
pnpm build          # 构建 core / render / cli / studio
pnpm studio         # 打开 Studio（默认 http://127.0.0.1:4173）
```

开发 Studio 前端时可另开：

```bash
pnpm --filter @flora/core build
pnpm --filter @flora/render build
pnpm dev:studio     # Vite 热更新；分析 API 仍需 `pnpm studio` 或自接代理
```

日常「选路径出树」用 `pnpm studio` 即可（CLI 会托管已构建的 Studio 静态资源）。

---

## 2. Studio 工作流

### 2.1 长出今日花园

1. 点 **浏览文件夹…**，进入目标仓库根目录后点 **选择此文件夹**（也可粘贴绝对路径）  
2. 选聚合粒度（默认 **自动**：workspaces / 功能目录叙事 / 一级目录；可被 `flora.modules.yaml` 覆盖）  
3. 点 **开始生长**  
4. 左侧看分析摘要 / 热点 / 模块列表；画布上点植物打开诊断抽屉  

产物写在目标仓库的 `.flora/snapshot.json`。notes 里会列出规则、模块地图、污染扩散、结构腐化等。

### 2.2 时间轴回放

1. 底部点 **生成回放**（需该目录是 git 仓库；按出生/活跃度近似演化，**不会 checkout**）  
2. 拖滑条或点 **回放**  

无 git 时仍可分析当前树，但无法生成多帧时间轴。

### 2.3 PR 双花园对比

对比的是两个分支**各自最新 tip**（已提交树），不是工作区未提交改动。

1. 选择/生长项目后，侧栏会自动拉取分支列表  
2. 用下拉框选 **Base 分支** 与 **Head 分支**（默认多为 `main` → 当前分支）  
3. 点 **对比双花园** → 左右并排铺满舞台；变差/新增/移除会高亮  
4. **刷新分支** 可重新读取；**退出对比** 回到单花园  

CLI：

```bash
pnpm --filter @flora/cli start compare G:/code/my-app -- --base main --head feature/x --comment
```

---

## 3. 怎么读这座花园

| 看见什么 | 含义 |
|---|---|
| 绿色植株 | 健康 |
| 粉色花点 / 花丛色 | 开花（健康且近期活跃） |
| 褐黄 | 枯萎（覆盖率偏低、孤儿、热点核心等） |
| 灰白缩小 | 濒死（严重违规等） |
| 根须缠绕 | 循环、过高耦合、上帝模块/不稳定依赖 |
| 紫色虚线藤 | 循环依赖 |
| 偏红违规藤 | 跨层 / entry-only / import 黑名单等 |
| 地面暗斑 | 污染源及**沿藤扩散**的次生污染 |

点选一株后：相关藤加粗，其余淡出。抽屉里可看：

- 健康度 / 覆盖率 / 耦合 / 活跃度  
- 扇入扇出、文件与行数  
- **不稳定性 I**、上帝模块 / 孤儿 / 热点核心标记  
- 违规列表与双向依赖  

左侧「问题热点」会优先列出上帝模块、孤儿、缠绕与枯萎。

---

## 4. CLI 常用命令

路径请用**绝对路径**（`pnpm --filter` 时 cwd 多为 `packages/cli`）：

```bash
pnpm studio

pnpm --filter @flora/cli start analyze G:/code/my-app
pnpm --filter @flora/cli start analyze G:/code/my-app -- --rules flora.rules.yaml -g package

pnpm --filter @flora/cli start timeline G:/code/my-app -- --days 30 --frames 12

pnpm --filter @flora/cli start compare G:/code/my-app -- --base main --head feature/x --comment
```

完整参数见 [CLI.md](./CLI.md)。

---

## 5. 配置（可选）

| 文件 | 作用 |
|---|---|
| `flora.rules.yaml` | 分层、禁止边、入口约束、import 黑名单；声明 layers 会**自动加厚** |
| `flora.modules.yaml` | 合并 / 拆分 / 忽略模块，或强制粒度 |

完整语法与示例见 [CONFIG.md](./CONFIG.md)。

---

## 6. 示例仓

`examples/sample-monorepo` 含 workspaces、故意循环、跨层规则、Python 包、模块地图。

```bash
pnpm analyze:sample
```

预期约 5 株、循环藤、违规藤、污染扩散；notes 含规则加厚 / 结构腐化。详见 [示例说明](../examples/sample-monorepo/README.md)。

---

## 7. 落盘目录

分析目标仓库下：

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

**路径不对 / 只有 1 株**  
用绝对路径，或 Studio 内浏览选择。

**对比失败**  
目录需是 git 仓库；下拉框选两个不同分支。可用「刷新分支」。

**依赖边偏少**  
外部 npm / 标准库会忽略；`import type` 不计入耦合。workspace 内会用 `package.json` 声明依赖补软边。仍缺边时检查是否用了相对路径、workspace 包名或 tsconfig paths。

**植株边界不对**  
写 `flora.modules.yaml` 做 merge/split/ignore，或改 Studio 粒度。

**时间轴不像真历史**  
当前是出生/活跃度近似；真分支对比用双花园。

**Studio 很简陋**  
先 `pnpm build`，再 `pnpm studio`。
