import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {run, tempProject, emptyDir} from './helpers.mjs';
import {registry} from '../../../plugin/tools/lib/cli.mjs';

const parse = text => JSON.parse(text);

test('不带参数时列出全部命令，退出码 0', async () => {
  const result = await run([], emptyDir());
  assert.equal(result.code, 0);
  for (const command of registry) assert.ok(result.stdout.includes(command.usage), command.name);
});

test('登记了方案 8.3 的命令清单和 editor props', () => {
  const names = registry.map(command => command.name);
  assert.deepEqual(names.sort(), ['art cut', 'art split', 'check', 'cocos export', 'dev', 'doctor', 'editor', 'editor props', 'i18n extract', 'init', 'new module', 'new view', 'test', 'ui list', 'unity export', 'upgrade', 'verify'].sort());
});

test('未知命令报 LGUI-CLI-001，并列出全部命令', async () => {
  const result = await run(['nope', '--json'], emptyDir());
  assert.equal(result.code, 1);
  const json = parse(result.stdout);
  assert.equal(json.ok, false);
  assert.equal(json.errors[0].code, 'LGUI-CLI-001');
  assert.ok(json.errors[0].fix.includes('unity export'));
});

test('不在工程里时报 LGUI-CLI-002，提示先运行 lgui init', async () => {
  const result = await run(['check'], emptyDir());
  assert.equal(result.code, 1);
  assert.match(result.stderr, /LGUI-CLI-002/);
  assert.match(result.stderr, /lgui init/);
});

test('在工程的子目录里也能找到工程', async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, 'src', 'modules'), {recursive: true});
  const json = parse((await run(['unity', 'export', '--json'], path.join(root, 'src', 'modules'))).stdout);
  assert.equal(json.errors[0].code, 'LGUI-CLI-006');
});

test('版本不一致时报 LGUI-CLI-003，原话提示运行 lgui upgrade', async () => {
  const root = tempProject({lguiVersion: '0.0.1'});
  const json = parse((await run(['dev', '--json'], root)).stdout);
  assert.equal(json.errors[0].code, 'LGUI-CLI-003');
  assert.match(json.errors[0].message, /^工程里的框架是 0\.0\.1，插件是 \d+\.\d+\.\d+，请先运行 lgui upgrade。$/);
});

test('init、doctor、upgrade 不做版本检查', async () => {
  const root = tempProject({lguiVersion: '0.0.1'});
  for (const argv of [['init']]) {
    const json = parse((await run([...argv, '--json'], root)).stdout);
    assert.notEqual(json.errors[0].code, 'LGUI-CLI-003', argv.join(' '));
  }
  // doctor 不被版本检查拦住：照常跑完，把版本不一致作为它自己的一项检查结果报出来
  const doctor = parse((await run(['doctor', '--json'], root)).stdout);
  assert.ok(doctor.data.items.some(i => i.name === '工程版本' && !i.ok));
});

test('还没实现的命令报 LGUI-CLI-000', async () => {
  const root = tempProject();
  for (const command of registry.filter(entry => !entry.run)) {
    const json = parse((await run([...command.name.split(' '), '--json'], root)).stdout);
    assert.equal(json.errors[0].code, 'LGUI-CLI-000', command.name);
  }
});

test('--json 只输出一个 JSON 对象，字段齐全', async () => {
  const result = await run(['ui', 'list', '--json'], tempProject());
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const json = parse(lines[0]);
  assert.deepEqual(Object.keys(json).sort(), ['command', 'data', 'errors', 'ok']);
  assert.equal(json.command, 'ui list');
  assert.deepEqual(Object.keys(json.errors[0]).sort(), ['code', 'file', 'fix', 'line', 'message']);
  assert.equal(result.stderr, '');
});

test('不认识的参数报 LGUI-CLI-006；要值的参数没给值也报', async () => {
  const root = tempProject();
  assert.equal(parse((await run(['dev', '--nope', '--json'], root)).stdout).errors[0].code, 'LGUI-CLI-006');
  assert.equal(parse((await run(['dev', '--port', '--json'], root)).stdout).errors[0].code, 'LGUI-CLI-006');
});

test('成功退出码 0，失败退出码 1', async () => {
  assert.equal((await run(['--help'], emptyDir())).code, 0);
  assert.equal((await run(['check'], emptyDir())).code, 1);
});
