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
| [P001](plans/001-lgui-cocos-mcp/README.md) | lgui-cocos-mcp：Cocos Creator 接入 LGUI（MCP 驱动，替代 FGUI 工作流） | lgui-cocos-mcp, plugin/framework, plugin/tools | In Progress | M1（T005/T006 落地；T007 testbed 就绪，待 Creator 实测） | 2026-11-08 [T007 完成](plans/001-lgui-cocos-mcp/evidence/2026-11-07-t007-cli-build-attempt.md)，M1 主体在分支 lgui/cocos-backend-m1（推送在 fork；PR 已按 Owner 要求关闭，开 PR 须先经批准） | T008 conformance 四方快照 |

## 其他

- 想法池：[ideas/inbox.md](ideas/inbox.md)
- 历史/归档：暂无
