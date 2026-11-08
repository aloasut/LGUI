# Plan Tree

LGUI 仓库的规划入口。职责分工：

| 权威 | 管什么 |
|---|---|
| [llmdoc/](../../llmdoc/) | 架构知识（检索用 `npx -y @tokenroll/llmdoc search/tree/context`） |
| [CONTRIBUTING.md](../../CONTRIBUTING.md)、[AGENTS.md](../../AGENTS.md) | 贡献流程与仓库约定 |
| 本目录 | 规划状态：路线、决策、未决问题、落地证据 |

## Baseline

架构与模块事实不在这里复制，见 [baseline/README.md](baseline/README.md)。

## 活跃计划

| ID | Plan | Affected Modules | Status | Current Phase | Last Landed | Next Target |
|---|---|---|---|---|---|---|
| [P001](plans/001-lgui-cocos-mcp/README.md) | lgui-cocos-mcp：Cocos Creator 接入 LGUI（MCP 驱动，替代 FGUI 工作流） | lgui-cocos-mcp, plugin/framework, plugin/tools | In Progress | M1（T005/T006/T007 落地；T008 桥通、T008c/d 进行中；T014 example 独立工程全链跑通） | 2026-11-08 [T014 example 独立工程](plans/001-lgui-cocos-mcp/evidence/2026-11-08-t014-example-standalone-project.md)，分支 lgui/cocos-backend-m1（推送在 fork；PR 须先经批准） | T008 四方快照（T008c 手动 runner + T008d 输入位） |

## 其他

- 想法池：[ideas/inbox.md](ideas/inbox.md)
- 历史/归档：暂无
