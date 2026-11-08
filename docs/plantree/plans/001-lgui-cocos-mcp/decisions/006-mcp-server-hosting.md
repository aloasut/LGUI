# 决策 006：T010 MCP server 宿主形态——收口 Q5

日期：2026-11-08。状态：已采纳（收口 open-questions Q5）。

## 决策

1. **宿主**：`lgui-cocos-mcp/mcp/server.mjs`，**stdio 传输的独立 Node 脚本**（不进主插件发布面 `plugin/`——它是 Cocos 专用开发工具；也不做成独立 npm 包——没有分发需求，宿主配置直接指向脚本路径）。协议手写最小 JSON-RPC（initialize / notifications/initialized / tools/list / tools/call，按行分隔 JSON），不引入 MCP SDK 依赖——协议面就这几个 method，百行级，符合仓库轻依赖风格。
2. **与 lgui CLI 的关系：包装，不是新增命令**（草案的警告「两套口令漂移」是硬约束）。每个 MCP 工具 = `node plugin/tools/lgui.mjs <CLI 命令> --json` 的子进程调用（cwd = LGUI 工程根，MCP 客户端按工程目录启动 server，process.cwd() 即工程根）。CLI 加新能力时 MCP 工具清单跟着加一行，口令只有 CLI 一份。
3. **工具集（M2 最小闭环，白名单制）**：
   - `lgui_check` → `check`（ui/mvc 规则校验）
   - `lgui_ui_list` → `ui list --json`（控件清单）
   - `lgui_test` → `test --json`（headless 验证）
   - `lgui_cocos_export` → `cocos export --to <path> --json`（接入 Cocos 工程，参数 `to` 必填）
   - `lgui_verify` → `verify --json`（标准横竖截图）
   不做自由传命令的工具（`lgui_run <任意命令>` 安全面太大：MCP 宿主通常有更高权限）。
4. **结果映射**：CLI `--json` 输出（`{ok, data, errors, summary}`）原样转成 MCP text content；`ok: false` 时 `isError: true`。CLI 的人类可读输出（stderr）进 text 附加段。

## 后果

- 启动配置（宿主的 mcp.json）：`{"command": "node", "args": ["<仓库>/lgui-cocos-mcp/mcp/server.mjs"], "cwd": "<LGUI 工程根>"}`。
- T011/M3 的启动游戏（Creator Play 控制）后续以**新工具**加进同一 server，不换宿主。
- CLI 是能力权威；MCP 层不做任何 CLI 没有的业务逻辑（只做参数映射与错误透传）。
