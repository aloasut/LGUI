# P001 未决问题

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| Q3 | conformance 四方快照的 Cocos 桥怎么做：Web 目标下能否复用浏览器桥（tests/helpers/browser.mjs）的思路？ | T008 | 未决 |
| Q4 | 启动/控制 Cocos Creator 的自动化面：Creator CLI 能做到哪一步，Play 控制/日志/截图是否需要自研 extension？ | T011、M3 范围 | 未决（可先调研） |
| Q5 | MCP server 宿主形态：独立 npm 包还是挂在 plugin/tools；与 lgui CLI 的关系是包装还是新增命令。M2 与 T009 要一起设计，避免 MCP 与 CLI 两套口令漂移 | M2 架构 | **已收口（2026-11-08）→ [decisions/006](decisions/006-mcp-server-hosting.md)**：lgui-cocos-mcp/mcp stdio 独立脚本（不进发布面）；工具=CLI 子进程包装，白名单制 |

已收口：Q1、Q2 → [decisions/003](decisions/003-testbed-and-package-layout.md)（2026-11-07）。
