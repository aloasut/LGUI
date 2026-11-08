// LGUI 的 Cocos MCP server（T010，决策 006）：stdio 传输的最小 MCP 实现，把 lgui CLI 包装成 MCP 工具。
// 口令只有 CLI 一份——每个工具就是 `node plugin/tools/lgui.mjs <命令> --json` 的子进程调用，MCP 层不做业务逻辑。
// 协议：按行分隔的 JSON-RPC 2.0（initialize / notifications/initialized / tools/list / tools/call / ping）。
// 宿主配置（按 LGUI 工程目录启动，cwd 即工程根）：
//   {"command": "node", "args": ["<仓库>/lgui-cocos-mcp/mcp/server.mjs"], "cwd": "<LGUI 工程根>"}
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {request as httpRequest} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lguiCli = path.resolve(here, '../../plugin/tools/lgui.mjs');
const serverInfo = {name: 'lgui-cocos', version: '0.3.0'};
// funplay-cocos-mcp（编辑器内 HTTP MCP）的端点：T011/M3 的实机面（预览/截图/运行时 JS）从这里走。
const funplayUrl = process.env.FUNPLAY_MCP_URL ?? 'http://127.0.0.1:8765/';

/** 工具白名单：name → CLI 命令模板。加 CLI 能力时在这里加一行映射，业务逻辑仍在 CLI。 */
const tools = [
  {
    name: 'lgui_check',
    description: '校验 LGUI 工程的界面与 MVC 规则（lgui check）：ui/ 的规范、绑定表、错误码清单。',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    cli: () => ['check']
  },
  {
    name: 'lgui_ui_list',
    description: '列出 LGUI 工程的全部界面包、组件和控件（lgui ui list），用来查控件名和类型。',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    cli: () => ['ui', 'list', '--json']
  },
  {
    name: 'lgui_test',
    description: '跑 LGUI 工程的 headless 一致性测试（lgui test）：业务数据、控件快照、界面栈。',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    cli: () => ['test', '--json']
  },
  {
    name: 'lgui_verify',
    description: '生成标准横竖屏截图并核对界面（lgui verify），输出截图路径。',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    cli: () => ['verify', '--json']
  },
  {
    name: 'lgui_cocos_export',
    description: '把 LGUI 工程导出到 Cocos Creator 工程（lgui cocos export）：界面包、图集、翻译、框架子集、启动脚本、模板场景。要求目标已安装 fairygui-cc@1.2.2。',
    inputSchema: {
      type: 'object',
      properties: {to: {type: 'string', description: 'Cocos Creator 工程根目录（绝对路径或相对 LGUI 工程的路径）'}},
      required: ['to'],
      additionalProperties: false
    },
    cli: args => ['cocos', 'export', '--to', String(args.to)]
  }
];

function runCli(args, cwd) {
  return new Promise(resolve => {
    // CLI 子进程树（export 的 OpenFairyGUI/esbuild worker、verify 的 dev server）输出完也不退出、
    // 还持有 stdio pipe 的 fd——pipe 走的话调用方进程永远等不到 EOF（T010 实测，kill CLI 杀不掉孙进程）。
    // 所以 stdout/stderr 重定向到临时文件（孙进程持有的是文件 fd，与调用方解耦），stdin ignore（CLI 有 stdin 监听），
    // 轮询文件内容，看到结构化 JSON（单行含 ok）就结算并杀掉整棵进程树。
    const outFile = path.join(tmpdir(), `lgui-mcp-cli-${process.pid}-${Math.random().toString(16).slice(2)}.log`);
    const fd = fs.openSync(outFile, 'w');
    const child = spawn(process.execPath, [lguiCli, ...args, '--json'], {cwd, env: process.env, stdio: ['ignore', fd, fd]});
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      try { fs.closeSync(fd); } catch { /* 已关闭 */ }
      try { fs.unlinkSync(outFile); } catch { /* 清理失败无妨 */ }
      resolve(result);
    };
    const readAll = () => { try { return fs.readFileSync(outFile, 'utf8'); } catch { return ''; } };
    const poll = () => {
      if (done) return;
      const text = readAll();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && 'ok' in parsed) return finish({ok: true, stdout: text, stderr: ''});
        } catch { /* JSON 还没写完整 */ }
      }
      setTimeout(poll, 50);
    };
    poll();
    child.on('error', error => finish({ok: false, stdout: '', stderr: String(error)}));
    child.on('close', () => setTimeout(() => finish({ok: true, stdout: readAll(), stderr: ''}), 50));
  });
}

async function callTool(name, args, cwd) {
  const funplay = funplayTools.find(t => t.name === name);
  if (funplay) {
    const forward = funplay.forward(args ?? {});
    if (forward.scene) {
      // 预览前先打开目标场景：Creator CLI 启动的编辑器当前场景为空，空场景预览会黑屏（T011 实测，Owner 点破）。
      const open = await callFunplay('open_scene', {target: forward.scene});
      if (open.isError) return open;
      delete forward.scene;
    }
    return callFunplay(forward.name, forward.arguments);
  }
  const tool = tools.find(t => t.name === name);
  if (!tool) return {content: [{type: 'text', text: `未知工具 ${name}`}], isError: true};
  const {stdout, stderr} = await runCli(tool.cli(args ?? {}), cwd);
  const lines = stdout.trim().split('\n').filter(Boolean);
  const json = lines.length ? (() => { try { return JSON.parse(lines.at(-1)); } catch { return null; } })() : null;
  if (json) {
    const sections = [JSON.stringify(json, null, 2)];
    if (stderr.trim()) sections.push(`stderr:\n${stderr.trim()}`);
    return {content: [{type: 'text', text: sections.join('\n\n')}], isError: json.ok === false};
  }
  // 没有结构化输出（CLI 崩溃或参数错误走到了非 JSON 通道）：把原始输出透传。
  return {content: [{type: 'text', text: (stdout + stderr).trim() || '（无输出）'}], isError: true};
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

/** 转发一个 tools/call 到 funplay-cocos-mcp 的编辑器内 HTTP MCP（streamable HTTP，POST /）。
 * 连不上时返回带修法提示的错误（Creator 没开 / extension 没启用）。 */
function callFunplay(toolName, args) {
  const body = JSON.stringify({jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: {name: toolName, arguments: args ?? {}}});
  return new Promise(resolve => {
    const request = httpRequest(funplayUrl, {method: 'POST', headers: {Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}, timeout: 30000}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(raw.startsWith('event:') ? raw.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim() ?? raw : raw); } catch { /* SSE/非 JSON 原样透传 */ }
        if (parsed && parsed.result?.content) return resolve({content: parsed.result.content, isError: parsed.result.isError === true});
        if (parsed && parsed.error) return resolve({content: [{type: 'text', text: `funplay 错误：${parsed.error.message ?? JSON.stringify(parsed.error)}`}], isError: true});
        resolve({content: [{type: 'text', text: raw.slice(0, 4000) || '（空响应）'}], isError: response.statusCode !== 200});
      });
    });
    request.on('timeout', () => { request.destroy(); resolve({content: [{type: 'text', text: `funplay MCP（${funplayUrl}）30s 无响应：Creator 可能没开或 extension 没启用。打开 Creator 菜单 Funplay > MCP Server 确认。`}], isError: true}); });
    request.on('error', cause => resolve({content: [{type: 'text', text: `连不上 funplay MCP（${funplayUrl}）：${cause.message}。在 Creator 里打开工程并启用 Funplay > MCP Server 后重试。`}], isError: true}));
    request.end(body);
  });
}

/** 实机（Creator 预览）工具：走 funplay 代理，lgui 语义的封装后续按需加。 */
const funplayTools = [
  {
    name: 'cocos_preview',
    description: '在 Cocos Creator 里启动运行时预览（gameView/browser/simulator）——相当于点 Play。Creator CLI 启动的编辑器当前场景是空的，预览空场景会黑屏：传 scene（场景 uuid 或 db:// 路径，如 db://assets/main）先打开目标场景再预览。需要 Creator 已打开工程且启用了 Funplay > MCP Server。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {type: 'string', enum: ['gameView', 'browser', 'simulator'], description: '预览方式，默认 gameView'},
        scene: {type: 'string', description: '要预览的场景 uuid 或 db:// 路径。强建议传：编辑器当前场景为空时预览会黑屏'}
      },
      additionalProperties: false
    },
    forward: args => ({name: 'run_project_preview', arguments: {mode: args?.mode ?? 'gameView'}, scene: args?.scene})
  },
  {
    name: 'cocos_screenshot',
    description: '对 Cocos Creator 的 Game 预览区截图，返回保存路径。',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    forward: () => ({name: 'capture_game_screenshot', arguments: {}})
  },
  {
    name: 'cocos_eval',
    description: '在 Cocos 运行时上下文执行 JavaScript（scene 上下文）：读 globalThis.__lgui（lgui.debug.snapshot / lgui.ui）、驱动界面栈做验收。',
    inputSchema: {type: 'object', properties: {code: {type: 'string', description: '要执行的 JavaScript'}}, required: ['code'], additionalProperties: false},
    forward: args => ({name: 'execute_javascript', arguments: {context: 'scene', code: args.code}})
  }
];

function respond(id, result) {
  write({jsonrpc: '2.0', id, result});
}

function respondError(id, code, message) {
  write({jsonrpc: '2.0', id, error: {code, message}});
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) void handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));

async function handle(line) {
  let message;
  try { message = JSON.parse(line); }
  catch { return respondError(null, -32700, 'Parse error'); }
  const {id, method, params} = message;
  try {
    switch (method) {
      case 'initialize':
        respond(id, {protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: {tools: {listChanged: false}}, serverInfo});
        return;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // 通知无响应
      case 'ping':
        respond(id, {});
        return;
      case 'tools/list':
        respond(id, {tools: [
          ...tools.map(({name, description, inputSchema}) => ({name, description, inputSchema})),
          ...funplayTools.map(({name, description, inputSchema}) => ({name, description, inputSchema}))
        ]});
        return;
      case 'tools/call': {
        const cwd = process.env.LGUI_PROJECT_ROOT || process.cwd();
        const result = await callTool(params?.name, params?.arguments, cwd);
        respond(id, result);
        return;
      }
      default:
        if (id !== undefined) respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    if (id !== undefined) respondError(id, -32603, `Internal error: ${String(error?.message ?? error)}`);
  }
}
