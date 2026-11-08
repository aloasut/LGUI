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

~~实机 Play 联调待 Creator GUI 会话~~ **当日已做实机联调，部分通过，见下**。

## 2026-11-08（续）：实机 Play 联调——启动链全通，预览渲染对齐待修

对导出工程（inventory）跑真 GUI 实机链路：

1. `extensions/funplay-cocos-mcp` 装进导出工程 + 工程根写 `funplay-cocos-mcp.config.json`（`{"portMode": "fixed", "port": 21600}`——固定端口可预设，免去派生端口扫描）。
2. `CocosCreator --project <工程>` 启动 GUI：**extension autostart，5 秒内 HTTP MCP 就绪**。
3. 身份校验：initialize 响应的 `funplay.context.expected_context`（`project_id:instance_id` 拼接串）作为每个工具调用的 `expected_context` 参数——funplay 的防任意 server token 机制。
4. `toolProfile` 默认 `core` 不含预览类工具——配置文件改 `"toolProfile": "full"` 后重启 Creator（配置文件改动不热载）。
5. `run_project_preview`（browser 模式）→ Creator 起 7456 预览服务 → playwright 驱动：**`__lgui` 挂上、boot 成功、五层栈 HudView/MainView 就位、60fps 渲染中（draw call 17、三角形 461）**。

**抓出一颗新雷（第五颗 CC 工具链坑，已修）**：预览编译链（SystemJS/packer-driver）下 `Camera.Projection` / `Layers.Enum` 静态命名空间是 undefined（构建链正常）——backend init 建相机时 `Camera.Projection.ORTHO` 抛 TypeError、boot 中断。修：`backends/cocos/index.ts` 枚举从运行时构造器取（`cam.constructor.Projection?.ORTHO`）+ 确认过的数值兜底（ORTHO=0、SOLID_COLOR=7、UI_2D=1<<25，从 cc 构建产物源码核对）。
连带发现：**export 的文件替换不触发 Creator 脚本重编译**（asset-db refresh 也不行）——重启 Creator 才重编译。实机迭代时重导出后要重启 Creator（或后续在 export 命令/文档里注明）。

**部分未过——预览渲染对齐待修**：预览面板视口 1080×1080（Creator 预览按工程设计分辨率 fitHeight 模拟），LGUI 界面栈逻辑正确但**画面黑屏**（draw call/三角形有内容渲染，相机/视口对齐偏出）——与 T008c 转屏同类（窗口尺寸耦合的适配问题），方向：预览面板模拟分辨率设成 1920×1080，或后端 resize 适配补预览面板场景。坐标点击的换算也依赖同一适配，一并归入该项。
