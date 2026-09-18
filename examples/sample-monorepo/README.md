# sample-monorepo

供 Flora 自测的小示例：故意种下循环依赖、跨层违规，并混入一个 Python 包。

## 结构

```
sample-monorepo/
├── flora.rules.yaml          # 分层 + 加厚禁令 + entry-only
├── flora.modules.yaml        # 可选模块地图
├── package.json              # pnpm/npm workspaces
└── packages/
    ├── domain/               # 被 order/payment 依赖；规则上不应依赖上层
    ├── order/                # ↔ payment 故意循环
    ├── payment/
    ├── web/                  # UI 层（TS）
    └── py_wallet/            # Python（pyproject + billing/ledger）
```

预期分析大致结果：

- 约 **5** 株植物（4 个 JS workspace + 1 个 Python）  
- **循环藤**：order ↔ payment ↔ domain  
- **违规藤** + **污染扩散**；notes 含结构腐化 / 规则加厚  
- Adapter：`javascript` / `python`  

## 怎么跑

在 Flora 仓库根：

```bash
pnpm analyze:sample

# 绝对路径更稳妥
pnpm --filter @flora/cli start analyze G:/code/Flora/examples/sample-monorepo
```

Studio：`pnpm studio` → 浏览到本目录 → 可调叙事株数 → **开始生长**。

本目录若未单独 `git init`，时间轴 / compare 请对**有 git 的真实仓库**使用；仅测 analyze 时不必是 git 仓。
