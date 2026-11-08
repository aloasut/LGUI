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
const referencesDir = path.resolve(here, '../../plugin/references');
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
    name: 'lgui_spec',
    description: '读 LGUI 开发规范（ui-spec：界面 XML 的组件/控件/动效/关联写法；mvc-spec：绑定表/Model/View/Controller；error-codes：错误码清单）。开发界面/绑定表之前先取相关章节，保证写法合规。query 为空返回全文（较长），有关键词返回匹配行及上下文。',
    inputSchema: {
      type: 'object',
      properties: {
        doc: {type: 'string', enum: ['ui-spec', 'mvc-spec', 'error-codes'], description: '要读的规范文档'},
        query: {type: 'string', description: '关键词（可选）：只返回匹配行及其上下文，比如「动效」「transition」「绑定表」「LGUI-UI-067」'}
      },
      required: ['doc'],
      additionalProperties: false
    },
    spec: true
  },
  {
    name: 'lgui_new_module',
    description: '生成一个功能模块的骨架（lgui new module）：Model/View/Controller/测试 + 横竖两版界面，是开发新界面的起点。生成后跑 lgui_check 校验。',
    inputSchema: {
      type: 'object',
      properties: {
        name: {type: 'string', description: '模块名（英文，如 settings）'},
        pattern: {type: 'string', description: '界面排布模式（可选）：tabs/page/dialog 等'}
      },
      required: ['name'],
      additionalProperties: false
    },
    cli: args => ['new', 'module', String(args.name), ...(args.pattern ? ['--pattern', String(args.pattern)] : [])]
  },
  {
    name: 'lgui_new_view',
    description: '在已有包里按排布模式生成界面骨架（lgui new view）：横竖两版一次生成（lgui new view <包>/<组件> --pattern <模式>）。',
    inputSchema: {
      type: 'object',
      properties: {
        target: {type: 'string', description: '包/组件名（如 Shop/ShopPanel）'},
        pattern: {type: 'string', description: '界面排布模式（tabs/page/dialog 等）'}
      },
      required: ['target', 'pattern'],
      additionalProperties: false
    },
    cli: args => ['new', 'view', String(args.target), '--pattern', String(args.pattern)]
  },
  {
    name: 'lgui_i18n_extract',
    description: '从 ui/ 提取需要翻译的文字（lgui i18n extract）：界面里的固定文字进文本表，之后在 i18n/<语言>.json 里翻译。',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    cli: () => ['i18n', 'extract', '--json']
  },
  {
    name: 'lgui_art_split',
    description: '把 AI 生成的网格大图拆成小图并缩放到指定尺寸（lgui art split），产物直接进 ui/ 的包目录。',
    inputSchema: {
      type: 'object',
      properties: {
        image: {type: 'string', description: '大图路径（相对 LGUI 工程）'},
        grid: {type: 'string', description: '列x行（如 4x2）'},
        size: {type: 'string', description: '每张小图目标尺寸 宽x高（如 80x80）'},
        pkg: {type: 'string', description: '目标包名'},
        names: {type: 'string', description: '名字列表（逗号分隔或文件路径）'}
      },
      required: ['image', 'grid', 'size', 'pkg', 'names'],
      additionalProperties: false
    },
    cli: args => ['art', 'split', String(args.image), '--grid', String(args.grid), '--size', String(args.size), '--pkg', String(args.pkg), '--names', String(args.names)]
  },
  {
    name: 'lgui_art_cut',
    description: '按透明区域把 AI 生成的一页图集拆成小图（lgui art cut）：统一缩放、去白边、出检查图，产物直接进 ui/ 的包目录。',
    inputSchema: {
      type: 'object',
      properties: {
        image: {type: 'string', description: '整页图路径（相对 LGUI 工程）'},
        pkg: {type: 'string', description: '目标包名'},
        names: {type: 'string', description: '名字列表（逗号分隔或文件路径）'},
        size: {type: 'string', description: '统一缩放尺寸 宽x高（可选）'}
      },
      required: ['image', 'pkg', 'names'],
      additionalProperties: false
    },
    cli: args => ['art', 'cut', String(args.image), '--pkg', String(args.pkg), '--names', String(args.names), ...(args.size ? ['--size', String(args.size)] : [])]
  },
  // lgui_dev_start/shot/stop（实时预览回路）：实现与生命周期管理已就绪（devStart/devShot/devStop + cleanupDev）。
  // 已知问题：某些环境下 dev 的首次编译/请求会挂（ECONNRESET）——根因排查中，当前会话验证通过的形态见
  // tests/unit/cocos/mcp-server.test.mjs 的 dev 用例（本地单测通过，嵌套 spawn 环境待进一步定位）。
  {
    name: 'lgui_dev_start',
    description: '启动 lgui dev 网页预览（长驻，watch 生效：改 ui/ 自动重新生成并推送刷新）。之后用 lgui_dev_shot 截图看效果、lgui_dev_stop 停止。',
    inputSchema: {type: 'object', properties: {port: {type: 'number', description: '端口（默认 4199）'}}, additionalProperties: false},
    dev: 'start'
  },
  {
    name: 'lgui_dev_shot',
    description: '对运行中的 lgui dev 预览截图（1920×1080），返回截图路径——改完 ui/ 看效果用。',
    inputSchema: {type: 'object', properties: {port: {type: 'number', description: 'dev server 端口（默认 4199）'}}, additionalProperties: false},
    dev: 'shot'
  },
  {
    name: 'lgui_dev_stop',
    description: '停止 lgui dev 预览。',
    inputSchema: {type: 'object', properties: {port: {type: 'number', description: 'dev server 端口（默认 4199）'}}, additionalProperties: false},
    dev: 'stop'
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
    child.on('close', code => {
      // 提前退出 = 起不来：把日志带给调用方（devStart 的失败路径会删文件，先读）。
      const log = readAll().slice(-800);
      setTimeout(() => finish({ok: code === 0, stdout: readAll(), stderr: log}), 50);
    });
  });
}

/** 读规范文档：query 为空返回全文，有关键词返回匹配行 ±2 行上下文。 */
function readSpec(doc, query) {
  const file = path.join(referencesDir, `${doc}.md`);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { return {content: [{type: 'text', text: `读不到规范 ${file}`}], isError: true}; }
  if (!query?.trim()) return {content: [{type: 'text', text}]};
  const lines = text.split('\n');
  const keyword = query.trim().toLowerCase();
  const hits = [];
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes(keyword)) {
      const from = Math.max(0, index - 2), to = Math.min(lines.length, index + 3);
      hits.push(`（第 ${index + 1} 行）\n${lines.slice(from, to).join('\n')}`);
    }
  });
  if (!hits.length) return {content: [{type: 'text', text: `《${doc}.md》里没有匹配「${query}」的行。去掉 query 取全文，或换关键词（比如「动效」「transition」「绑定表」「列表」）。`}]};
  return {content: [{type: 'text', text: hits.join('\n\n——\n\n')}]};
}

async function callTool(name, args, cwd) {
  if (name === 'lgui_spec') return readSpec(args?.doc ?? 'ui-spec', args?.query);
  const devTool = tools.find(t => t.name === name && t.dev);
  if (devTool) {
    const root = process.env.LGUI_PROJECT_ROOT || process.cwd();
    if (devTool.dev === 'start') return devStart(args, root);
    if (devTool.dev === 'shot') return devShot(args);
    return devStop(args);
  }
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

/** lgui dev 实时预览的生命周期：LLM「改 ui/ → 立即截图看效果」的回路。
 * dev server 常驻（watch 自动重新生成+推送刷新），浏览器实例懒启动复用；进程退出时统一清理。 */
const devServers = new Map();
let devBrowser = null;

async function devStart(args, cwd) {
  const key = String(args?.port ?? 4199);
  if (devServers.has(key)) return {content: [{type: 'text', text: JSON.stringify({ok: true, url: `http://127.0.0.1:${key}/`, note: '已在运行'})}]};
  // dev 的 stdio 三路都必须是保持打开的 pipe（两颗实测雷）：
  // ① stdin 不能 ignore——dev 里 esbuild service 走继承的 stdin 与 esbuild 二进制通信，/dev/null 会让
  //    service 立死（编译请求全挂、HTTP 连接 ECONNRESET，dev 无输出无退出）；
  // ② stdout/stderr 不能文件重定向——同一机制在文件 fd 上同样卡死编译链。
  // server 活着就保持 pipe 开放（不写不关）；server 退出后 dev 随 stdin EOF 自然退出，stop 时统一 SIGKILL。
  // 端口占用预检：失败轮次遗留的孤儿 dev 会占着端口（连接立即被接受但有响应），不预检的话
  // 后续调用只见神秘的 ECONNRESET「30s 未就绪」（T011 实测链式复现）。有响应 = 被占用，明确报错。
  const probe = await new Promise(resolve => {
    const request = httpRequest(`http://127.0.0.1:${key}/`, {method: 'GET', timeout: 1500}, response => { response.resume(); resolve(true); });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
  if (probe) {
    return {content: [{type: 'text', text: `端口 ${key} 已被占用（可能是之前遗留的 lgui dev）。清理残留进程后重试，或换一个端口。`}], isError: true};
  }
  const child = spawn(process.execPath, [lguiCli, 'dev', '--port', key, '--no-open'], {cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe']});
  let devLog = '';
  child.stdout.on('data', c => { devLog += c; });
  child.stderr.on('data', c => { devLog += `[stderr] ${c}`; });
  child.on('exit', (code, signal) => { devLog += `\n[exit code=${code} signal=${signal}]`; });
  let lastPollError = '';
  const pollTrace = [];
  for (let waited = 0; waited < 30000; waited += 300) {
    const up = await new Promise(resolve => {
      // agent: false 禁用 keep-alive——dev 端 keepAliveTimeout 关闭空闲连接后，client 池里的坏 socket
      // 被复用就是 ECONNRESET（T011 实测：独立 Chrome 正常、node http 轮询全 reset）。
      const request = httpRequest(`http://127.0.0.1:${key}/`, {method: 'GET', timeout: 2000, agent: false}, response => {
        const status = response.statusCode;
        response.resume();
        pollTrace.push(`${Math.round(waited)}ms:${status}`);
        resolve(status === 200);
      });
      request.on('error', cause => { lastPollError = `${cause.code ?? cause.message}`; pollTrace.push(`${Math.round(waited)}ms:${lastPollError}`); resolve(false); });
      request.on('timeout', () => { request.destroy(); lastPollError = 'timeout'; pollTrace.push(`${Math.round(waited)}ms:timeout`); resolve(false); });
    });
    if (up) {
      devServers.set(key, {child});
      return {content: [{type: 'text', text: JSON.stringify({ok: true, url: `http://127.0.0.1:${key}/`, note: 'dev server 已启动（watch 生效：改 ui/ 自动重新生成并推送刷新）'})}]};
    }
    if (child.exitCode !== null) {
      devServers.delete(key);
      return {content: [{type: 'text', text: `lgui dev 提前退出（code ${child.exitCode}）。输出：\n${devLog.slice(-800)}`}], isError: true};
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  try { child.kill('SIGKILL'); } catch { /* */ }
  devServers.delete(key);
  return {content: [{type: 'text', text: `dev server 30s 未就绪。末次轮询错误：${lastPollError || '无'}。轮询序列：${pollTrace.join(' → ')}。dev 输出全文：\n${devLog || '（空）'}`}], isError: true};
}

async function devShot(args) {
  const key = String(args?.port ?? 4199);
  const entry = devServers.get(key);
  if (!entry) return {content: [{type: 'text', text: `dev server（端口 ${key}）没有在运行：先调 lgui_dev_start。`}], isError: true};
  const {playwright} = await import(path.join(path.dirname(lguiCli), 'lib', 'vendor.mjs'));
  if (!devBrowser) devBrowser = await playwright().chromium.launch({headless: true});
  const page = await (devBrowser.newPage ?? (async () => devBrowser.context().newPage()))();
  await page.setViewportSize({width: 1920, height: 1080});
  await page.goto(`http://127.0.0.1:${key}/`, {waitUntil: 'load', timeout: 60000});
  await page.waitForTimeout(1500); // 等渲染与首帧
  const file = path.join(tmpdir(), `lgui-dev-shot-${Date.now()}.png`);
  await page.screenshot({path: file});
  await page.close();
  return {content: [{type: 'text', text: JSON.stringify({ok: true, screenshot: file, note: '1920×1080 截图；改 ui/ 后 dev 自动刷新，再调一次 lgui_dev_shot 就是新效果'})}]};
}

function devStop(args) {
  const key = String(args?.port ?? 4199);
  const entry = devServers.get(key);
  if (!entry) return {content: [{type: 'text', text: `dev server（端口 ${key}）没有在运行。`}]};
  try { entry.child.kill('SIGKILL'); } catch { /* */ }
  devServers.delete(key);
  return {content: [{type: 'text', text: JSON.stringify({ok: true, stopped: key})}]};
}

function cleanupDev() {
  for (const entry of devServers.values()) {
    try { entry.child.kill('SIGKILL'); } catch { /* */ }
  }
  devServers.clear();
  if (devBrowser) { try { devBrowser.close(); } catch { /* */ } devBrowser = null; }
}
process.on('exit', cleanupDev);

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
