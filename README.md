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

1. **浏览文件夹…** 或粘贴路径 → **开始生长**  
2. 可选：底部 **生成回放**；侧栏下拉选分支 → **对比双花园**（需 git）

```bash
pnpm analyze:sample
```

## 文档

| 文档 | 说明 |
|---|---|
| [用户指南](./docs/USER_GUIDE.md) | 用法、读法、FAQ |
| [配置参考](./docs/CONFIG.md) | rules / modules 地图 |
| [CLI 与 API](./docs/CLI.md) | 命令与 HTTP API |
| [技术方案](./docs/TECHNICAL_DESIGN.md) | 架构与实现状态 |
| [示例仓](./examples/sample-monorepo/README.md) | sample-monorepo |

索引：[docs/README.md](./docs/README.md)

## 命令速查

```bash
pnpm studio
pnpm analyze:sample

pnpm --filter @flora/cli start analyze <abs-path> [-- --rules flora.rules.yaml -g package]
pnpm --filter @flora/cli start timeline <abs-path> -- --days 30 --frames 12
pnpm --filter @flora/cli start compare <abs-path> -- --base main --head feature/x [--comment]
```

路径请用**绝对路径**（`pnpm --filter` 的 cwd 在 `packages/cli`）。

## 能力摘要

- **结构腐化**：上帝模块、孤儿、不稳定性 I、热点核心（不只依赖耦合）  
- **污染扩散**：严重违规沿藤蔓 BFS 衰减  
- **规则加厚**：`flora.rules.yaml` 声明 layers 后自动补常见跨层禁令；`entry-only` / `import:`  
- **模块地图**：`flora.modules.yaml` 合并 / 拆分 / 忽略  
- **图边精度**：跳过 type-only、动态 import、deep import、tsconfig paths；**workspace package.json 软边**补漏  
- **孤儿判定（保守）**：排除 app/前端入口、viz/shared 库，并认 package.json 声明依赖  
- **PR 双花园**：两分支 tip 对比（Studio 下拉框）  

配置示例与字段说明见 [docs/CONFIG.md](./docs/CONFIG.md)。

## 包结构

| 包 | 作用 |
|---|---|
| `@flora/core` | 发现、结构腐化、规则、时间轴、对比 |
| `@flora/render` | Canvas 花园 |
| `@flora/cli` | `studio` / `analyze` / `timeline` / `compare` |
| `@flora/studio` | Studio 前端 |

## 开发

```bash
pnpm build
pnpm typecheck
```
