# Flora

把代码库长成一座**会随时间变化的架构花园**：模块是植物，依赖是藤蔓，违规会污染土地。

造型表示**语言/类型**，颜色表示**健康**。

## 快速开始

```bash
pnpm install
pnpm build
pnpm studio
```

浏览器打开 http://127.0.0.1:4173 ：

1. **浏览文件夹…** → **开始生长**（可调「叙事株数」）  
2. 点株 → 诊断抽屉 → **下钻此株**  
3. 可选：底部 **生成回放**；侧栏选分支 → **对比双花园**（需 git）

```bash
pnpm analyze:sample
```

## 文档

| 文档 | 说明 |
|---|---|
| [用户指南](./docs/USER_GUIDE.md) | 用法、读图、FAQ |
| [配置参考](./docs/CONFIG.md) | rules / modules 地图 |
| [CLI 与 API](./docs/CLI.md) | 命令与 HTTP API |
| [技术方案](./docs/TECHNICAL_DESIGN.md) | 架构与实现状态 |
| [示例仓](./examples/sample-monorepo/README.md) | sample-monorepo |

索引：[docs/README.md](./docs/README.md)

## 命令速查

```bash
pnpm studio
pnpm analyze:sample

# 路径请用绝对路径（pnpm --filter 的 cwd 在 packages/cli）
pnpm --filter @flora/cli start analyze <abs> -- -g auto --target 12
pnpm --filter @flora/cli start timeline <abs> -- --days 30 --frames 8
pnpm --filter @flora/cli start timeline <abs> -- --approx          # 强制近似、更快
pnpm --filter @flora/cli start compare <abs> -- --base main --head feature/x --comment
```

## 能力摘要

| 能力 | 说明 |
|---|---|
| 叙事粒度 | 自动下钻 / 扁平成株 / **目标株数**折叠（标签用成员名，不叫 `src`） |
| 多语言仓 | Maven 模块 + Java 包下钻；静态前端单独成株；文件采样按语言均衡 |
| 点株下钻 | 子目录再生长，面包屑返回 |
| 结构腐化 | 上帝模块、孤儿（保守）、不稳定性 I、热点核心 |
| 污染扩散 | 严重违规沿藤 BFS 衰减 |
| 规则 | layers 自动加厚；entry-only / import 黑名单 |
| 模块地图 | merge / split / ignore |
| 图边 | 跳过 type-only；dynamic / deep / paths；**package.json 软边** |
| 时间轴 | **提交切片优先**，近似回退 |
| PR 双花园 | 两分支 tip 对比（Studio 下拉） |

配置细节见 [docs/CONFIG.md](./docs/CONFIG.md)。

## 包结构

| 包 | 作用 |
|---|---|
| `@flora/core` | 发现、结构、规则、叙事、时间轴、对比 |
| `@flora/render` | Canvas 花园 |
| `@flora/cli` | `studio` / `analyze` / `timeline` / `compare` |
| `@flora/studio` | Studio 前端 |

## 开发

```bash
pnpm build
pnpm typecheck
```
