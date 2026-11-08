# 决策 007：T011/M3 启动游戏——Q4 收口，复用 funplay-cocos-mcp

日期：2026-11-08。状态：已采纳（收口 Q4 的自动化面结论；实机 Play 联调待 Creator GUI 会话）。

## 结论（Q4 答案）

**不自研 Creator extension。** 复用 testbed 已带的 `funplay-cocos-mcp`（MIT，FunplayAI/funplay-cocos-mcp，嵌入编辑器的 HTTP MCP server）：

- **Play 控制**：`run_project_preview`（gameView/browser/simulator）+ `pause_runtime`/`resume_runtime`。
- **截图**：`capture_game_screenshot` / `capture_preview_screenshot`（写 temp 目录回传路径）。
- **日志**：`get_recent_logs` / `search_project_logs`（编辑器与工程日志）。
- **运行时检查**：`execute_javascript`（`context: "scene"` 在运行时上下文执行——可直接读 `globalThis.__lgui`、调 `lgui.debug.snapshot()`，这正是 LGUI 语义的验收探针）。

Creator CLI 的边界维持原判：`--project/--build` 能开工程与构建，**没有 Play 控制**——运行时自动化全部走 extension 的 HTTP MCP（streamable HTTP：POST `/`，JSON-RPC，`Accept: application/json, text/event-stream`；端口 8765 或按工程派生 20000–29999，编辑器菜单 Funplay > MCP Server 可查）。

## 决策

1. lgui-cocos MCP server 增加**代理工具**（不重复实现能力，只做转发与 lgui 语义封装）：
   - `cocos_preview` → funplay `run_project_preview`（启动预览 = 「启动游戏」）
   - `cocos_screenshot` → funplay `capture_game_screenshot`
   - `cocos_eval` → funplay `execute_javascript`（scene 上下文；读 `__lgui` 快照、驱动界面栈）
2. 连接配置：环境变量 `FUNPLAY_MCP_URL`（默认 `http://127.0.0.1:8765/`）。未设置/连不上时工具返回 `isError` 并提示「在 Creator 里打开 Funplay > MCP Server」。
3. 实机 Play 联调（GUI 会话）：安装/启用 extension → 预览 → `cocos_eval` 读快照 + 截图，作为 T011 验收的最后一环，单独记录。

## 后果

- M3 的「启动游戏」在本仓库范围内完成：宿主（ZCode 等）通过 lgui-cocos 一个 MCP server 即可串联「改界面 → check/test → export → Creator 预览 → 截图/快照」全流程，不经过 FGUI。
- funplay-cocos-mcp 是外部 MIT 依赖（testbed vendored）：升级/替换不影响 lgui 语义层——代理工具的 lgui 封装（快照、验收断言）留在我们这侧。
