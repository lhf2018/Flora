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
2. 选聚合粒度（默认 **自动**）：workspaces → 多语言包 → 一级目录  
3. 点 **开始生长**  
4. 左侧看分析摘要 / 热点 / 模块列表；画布上点植物打开诊断抽屉  

产物写在目标仓库的 `.flora/snapshot.json`。

### 2.2 时间轴回放

1. 底部点 **生成回放**（需该目录是 git 仓库；按出生/活跃度近似演化，**不会 checkout**）  
2. 拖滑条或点 **回放**  

无 git 时仍可分析当前树，但无法生成多帧时间轴。

### 2.3 PR 双花园对比

对比的是两个分支**各自最新 tip**（已提交树），不是工作区未提交改动。

1. 选择/生长项目后，侧栏会自动拉取分支列表  
2. 用下拉框选 **Base 分支** 与 **Head 分支**（默认多为 `main` → 当前分支）  
3. 点 **对比双花园** → 左右并排；变差/新增/移除会高亮  
4. **刷新分支** 可重新读取；**退出对比** 回到单花园  

CLI：`flora compare <path> --base main --head feature/x`

---

## 3. 怎么读这座花园

| 看见什么 | 含义 |
|---|---|
| 绿色植株 | 健康 |
| 粉色花点 / 花丛色 | 开花（健康且近期活跃） |
| 褐黄 | 枯萎（如覆盖率偏低） |
| 灰白缩小 | 濒死 |
| 根须缠绕 | 循环依赖或严重耦合 / 跨层 error |
| 紫色虚线藤 | 循环依赖 |
| 偏红违规藤 | 架构规则禁止的跨层依赖 |
| 地面暗斑 | 污染（严重违规 epicenter） |

点选一株后：相关藤加粗，其余淡出；抽屉里可看健康度、耦合、扇入扇出、违规与双向依赖。

---

## 4. CLI 常用命令

在仓库根执行（路径请用绝对路径，或先 `cd` 到目标仓）：

```bash
# Studio
pnpm studio

# 分析
pnpm --filter @flora/cli start analyze G:/code/my-app
pnpm --filter @flora/cli start analyze G:/code/my-app -- --rules flora.rules.yaml -g package

# 时间轴（需 git）
pnpm --filter @flora/cli start timeline G:/code/my-app -- --days 30 --frames 12

# PR 对比（需 git）
pnpm --filter @flora/cli start compare G:/code/my-app -- --base main --comment
```

完整参数见 [CLI.md](./CLI.md)。

---

## 5. 架构规则（可选）

在仓库根放 `flora.rules.yaml`（analyze 会自动加载）：

```yaml
layers:
  - name: domain
    paths: ["packages/domain/**"]
  - name: application
    paths: ["packages/order/**", "packages/payment/**"]
  - name: ui
    paths: ["packages/web/**"]

forbidden:
  - from: domain
    to: application
    message: "domain 不得依赖 application"
    severity: error
  - when: cycle
    message: "禁止循环依赖"
    severity: error
```

无配置文件时默认仍禁止循环依赖。完整说明见技术方案 §5.2。

---

## 6. 示例仓

`examples/sample-monorepo` 含：

- npm workspaces（domain / order / payment / web）  
- 故意的循环依赖与跨层违规  
- Python 包 `py_wallet`  
- `flora.rules.yaml`  

```bash
pnpm analyze:sample
# 或
pnpm --filter @flora/cli start analyze ../../examples/sample-monorepo
```

在 Studio 里浏览到 `…/Flora/examples/sample-monorepo` 点生长，应看到约 5 株植物、循环藤与违规藤。

更多说明见 [examples/sample-monorepo/README.md](../examples/sample-monorepo/README.md)。

---

## 7. 落盘目录

分析目标仓库下：

```
.flora/
  snapshot.json       # 最新花园
  timeline.json       # 时间轴索引（若生成）
  layout-cache.json   # 布局缓存（大图）
  history/            # 按日快照
```

本机「最近项目」列表在用户目录 `~/.flora/recent.json`（Windows：`%USERPROFILE%\.flora\recent.json`）。

---

## 8. 常见问题

**路径不对 / 只有 1 株植物**  
相对路径是相对 CLI 进程 cwd（`pnpm --filter` 时多为 `packages/cli`）。优先用绝对路径，或在 Studio 里用浏览选择。

**对比失败：无法解析 git ref**  
目标目录需是 git 仓库，且 Base ref 存在（试 `main`、`master`、`origin/main`）。

**依赖边偏少**  
外部 npm / 标准库引用会被忽略（避免假藤）。工作区内请用相对路径、workspace 包名或 `tsconfig` paths。

**时间轴不像真实历史**  
当前是「出生日期 + 活跃度」的近似演化，不是逐 commit checkout。真历史对比请用 **双花园 compare**。

**Studio 页面很简陋**  
先 `pnpm build`（至少构建 `@flora/studio`），再 `pnpm studio`。未构建时 CLI 会提供降级页。
