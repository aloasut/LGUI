# 证据：T011 启动游戏——Q4 收口 + funplay 代理工具（2026-11-08）

## 结论

[decisions/007](../decisions/007-m3-play-via-funplay.md) 收口 Q4：**不自研 Creator extension**，复用 testbed vendored 的 `funplay-cocos-mcp`（MIT，嵌入编辑器的 HTTP MCP server，0.7.0）。lgui-cocos MCP server 新增 3 个代理工具（`cocos_preview` / `cocos_screenshot` / `cocos_eval`），M3「启动游戏」的宿主面打通：宿主通过 lgui-cocos 一个 server 串联「改界面 → check/test → export → Creator 预览 → 截图/运行时快照」全流程。

## 协议事实（Q4 调研产出，读 extension 源码实测）

- funplay 编辑器内 server：**streamable HTTP**，`POST /`，JSON-RPC，`Accept: application/json, text/event-stream`（SSE 被明确 405 拒绝，纯 JSON 应答）。端口默认 8765 或按工程派生 20000–29999（菜单 Funplay > MCP Server 可查，可 Pin）。另有 npm stdio bridge（bin/funplay-cocos-mcp.js）。
- 工具面（本代理用到的）：`run_project_preview`（Play 等价物）、`capture_game_screenshot`、`execute_javascript`（scene 上下文 = 运行时，可直接读 `globalThis.__lgui` 做 lgui 语义验收）。
- Creator CLI 边界维持原判：只有 `--project`/`--build`，无 Play 控制。

## 实现

`server.mjs` 的 `funplayTools` + `callFunplay`：3 个工具转发 `tools/call` 到 `FUNPLAY_MCP_URL`（默认 `http://127.0.0.1:8765/`）；连不上/超时 30s → `isError` + 修法提示（打开 Funplay > MCP Server）。

## 测试（7/7，`tests/unit/cocos/mcp-server.test.mjs`）

新增 2 个：mock HTTP 端点验证转发协议形状（POST `/`、Accept 头、`run_project_preview` 参数映射 `mode→gameView`、`execute_javascript` 映射 `context: 'scene'`）+ 连不上端点的错误提示。

## 过程排坑（MCP server 第三颗雷——进程树 EOF）

前两版 runCli（pipe + stdin ignore、pipe + JSON 早结算 + kill）都解决不了「测试全过但 node --test 不退出」：**kill CLI 杀不掉孙进程**（export 的 esbuild/OpenFairyGUI worker），孤儿持有 stdout pipe 的 fd → EOF 永不到来。根治：**CLI 的 stdout/stderr 重定向到临时文件**（子进程树持有文件 fd，与调用方 pipe 解耦），轮询读内容、JSON 到手即 SIGKILL。附带效果：测试进程干净退出、零孤儿（残留 0 验证）。

## 边界

实机 Play 联调（Creator GUI 会话：装 extension → 预览 → `cocos_eval` 读 `__lgui` 快照 + 截图核对）待 Creator GUI 可用的会话补记录；协议形状已由 mock 端点单测覆盖。
