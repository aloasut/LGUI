// lgui unity export 补 TMP Essential Resources：工程用了项目字体（Unity 上是 TMP 字体）、Unity 工程里没有 TMP Settings 时，
// 从 com.unity.ugui 自带的 .unitypackage 导入（不联网），只写还没有的文件；找不到、读不了报 LGUI-CLI-143；已有 TMP Settings 的什么都不动。
// 资源包是测试里造的小包（真包的路径和内容在 Windows 上核对，见 tests/unity/fonts/README.md）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {run} from '../cli/helpers.mjs';
import {createUnityProject} from '../../helpers/unity.mjs';
import {readUnityPackage, writeUnityPackage} from '../../../plugin/tools/lib/unitypackage.mjs';
import {essentialsCandidates} from '../../../plugin/tools/lib/commands/unity-export.mjs';

const sample = fileURLToPath(new URL('../../fixtures/fonts/NotoSansSC-Sample.otf', import.meta.url));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 最小的 ustar 打包（只给测试造 .unitypackage 用）；name 超过 100 字节时用 PAX 扩展头。
function tar(entries) {
  const blocks = [];
  const header = (name, size, type) => {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
    h.write('        ', 148); h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const byte of h) sum += byte;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const pad = data => Buffer.concat([data, Buffer.alloc((512 - data.length % 512) % 512)]);
  for (const {name, data} of entries) {
    if (Buffer.byteLength(name) > 100) {
      const record = ` path=${name}\n`;
      let length = Buffer.byteLength(record) + 1;
      while (String(length).length + Buffer.byteLength(record) !== length) length = String(length).length + Buffer.byteLength(record);
      const pax = Buffer.from(`${length}${record}`);
      blocks.push(header('PaxHeader', pax.length, 'x'), pad(pax));
    }
    blocks.push(header(name.slice(0, 100), data.length, '0'), pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

const guid = n => n.toString(16).padStart(32, '0');
// 资源：[pathname, 内容（文件夹是 null）]
function unityPackage(resources, extra = []) {
  const entries = [];
  resources.forEach(([pathname, content], i) => {
    const id = guid(i + 1);
    entries.push({name: `${id}/pathname`, data: Buffer.from(pathname + '\n00')});
    entries.push({name: `${id}/asset.meta`, data: Buffer.from(`fileFormatVersion: 2\nguid: ${id}\n`)});
    if (content !== null) entries.push({name: `${id}/asset`, data: Buffer.from(content)});
  });
  return tar([...entries, ...extra]);
}
const essentials = [
  ['Assets/TextMesh Pro', null],
  ['Assets/TextMesh Pro/Resources', null],
  ['Assets/TextMesh Pro/Resources/TMP Settings.asset', 'tmp settings'],
  ['Assets/TextMesh Pro/Shaders', null],
  ['Assets/TextMesh Pro/Shaders/TMP_SDF-Mobile.shader', 'Shader "TextMeshPro/Mobile/Distance Field" {}']
];

test('读 .unitypackage：按 GUID 拿到路径、内容和 meta；文件夹没有内容；preview.png、PAX 长路径也认', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-unitypackage-'));
  const file = path.join(dir, 'a.unitypackage');
  const long = 'Assets/TextMesh Pro/' + 'Deep/'.repeat(25) + 'x.txt';
  fs.writeFileSync(file, unityPackage([...essentials, [long, 'deep']], [{name: guid(1) + '/preview.png', data: Buffer.from('png')}]));
  const items = readUnityPackage(file);
  assert.deepEqual(items.map(i => i.pathname), [...essentials.map(([p]) => p), long].sort());
  const settings = items.find(i => i.pathname.endsWith('TMP Settings.asset'));
  assert.equal(settings.asset.toString(), 'tmp settings');
  assert.match(settings.meta.toString(), new RegExp(`guid: ${settings.guid}`));
  assert.equal(items.find(i => i.pathname === 'Assets/TextMesh Pro').asset, undefined);
  // 写进工程：已有的文件不碰
  const project = path.join(dir, 'Unity');
  fs.mkdirSync(path.join(project, 'Assets/TextMesh Pro/Shaders'), {recursive: true});
  fs.writeFileSync(path.join(project, 'Assets/TextMesh Pro/Shaders/TMP_SDF-Mobile.shader'), 'mine');
  const result = writeUnityPackage(items, project);
  assert.equal(fs.readFileSync(path.join(project, 'Assets/TextMesh Pro/Shaders/TMP_SDF-Mobile.shader'), 'utf8'), 'mine');
  assert.equal(fs.readFileSync(path.join(project, 'Assets/TextMesh Pro/Resources/TMP Settings.asset'), 'utf8'), 'tmp settings');
  assert.match(fs.readFileSync(path.join(project, 'Assets/TextMesh Pro/Resources/TMP Settings.asset.meta'), 'utf8'), /guid: /);
  assert.ok(fs.existsSync(path.join(project, 'Assets/TextMesh Pro.meta')));
  assert.deepEqual(result, {written: 8, kept: 1}); // 3 个文件夹的 meta + 3 个文件的内容和 meta，减去已有的 shader
});

test('读 .unitypackage：路径不在 Assets/ 下或带 ..、缺 meta、不是 gzip 都报错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-unitypackage-'));
  const write = (name, bytes) => { const file = path.join(dir, name); fs.writeFileSync(file, bytes); return file; };
  assert.throws(() => readUnityPackage(write('up.unitypackage', unityPackage([['Assets/../ProjectSettings/x.asset', 'x']]))), /不在 Assets\/ 下/);
  assert.throws(() => readUnityPackage(write('out.unitypackage', unityPackage([['Packages/x.asset', 'x']]))), /不在 Assets\/ 下/);
  assert.throws(() => readUnityPackage(write('meta.unitypackage', tar([{name: guid(1) + '/pathname', data: Buffer.from('Assets/x')}]))), /缺 pathname 或 asset\.meta/);
  assert.throws(() => readUnityPackage(write('plain.unitypackage', Buffer.from('not gzip'))), /不是 gzip/);
});

test('资源包的候选位置：工程包缓存里的 com.unity.ugui、工程本地包、Unity Hub 默认安装位置里这个版本的内置包', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-candidates-'));
  fs.mkdirSync(path.join(project, 'Library/PackageCache/com.unity.ugui@abc123'), {recursive: true});
  fs.mkdirSync(path.join(project, 'Library/PackageCache/com.unity.textmeshpro@1'), {recursive: true});
  const list = essentialsCandidates(project, '6000.6.6f1', 'win32');
  assert.equal(list.length, 3);
  assert.equal(list[0], path.win32.join(project, 'Library/PackageCache/com.unity.ugui@abc123', 'Package Resources', 'TMP Essential Resources.unitypackage'));
  assert.equal(list[2], 'C:\\Program Files\\Unity\\Hub\\Editor\\6000.6.6f1\\Editor\\Data\\Resources\\PackageManager\\BuiltInPackages\\com.unity.ugui\\Package Resources\\TMP Essential Resources.unitypackage');
  assert.equal(essentialsCandidates(project, '6000.6.6f1', 'darwin')[2], '/Applications/Unity/Hub/Editor/6000.6.6f1/Unity.app/Contents/Resources/PackageManager/BuiltInPackages/com.unity.ugui/Package Resources/TMP Essential Resources.unitypackage');
});

// ---- 整条 lgui unity export ----
async function context({fonts = true, packageResources = essentials} = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-export-tmp-'));
  const init = await run(['init', 'game'], parent);
  assert.equal(init.code, 0, init.stderr);
  const root = path.join(parent, 'game');
  if (fonts) { fs.mkdirSync(path.join(root, 'ui/fonts'), {recursive: true}); fs.copyFileSync(sample, path.join(root, 'ui/fonts/Noto.otf')); }
  const unity = createUnityProject(path.join(parent, 'Unity Project'));
  if (packageResources) {
    const file = path.join(unity, 'Library/PackageCache/com.unity.ugui@2.0.0/Package Resources/TMP Essential Resources.unitypackage');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, unityPackage(packageResources));
  }
  return {root, unity};
}
const exportTo = async c => {
  const result = await run(['unity', 'export', '--to', c.unity, '--json'], c.root);
  return {...result, json: JSON.parse(result.stdout.trim().split('\n').at(-1))};
};
const settings = c => path.join(c.unity, 'Assets/TextMesh Pro/Resources/TMP Settings.asset');

test('Unity export：用了项目字体、工程没有 TMP Settings 时从 com.unity.ugui 自带的资源包导入；再导出什么都不动', async () => {
  const c = await context();
  const first = await exportTo(c);
  assert.equal(first.code, 0, first.stdout);
  assert.equal(fs.readFileSync(settings(c), 'utf8'), 'tmp settings');
  assert.match(fs.readFileSync(settings(c) + '.meta', 'utf8'), /guid: 0{31}3/);
  assert.ok(fs.existsSync(path.join(c.unity, 'Assets/TextMesh Pro/Shaders/TMP_SDF-Mobile.shader')));
  assert.equal(first.json.data.tmpEssentials.imported, 7); // 3 个文件夹的 meta + 2 个文件的内容和 meta
  assert.match(first.json.data.tmpEssentials.from, /com\.unity\.ugui@2\.0\.0/);
  assert.ok(fs.existsSync(path.join(c.unity, 'Assets/LGUI/Resources/UI/fonts/Noto.otf')));
  // 已经有 TMP Settings：什么都不动（改过的内容也留着）
  fs.writeFileSync(settings(c), 'edited by user');
  const before = hash(settings(c));
  const second = await exportTo(c);
  assert.equal(second.code, 0, second.stdout);
  assert.equal(second.json.data.tmpEssentials, null);
  assert.equal(hash(settings(c)), before);
});

test('Unity export：工程里别的位置已有 TMP Settings.asset，或者没用项目字体时，不导入', async () => {
  const has = await context();
  fs.mkdirSync(path.join(has.unity, 'Assets/Mine/Resources'), {recursive: true});
  fs.writeFileSync(path.join(has.unity, 'Assets/Mine/Resources/TMP Settings.asset'), 'mine');
  const r1 = await exportTo(has);
  assert.equal(r1.code, 0, r1.stdout);
  assert.equal(fs.existsSync(path.join(has.unity, 'Assets/TextMesh Pro')), false);
  const none = await context({fonts: false});
  const r2 = await exportTo(none);
  assert.equal(r2.code, 0, r2.stdout);
  assert.equal(r2.json.data.tmpEssentials, null);
  assert.equal(fs.existsSync(path.join(none.unity, 'Assets/TextMesh Pro')), false);
});

test('Unity export：找不到资源包、包里没有 TMP Settings 时报 LGUI-CLI-143，写明找过哪里，什么都不写', async () => {
  const missing = await context({packageResources: null});
  const r1 = await exportTo(missing);
  assert.equal(r1.code, 1);
  const e1 = r1.json.errors[0];
  assert.equal(e1.code, 'LGUI-CLI-143');
  assert.match(e1.message, /找过：/);
  assert.ok(e1.message.includes(path.join(missing.unity, 'Packages', 'com.unity.ugui', 'Package Resources', 'TMP Essential Resources.unitypackage')));
  assert.match(e1.fix, /Window → TextMeshPro → Import TMP Essential Resources/);
  assert.equal(fs.existsSync(path.join(missing.unity, 'Assets/LGUI')), false, '在写任何东西之前就停下');
  const empty = await context({packageResources: [['Assets/TextMesh Pro', null]]});
  const r2 = await exportTo(empty);
  assert.equal(r2.json.errors[0].code, 'LGUI-CLI-143');
  assert.match(r2.json.errors[0].message, /资源包里没有 TMP Settings\.asset/);
  assert.equal(fs.existsSync(path.join(empty.unity, 'Assets/TextMesh Pro')), false);
});

test('Unity export：导入了 TMP Essential Resources 时，给人看的输出里写一行（文件数、没联网、从哪个资源包）', async () => {
  const c = await context();
  const result = await run(['unity', 'export', '--to', c.unity], c.root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /已从 com\.unity\.ugui 自带的资源包导入 TMP Essential Resources（7 个文件，没联网；工程里已有的 0 个没动）：.*com\.unity\.ugui@2\.0\.0/);
});
