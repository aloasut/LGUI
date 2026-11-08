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

## 2026-11-09（续）：lgui_dev 挂起在干净环境复现——撤下决定成立

`lgui_dev` 三工具（start/shot/stop + 生命周期管理）实现保留在 server.mjs，但**未入白名单**：受控复现确认挂起是真实问题——干净环境（禁 sandbox、pkill 全部残留、单测试运行）下 dev_start 依然「30s 未就绪 ECONNRESET」，dev 输出显示 listen 成功（预览地址）且 generate 完成（「已重新生成界面」），但 HTTP 请求全部被 reset——**事件循环活着（能输出）而 HTTP accept/handler 不工作**。已排除：spawn stdio 三种形态（pipe/文件/三路开放 pipe——dev 里 esbuild service 走继承 stdio 的假说也不成立，pipe 下同样复现）、sandbox、残留进程占端口。

后续排障入口：dev/index.mjs 的 http handler（Host 校验/SSE/serveBuilt）+ generate 链在「被 MCP server spawn 的 dev 进程」里的行为差异；对照基准：同命令由 shell 直接 spawn 时 518ms 就绪且轮询 200。看效果用 `lgui_verify`（稳定）。

**2026-11-09 补：干净环境（禁 sandbox + 清残留 + 单测试）下稳定复现**——轮询序列全程 `timeout → ECONNRESET` 交替（连接挂起 2s 被客户端放弃；ECONNRESET 是客户端 destroy 的自伤记录，非服务器主动 reset）。**决定性对照**：同一时刻、同一端口，外部脚本进程连接 **200/200**、server 进程内连接持续挂起——**问题定性为「dev 进程事件循环在被 MCP server spawn 的环境下阻塞」**（listen 在、accept 后 handler 永不响应）。已彻底排除：spawn stdio 三种形态、sandbox、残留进程占端口、esbuild service stdio、连接复用。修复需引擎级调试（dev 进程 `--inspect` 观察事件循环/系统调用级抓包），dev 三工具保持未入白名单，看效果用 `lgui_verify`。

## 2026-11-08（续）：实机 Play 联调——启动链全通，预览渲染对齐待修

> **【根因更正（2026-11-08 晚，Owner 点破）】**「黑屏」的真正原因：**Creator CLI 启动的编辑器当前场景是空的，预览跑的是空场景而非 main.scene**——backend init 的兜底（自动建 Canvas/相机）让逻辑链活着（`__lgui`/五层栈都在），但渲染的场景不对。用 funplay `open_scene` 打开 main（uuid 96ae589d-7292-484b-bce3-0f044916b0a3）后再预览，**画面完整渲染（Traveler's Camp 营地主界面：标题/Bag/Shop/Rewards 按钮/红点/限时活动条/背景图，60fps），截图 /tmp/t011-creator-play.png**。下面「渲染可见性」小节的整段深挖（相机顺序/清屏/视野/Canvas 接管排除）针对的是错误前提，数据保留作废；ORTHO 枚举修复仍有效（backend 自动建 Canvas 分支的真实中断）。固化：`cocos_preview` 工具加 `scene` 参数（转发前先 `open_scene`），单测断言 open+preview 两次调用序列（8/8）。

对导出工程（inventory）跑真 GUI 实机链路：

1. `extensions/funplay-cocos-mcp` 装进导出工程 + 工程根写 `funplay-cocos-mcp.config.json`（`{"portMode": "fixed", "port": 21600}`——固定端口可预设，免去派生端口扫描）。
2. `CocosCreator --project <工程>` 启动 GUI：**extension autostart，5 秒内 HTTP MCP 就绪**。
3. 身份校验：initialize 响应的 `funplay.context.expected_context`（`project_id:instance_id` 拼接串）作为每个工具调用的 `expected_context` 参数——funplay 的防任意 server token 机制。
4. `toolProfile` 默认 `core` 不含预览类工具——配置文件改 `"toolProfile": "full"` 后重启 Creator（配置文件改动不热载）。
5. `run_project_preview`（browser 模式）→ Creator 起 7456 预览服务 → playwright 驱动：**`__lgui` 挂上、boot 成功、五层栈 HudView/MainView 就位、60fps 渲染中（draw call 17、三角形 461）**。

**抓出一颗新雷（第五颗 CC 工具链坑，已修）**：预览编译链（SystemJS/packer-driver）下 `Camera.Projection` / `Layers.Enum` 静态命名空间是 undefined（构建链正常）——backend init 建相机时 `Camera.Projection.ORTHO` 抛 TypeError、boot 中断。修：`backends/cocos/index.ts` 枚举从运行时构造器取（`cam.constructor.Projection?.ORTHO`）+ 确认过的数值兜底（ORTHO=0、SOLID_COLOR=7、UI_2D=1<<25，从 cc 构建产物源码核对）。
连带发现：**export 的文件替换不触发 Creator 脚本重编译**（asset-db refresh 也不行）——重启 Creator 才重编译。实机迭代时重导出后要重启 Creator（或后续在 export 命令/文档里注明）。

**部分未过——预览渲染可见性（独立问题，记录全部数据）**：LGUI 界面栈逻辑正确、渲染在跑（draw call 15–17、三角形 269–461 稳定），但画面全黑。已排除的方向（playwright 在预览页逐项操作实测）：

- ~~相机 priority 顺序~~：模板场景补 `_priority: 1073741824`（example 跑通值）+ backend init 兜底抬高——仍黑。
- ~~清屏覆盖~~：禁用清屏的 Main Camera（visibility 不含 UI_2D）——仍黑（269 三角形还在画）。
- ~~视野外~~：UI 相机 orthoHeight 540→1200→2000 扫描——仍黑（内容不在「视野外」）。
- ~~UI 相机被 cc.Canvas 接管重置~~：实测运行时 UI 相机 priority=0、clearFlags=7（SOLID_COLOR 清屏黑），与场景 JSON（1073741824/6 DEPTH_ONLY）不符——**cc.Canvas 组件在运行时接管并重置相机配置**。手动改回正确配置（DEPTH_ONLY + 高 priority + 禁 Main Camera）后背景从灰变纯黑（清色消失），**内容仍不可见**。
- 像素级：gl.readPixels 中心/角均为 (0,0,0,255)；GRoot 子树无 UIOpacity 组件。

结论：内容三角形在画但输出不可见——指向预览环境的**纹理/材质或渲染管线层**（图集纹理在显存 11.53M）。与 T008c 转屏、EXACT_FIT 无关（几何/层级/相机配置全部核对无误）。此问题独立于「启动游戏」验收（web-mobile 构建产物全通；预览 boot 链全通），作为独立问题排（Creator 预览环境的渲染适配），排障入口：预览页 playwright + `cc.director.getScene()` 直接操作。
