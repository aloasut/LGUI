// lgui-cocos-mcp/mcp/server.mjs 的协议与工具测试：spawn stdio server，走 initialize 握手、
// tools/list、真工具调用（lgui_check 对临时工程、lgui_cocos_export 对假 CC 工程）、未知工具报错。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from '../../unit/cli/helpers.mjs';
import {createCocosProject} from '../../helpers/cocos.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const server = path.join(repo, 'lgui-cocos-mcp', 'mcp', 'server.mjs');

/** 一次会话：spawn server，逐条发消息，收响应（按 id 配对），结束时杀进程。 */
function session(cwd, env = {}) {
  const child = spawn(process.execPath, [server], {cwd, env: {...process.env, ...env}});
  const pending = new Map();
  const lines = [];
  let buffer = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else lines.push(message);
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let nextId = 0;
  const send = (method, params) => new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, ...(params ? {params} : {})}));
    child.stdin.write('\n');
  });
  const notify = method => { child.stdin.write(JSON.stringify({jsonrpc: '2.0', method})); child.stdin.write('\n'); };
  return {
    send, notify, lines,
    stderrText: () => stderr,
    end: () => { child.kill(); }
  };
}

const textOf = response => response.result.content[0].text;
const jsonOf = response => JSON.parse(textOf(response));

async function tempProject() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-mcp-'));
  const init = await run(['init', 'game'], parent);
  assert.equal(init.code, 0, init.stderr);
  return path.join(parent, 'game');
}

test('MCP：initialize 握手回显协议版本与 serverInfo', async () => {
  const root = await tempProject();
  const s = session(root);
  const hello = await s.send('initialize', {protocolVersion: '2024-11-05'});
  assert.equal(hello.result.protocolVersion, '2024-11-05');
  assert.equal(hello.result.serverInfo.name, 'lgui-cocos');
  assert.deepEqual(hello.result.capabilities, {tools: {listChanged: false}});
  s.notify('notifications/initialized');
  s.end();
});

test('MCP：tools/list 返回五个白名单工具，全部带 inputSchema', async () => {
  const root = await tempProject();
  const s = session(root);
  await s.send('initialize', {});
  const list = await s.send('tools/list');
  const names = list.result.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['cocos_eval', 'cocos_preview', 'cocos_screenshot', 'lgui_check', 'lgui_cocos_export', 'lgui_test', 'lgui_ui_list', 'lgui_verify']);
  for (const tool of list.result.tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.ok(tool.description.length > 10, tool.name);
  }
  s.end();
});

test('MCP：lgui_check 对 init 模板工程返回 ok，结构化 JSON 进 text', async () => {
  const root = await tempProject();
  const s = session(root);
  await s.send('initialize', {});
  const call = await s.send('tools/call', {name: 'lgui_check', arguments: {}});
  assert.ok(!call.result.isError, '模板工程 check 应当通过');
  const json = jsonOf(call);
  assert.equal(json.ok, true);
  assert.equal(typeof json.data, 'object');
  s.end();
});

test('MCP：lgui_cocos_export 导出 init 工程到假 CC 工程，--to 参数透传', async () => {
  const root = await tempProject();
  const cocos = createCocosProject(path.join(path.dirname(root), 'cc-out'));
  const s = session(root);
  await s.send('initialize', {});
  const call = await s.send('tools/call', {name: 'lgui_cocos_export', arguments: {to: cocos}});
  assert.ok(!call.result.isError);
  const json = jsonOf(call);
  assert.equal(json.data.sceneCreated, true);
  assert.ok(fs.existsSync(path.join(cocos, 'assets', 'lgui-ui')));
  s.end();
});

test('MCP：目标不合法时 isError true 并透传 CLI 错误码；未知工具报错', async () => {
  const root = await tempProject();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-mcp-empty-'));
  const s = session(root);
  await s.send('initialize', {});
  const bad = await s.send('tools/call', {name: 'lgui_cocos_export', arguments: {to: empty}});
  assert.equal(bad.result.isError, true);
  assert.equal(jsonOf(bad).errors[0].code, 'LGUI-CLI-053');
  const unknown = await s.send('tools/call', {name: 'nope', arguments: {}});
  assert.equal(unknown.result.isError, true);
  assert.ok(textOf(unknown).includes('nope'));
  const method = await s.send('no/such/method');
  assert.equal(method.error.code, -32601);
  assert.equal(s.stderrText(), '', 'server 不应往 stderr 写东西');
  s.end();
});

test('MCP：cocos_* 工具转发到 funplay HTTP MCP（mock 端点验证协议形状）', async () => {
  const requests = [];
  const {createServer} = await import('node:http');
  const mock = createServer((request, response) => {
    const chunks = [];
    request.on('data', c => chunks.push(c));
    request.on('end', () => {
      requests.push({method: request.method, url: request.url, accept: request.headers.accept, body: JSON.parse(Buffer.concat(chunks).toString())});
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({jsonrpc: '2.0', id: requests.at(-1).body.id, result: {content: [{type: 'text', text: '预览已启动'}]}}));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${mock.address().port}/`;
  const root = await tempProject();
  const s = session(root, {FUNPLAY_MCP_URL: url});
  await s.send('initialize', {});
  const call = await s.send('tools/call', {name: 'cocos_preview', arguments: {}});
  assert.ok(!call.result.isError);
  assert.equal(call.result.content[0].text, '预览已启动');
  const list = await s.send('tools/list');
  assert.ok(list.result.tools.some(t => t.name === 'cocos_eval'));
  await s.send('tools/call', {name: 'cocos_eval', arguments: {code: 'return 1'}});
  mock.close();
  s.end();
  // 协议形状：POST /、streamable HTTP 的 Accept、tools/call 参数映射
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/');
  assert.match(requests[0].accept, /application\/json/);
  assert.equal(requests[0].body.method, 'tools/call');
  assert.equal(requests[0].body.params.name, 'run_project_preview');
  assert.deepEqual(requests[0].body.params.arguments, {mode: 'gameView'});
  const evalCall = requests[1];
  assert.equal(evalCall.body.params.name, 'execute_javascript');
  assert.equal(evalCall.body.params.arguments.context, 'scene');
});

test('MCP：cocos_preview 带 scene 时先 open_scene 再预览（空场景黑屏的固化修复）', async () => {
  const requests = [];
  const {createServer} = await import('node:http');
  const mock = createServer((request, response) => {
    const chunks = [];
    request.on('data', c => chunks.push(c));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body);
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({jsonrpc: '2.0', id: body.id, result: {content: [{type: 'text', text: 'ok'}]}}));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const root = await tempProject();
  const s = session(root, {FUNPLAY_MCP_URL: `http://127.0.0.1:${mock.address().port}/`});
  await s.send('initialize', {});
  const call = await s.send('tools/call', {name: 'cocos_preview', arguments: {mode: 'browser', scene: 'db://assets/main'}});
  assert.ok(!call.result.isError);
  mock.close();
  s.end();
  assert.equal(requests.length, 2, '应有 open_scene + run_project_preview 两次调用');
  assert.equal(requests[0].params.name, 'open_scene');
  assert.deepEqual(requests[0].params.arguments, {target: 'db://assets/main'});
  assert.equal(requests[1].params.name, 'run_project_preview');
  assert.deepEqual(requests[1].params.arguments, {mode: 'browser'});
});

test('MCP：funplay 端点连不上时 isError true 并给出修法提示', async () => {
  const root = await tempProject();
  const s = session(root, {FUNPLAY_MCP_URL: 'http://127.0.0.1:9/'});
  await s.send('initialize', {});
  const call = await s.send('tools/call', {name: 'cocos_screenshot', arguments: {}});
  assert.equal(call.result.isError, true);
  assert.match(textOf(call), /Funplay > MCP Server/);
  s.end();
});
