# Flora

把代码库长成一座**会随时间变化的架构花园**：模块是植物，依赖是藤蔓，违规会污染土地。

造型表示**语言/类型**，颜色表示**健康**。

## 快速开始

```bash
pnpm install
pnpm build
pnpm studio
```

浏览器打开后：

1. **浏览文件夹…**（页面内选目录）或粘贴路径  
2. **开始生长**  
3. 可选：底部 **生成回放** → **回放**；侧栏 **对比双花园**（需 git）

示例仓（循环依赖 + 架构规则 + Python）：

```bash
pnpm analyze:sample
```

## 文档

| 文档 | 说明 |
|---|---|
| [用户指南](./docs/USER_GUIDE.md) | Studio / CLI 用法、读法、FAQ |
| [CLI 与 API](./docs/CLI.md) | 命令参数、HTTP API、库导出 |
| [技术方案](./docs/TECHNICAL_DESIGN.md) | 架构、模型、规则、实现状态 |
| [示例仓说明](./examples/sample-monorepo/README.md) | sample-monorepo 结构与预期 |

文档索引：[docs/README.md](./docs/README.md)

## 命令速查

```bash
pnpm studio
pnpm analyze -- <path>                    # 需在 filter 下传参时见下
pnpm analyze:sample

pnpm --filter @flora/cli start analyze <abs-path> [-- --rules flora.rules.yaml -g package]
pnpm --filter @flora/cli start timeline <abs-path> -- --days 30 --frames 12
pnpm --filter @flora/cli start compare <abs-path> -- --base main [--head HEAD] [--comment]
```

路径建议用**绝对路径**（`pnpm --filter` 的 cwd 在 `packages/cli`）。

## PR 双花园

对比两个分支的最新 tip（下拉选择；非工作区脏改动）：

```bash
pnpm --filter @flora/cli start compare <abs-path> -- --base main --head feature/x --comment
```

Studio：选路径后从下拉框选 Base / Head → **对比双花园**。

## 架构规则

仓库根放置 `flora.rules.yaml`（analyze 自动加载）：

```yaml
layers:
  - name: domain
    paths: ["packages/domain/**"]
  - name: application
    paths: ["packages/order/**", "packages/payment/**"]

forbidden:
  - from: domain
    to: application
    message: "domain 不得依赖 application"
    severity: error
  - when: cycle
    message: "禁止循环依赖"
```

跨层边 → 违规藤（illegal）；循环 → 寄生藤（cycle）。

## 多语言

| 语言 | 模块发现 | 依赖边 |
|---|---|---|
| JS/TS | npm/pnpm workspaces | import / require / 包名 / tsconfig paths |
| Python | `pyproject.toml` / `__init__.py` | import / from |
| Go | `go.mod` | import |
| JVM | 目录启发式 | import |

外部 npm / 标准库引用会忽略，避免假藤蔓。物种表见技术方案 §4.4。

## 时间轴

- `analyze` 追加 `.flora/history/YYYY-MM-DD.json`  
- `flora timeline`：按 git 出生/活跃度近似演化（不 checkout）  
- Studio：滑条 + 延时回放  

## 包结构

| 包 | 作用 |
|---|---|
| `@flora/core` | 发现、Adapter、规则、时间轴、对比、Snapshot |
| `@flora/render` | Canvas 花园（含对比高亮） |
| `@flora/cli` | `studio` / `analyze` / `timeline` / `compare` |
| `@flora/studio` | Studio 前端 |

## 开发

```bash
pnpm build
pnpm typecheck
pnpm --filter @flora/core build && pnpm --filter @flora/render build && pnpm dev:studio
```
