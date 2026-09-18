# Flora 文档

按用途选读：

| 文档 | 适合谁 | 内容 |
|---|---|---|
| [用户指南](./USER_GUIDE.md) | 日常使用 | Studio / CLI、读图、下钻、FAQ |
| [配置参考](./CONFIG.md) | 调边界 / 分层 | `flora.rules.yaml` · `flora.modules.yaml` |
| [CLI 与 API](./CLI.md) | 脚本 / 集成 | 命令参数、HTTP API、库导出 |
| [技术方案](./TECHNICAL_DESIGN.md) | 开发者 | 架构、数据模型、实现状态 |
| [示例仓](../examples/sample-monorepo/README.md) | 自测 | sample-monorepo 预期 |

仓库根 [README.md](../README.md) 是最短入口。

### 近期能力（文档已覆盖）

- **叙事株数**：自动粒度下控制约 4–24 株；过多按父目录成簇，标签用成员名，不叫 `src`  
- **点株下钻**：子路径再分析 + 面包屑返回；Java 会跳过 `src/main/java` 单层包前缀  
- **混合仓库**：Maven 模块与 `resources/static` 前端同时成株；文件粒度按语言均衡采样  
- **时间轴**：优先 git 提交 worktree；有提交缓存与进度轮询，失败回退近似  
