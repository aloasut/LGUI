# lgui-cocos-mcp/mcp —— LGUI 的 Cocos MCP server

T010（M2）：把 lgui CLI 包装成 MCP 工具，给 MCP 宿主（ZCode/Claude/Codex 等）在对话里接入、管理、验证 LGUI 工程的能力。宿主形态与边界见 plan-tree 的 [decisions/006](../../docs/plantree/plans/001-lgui-cocos-mcp/decisions/006-mcp-server-hosting.md)（收口原 Q5）。

## 宿主配置

```json
{
  "mcpServers": {
    "lgui-cocos": {
      "command": "node",
      "args": ["<仓库路径>/lgui-cocos-mcp/mcp/server.mjs"],
      "cwd": "<LGUI 工程根目录>"
    }
  }
}
```

`cwd` 即 LGUI 工程根（MCP 工具都在它里面执行）；也可以用环境变量 `LGUI_PROJECT_ROOT` 指定。

## 工具

每个工具 = `node plugin/tools/lgui.mjs <命令> --json` 的子进程调用（口令只有 CLI 一份，MCP 层不做业务逻辑）：

| 工具 | CLI 命令 | 说明 |
|---|---|---|
| `lgui_check` | `check` | ui/mvc 规则校验 |
| `lgui_ui_list` | `ui list` | 界面包、组件、控件清单 |
| `lgui_test` | `test` | headless 一致性测试 |
| `lgui_verify` | `verify` | 标准横竖屏截图核对 |
| `lgui_spec` | 读 references 规范 | **LLM 开发 UI 的知识源**：`doc` = ui-spec / mvc-spec / error-codes，`query` 关键词检索（返回匹配行 ±2 行上下文；空则全文）。写界面 XML / 绑定表前先取相关章节 |
| `lgui_new_module` | `new module <名字> [--pattern]` | 生成功能模块骨架（Model/View/Controller/测试 + 横竖两版界面） |
| `lgui_new_view` | `new view <包>/<组件> --pattern` | 在已有包里生成界面骨架（横竖两版一次生成） |
| `lgui_i18n_extract` | `i18n extract` | 从 ui/ 提取需要翻译的文字 |
| `lgui_art_split` | `art split <图> --grid --size --pkg --names` | 把 AI 生成的网格大图拆成小图进包 |
| `lgui_art_cut` | `art cut <图> --pkg --names [--size]` | 按透明区域把 AI 生成的一页图集拆成小图进包 |
| `lgui_cocos_export` | `cocos export --to <路径>` | 导出到 Cocos Creator 工程（参数 `to` 必填） |

| `cocos_preview` | funplay `run_project_preview` | **启动游戏**：Creator 里启动运行时预览（gameView/browser/simulator）。需 Creator 已开工程并启用 Funplay > MCP Server（env `FUNPLAY_MCP_URL`，默认 `http://127.0.0.1:8765/`） |
| `cocos_screenshot` | funplay `capture_game_screenshot` | 对 Game 预览区截图，返回路径 |
| `cocos_eval` | funplay `execute_javascript`（scene） | 运行时上下文执行 JS：读 `globalThis.__lgui`（snapshot/ui）、驱动界面栈验收 |

结果：CLI 的 `--json`（`{ok, data, errors, summary}`）原样进 text content；`ok: false` 时 `isError: true`。

## 实现注记（改动前必读）

- **CLI 子进程可能输出后不退出**（export 的 OpenFairyGUI 链、verify 的 dev server 留有句柄）：`runCli` 在收到完整结构化 JSON（单行且含 `ok` 字段）时就结算并 `child.kill()`，不依赖 close 事件。spawn 的 stdin 必须 `ignore`（CLI 侧有 stdin 监听，保持打开的 pipe 会让它挂住）。
- 协议是按行分隔的 JSON-RPC 2.0（MCP stdio），手写实现，无 SDK 依赖。server 不往 stderr 写东西（stdio 协议约定 stdout 专用）。
- CLI 输出走**临时文件**而不是 pipe：子进程树（esbuild/OpenFairyGUI worker、dev server）持有 pipe fd 时调用方永远等不到 EOF——文件 fd 与调用方解耦，轮询读内容、JSON 到手即 SIGKILL 整棵进程树。
- 测试：`tests/unit/cocos/mcp-server.test.mjs`（spawn server 走完整握手 + 真工具调用 + funplay 转发协议形状）。
