// lgui cocos export：目标校验、staging 两段式写入、幂等重导出、owned-path 保护。
// 真包产物（generateCocos 走 OpenFairyGUI）在 testbed/example 的 sync 链路上验证过；这里用 lgui init
// 的模板工程（含最小 ui/）验证命令面的行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {run} from '../cli/helpers.mjs';
import {pluginVersion} from '../../../plugin/tools/lib/version.mjs';
import {createCocosProject} from '../../helpers/cocos.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const files = dir => !fs.existsSync(dir) ? {} : Object.fromEntries(fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? Object.entries(files(file)).map(([key, value]) => [entry.name + '/' + key, value]) : [[entry.name, hash(file)]];
}));
const exportTo = async (ctx, extra = []) => {
  const result = await run(['cocos', 'export', '--to', ctx.cocos, ...extra, '--json'], ctx.root);
  assert.equal(result.stderr, '');
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, result.stdout);
  return {...result, json: JSON.parse(lines[0])};
};
async function context(options) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-cocos-export-'));
  const init = await run(['init', 'game'], parent);
  assert.equal(init.code, 0, init.stderr);
  return {parent, root: path.join(parent, 'game'), cocos: createCocosProject(path.join(parent, 'cocos 工程'), options)};
}
function assertFailure(result, code) {
  assert.equal(result.code, 1, result.stdout);
  const json = result.json ?? JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(json.ok, false, result.stdout);
  assert.equal(json.command, 'cocos export');
  assert.equal(json.errors[0].code, code, result.stdout);
  assert.equal(typeof json.errors[0].fix, 'string');
}

test('cocos export：--to 必填，不接受额外位置参数', async () => {
  const c = await context();
  const missing = await run(['cocos', 'export', '--json'], c.root);
  assert.equal(JSON.parse(missing.stdout).errors[0].code, 'LGUI-CLI-006');
  assertFailure(await exportTo(c, ['unexpected']), 'LGUI-CLI-006');
});

test('cocos export：目标必须是 CC 3.8.x 且带 fairygui-cc@1.2.2，失败不写目标或工程配置', async () => {
  for (const options of [{creator: '3.7.4'}, {fairy: '1.2.1'}, {fairy: null}]) {
    const c = await context(options);
    const before = files(c.cocos), config = read(c.root, '.lgui/project.json');
    assertFailure(await exportTo(c), 'LGUI-CLI-053');
    assert.deepEqual(files(c.cocos), before);
    assert.equal(read(c.root, '.lgui/project.json'), config);
  }
});

test('cocos export：目录里没有 package.json 时报 053', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-cocos-export-'));
  const init = await run(['init', 'game'], parent);
  assert.equal(init.code, 0, init.stderr);
  const empty = path.join(parent, 'not-a-project');
  fs.mkdirSync(empty);
  const result = await run(['cocos', 'export', '--to', empty, '--json'], path.join(parent, 'game'));
  assertFailure(result, 'LGUI-CLI-053');
});

test('cocos export：成功导出五类生成物 + 模板场景，project.json 记录 cocosProject', async () => {
  const c = await context();
  const {json} = await exportTo(c);
  assert.equal(json.ok, true);
  assert.equal(json.data.sceneCreated, true);
  // 五类生成物都在
  for (const dir of ['assets/lgui-ui', 'assets/lgui-framework', 'assets/ui-types', 'assets/lgui-boot', 'assets/app-src']) {
    assert.ok(fs.existsSync(path.join(c.cocos, dir)), dir + ' 缺失');
  }
  // 界面包产物：<包名>/<包名>.bin + 图集（decisions/003 布局，.bin 在包子目录里）+ i18n
  const packages = fs.readdirSync(path.join(c.cocos, 'assets/lgui-ui'), {withFileTypes: true})
    .filter(e => e.isDirectory() && e.name !== 'i18n').map(e => e.name);
  assert.ok(packages.length >= 1, '没有包目录');
  for (const name of packages) {
    assert.ok(fs.readdirSync(path.join(c.cocos, 'assets/lgui-ui', name)).some(f => f === name + '.bin'), name + ' 的 .bin 缺失');
  }
  assert.ok(fs.existsSync(path.join(c.cocos, 'assets/lgui-ui/i18n')));
  // 框架子集：入口 + VERSION + cocos 后端目录（不进 h5 vendor）
  assert.ok(fs.existsSync(path.join(c.cocos, 'assets/lgui-framework/index.ts')));
  assert.ok(fs.existsSync(path.join(c.cocos, 'assets/lgui-framework/backends/cocos')));
  assert.equal(read(c.cocos, 'assets/lgui-framework/VERSION').trim(), pluginVersion());
  // boot：Boot.ts 模板 + 生成的 lgui-config（config/deps/components/texts 四样）
  const bootConfig = read(c.cocos, 'assets/lgui-boot/lgui-config.ts');
  for (const name of ['export const config', 'export const deps', 'export const components', 'export const texts']) {
    assert.ok(bootConfig.includes(name), 'lgui-config 缺 ' + name);
  }
  assert.ok(read(c.cocos, 'assets/lgui-boot/Boot.ts').includes("backend: 'cocos'"));
  // app-src：别名按深度重写成相对路径
  const mainTs = read(c.cocos, 'assets/app-src/main.ts');
  assert.ok(!/from 'lgui'/.test(mainTs), 'main.ts 还有未重写的 lgui 别名');
  // 场景 = 模板内容，meta 没有被拷（CC 导入自动生成 uuid）
  assert.equal(hash(path.join(c.cocos, 'assets/main.scene')), hash(path.join(repo, 'plugin/framework/backends/cocos/project-template/main.scene')));
  assert.equal(fs.existsSync(path.join(c.cocos, 'assets/main.scene.meta')), false);
  // 工程配置记录了 cocosProject
  assert.equal(JSON.parse(read(c.root, '.lgui/project.json')).cocosProject, '../cocos 工程');
});

test('cocos export：重导出幂等（产物一致，bundle meta 的随机 uuid 除外），框架版本不符时报 003', async () => {
  const c = await context();
  await exportTo(c);
  const first = files(c.cocos);
  delete first['assets/lgui-ui.meta'];
  await exportTo(c);
  const second = files(c.cocos);
  delete second['assets/lgui-ui.meta'];
  assert.deepEqual(second, first);
  // meta 内容稳定（bundle 配置），只有 uuid 随机
  const meta = JSON.parse(read(c.cocos, 'assets/lgui-ui.meta'));
  assert.equal(meta.userData.isBundle, true);
  assert.equal(meta.userData.bundleName, 'lgui-ui');
  // 用户改动场景不被覆盖
  fs.appendFileSync(path.join(c.cocos, 'assets/main.scene'), '\n');
  const {json} = await exportTo(c);
  assert.equal(json.data.sceneCreated, false);
  assert.ok(read(c.cocos, 'assets/main.scene').endsWith('\n'));
  // 框架版本不符 → 003，生成物不更新
  fs.writeFileSync(path.join(c.cocos, 'assets/lgui-framework/VERSION'), '0.0.0');
  const before = files(c.cocos);
  assertFailure(await exportTo(c), 'LGUI-CLI-003');
  assert.deepEqual(files(c.cocos), before);
});

test('cocos export：管理路径上的符号链接报 054，不覆盖链接目标', async () => {
  const c = await context();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-cocos-outside-'));
  fs.writeFileSync(path.join(outside, 'keep.txt'), '别动我');
  const link = path.join(c.cocos, 'assets/lgui-ui');
  fs.mkdirSync(path.dirname(link), {recursive: true});
  fs.symlinkSync(outside, link, 'dir');
  assertFailure(await exportTo(c), 'LGUI-CLI-054');
  assert.equal(read(outside, 'keep.txt'), '别动我');
});
