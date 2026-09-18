# 配置参考

Flora 零配置即可出树；配置只用于**纠正分层、模块边界与禁令**。

自动查找（仓库根，除非 CLI/API 显式指定）：

| 文件 | 作用 |
|---|---|
| `flora.rules.yaml`（或 `.yml` / `.json` / `.flora/rules.yaml`） | 分层 + 禁止边 + 入口约束 |
| `flora.modules.yaml`（或 `.yml` / `.json` / `.flora/modules.yaml`） | 模块地图：合并 / 拆分 / 忽略 / 强制粒度 |

示例见 `examples/sample-monorepo/`。

---

## 1. `flora.rules.yaml`

### 1.1 字段

```yaml
layers:
  - name: domain          # 层名，供 forbidden 引用
    paths:
      - packages/domain/**

preferEntryOnly: true     # 有 layers 时默认倾向禁止跨包 deep import

forbidden:
  - from: domain          # 层名 / 模块 id·label / 路径 glob / "*"
    to: application
    message: "…"
    severity: error       # error | warn

  - when: cycle           # 循环依赖
    message: "禁止循环依赖"
    severity: error

  - when: entry-only      # 或 deep-import：跨模块非公开入口
    message: "跨包须经公开入口"
    severity: warn

  - import:               # 禁止的 import 规格（子串或 glob）
      - "**/internal/**"
      - "**/private/**"
    message: "禁止引用 internal"
    severity: error
    from: "*"             # 可选：限制触发方
```

### 1.2 规则加厚

只要声明了 `layers`，分析时会**自动补全**尚未写出的常见禁令（若不存在同名 from→to）：

- `domain → application / ui / infra`
- `application → ui`
- `ui → infra`

若 `preferEntryOnly` 不为 `false` 且已有 layers，且未手写 `when: entry-only|deep-import`，会自动加入入口约束（默认 warn）。

无配置文件时：仅默认「禁止循环依赖」。

### 1.3 公开入口判定

跨模块引用若落到目标包的非入口文件，记为 **deep import**，可触发 `entry-only`：

- 包根下的 `index.*` / `main.*` / `__init__.py` 等  
- 或 `src/index.*`、`lib/index.*`  

经 workspace 包名再深入子路径（如 `@scope/pkg/src/foo`）也会标 deep。

### 1.4 完整示例

```yaml
layers:
  - name: domain
    paths: ["packages/domain/**"]
  - name: application
    paths: ["packages/order/**", "packages/payment/**"]
  - name: ui
    paths: ["packages/web/**"]

preferEntryOnly: true

forbidden:
  - from: domain
    to: application
    message: "domain 不得依赖 application 层"
    severity: error
  - from: ui
    to: domain
    message: "ui 应经 application 访问 domain"
    severity: warn
  - when: entry-only
    message: "跨包须经公开入口，禁止深入 src 内部"
    severity: warn
  - when: cycle
    message: "禁止循环依赖"
    severity: error
  - import:
      - "**/internal/**"
    message: "禁止引用 internal 路径"
    severity: error
```

---

## 2. `flora.modules.yaml`

用于纠正自动发现的模块边界（可纠错模块地图）。

### 2.1 字段

```yaml
# 覆盖 Studio/CLI 的 auto 粒度
granularity: package   # auto | package | directory | file

ignore:
  - packages/legacy/**
  - tools/**

merge:
  - id: wallet
    label: wallet
    layer: application
    paths:
      - packages/py_wallet/**
      - packages/billing/**

split:
  - path: packages/web   # 相对仓库根；拆成直接子目录各一株
    depth: 1
    layer: ui

aliases:                 # 预留：路径别名提示（与 tsconfig paths 互补）
  "@app": packages/web
```

### 2.2 行为顺序

1. 按粒度 / auto 叙事策略得到初始模块列表  
2. `ignore` 去掉匹配项  
3. `split` 拆开过大目录  
4. `merge` 把匹配 paths 的多株合成一株  

分析 notes 会写明「模块地图: …」及合并/拆分条数。

---

## 3. 分析语义速查（与配置相关）

| 信号 | 来源 | 花园表现 |
|---|---|---|
| 跨层 / import 黑名单 / entry-only | rules | 违规藤 + violation |
| 循环 | rules `when: cycle` + 图算法 | 寄生藤 + 缠绕 |
| 上帝模块 / 孤儿 / 不稳定 / 热点 | 结构启发式 | warn + 热点；应用根/前端页**不算**孤儿 |
| 污染扩散 | error 违规与上帝模块为源 | 沿藤 BFS 衰减暗斑 |
| 模块边界 | modules 地图 + auto 叙事 + 目标株数 | 植株数量与标签 |

**叙事株数**（Studio 滑杆 / CLI `--target` / API `targetPlants`）：不属于 yaml。只在 **auto** 发现之后生效：过少则下钻，过多则把同级目录收成簇。簇名用成员名（如 `cycles · state +8`），不会叫 `src`。`ui` 层植株在兜底折叠时优先保留。Maven 多模块、Java 包、静态前端也由发现逻辑决定，不写在这份 yaml 里。

**孤儿判定**（刻意保守，减少误报）：

- 图上无入边且无出边，**且**未被任何 workspace `package.json` 声明依赖  
- 且不像 app/ui/platform 入口，**也不像** viz/graph/shared/sdk 等前端配套库  
- 且体量小、不活跃  

`aurora-graph-viz` 这类服务前端的包：名称命中共享库启发式，或被前端 `package.json` 依赖声明，都不会再标孤儿。分析还会把 **workspace package.json 依赖**补成软边，让「服务前端」在花园里看得见。
