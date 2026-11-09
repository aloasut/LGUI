import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWeb, generateUnity} from '../../plugin/tools/lib/generate/index.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const projects = {
  template: path.join(repo, 'plugin/templates/project/ui/UI.fairy'),
  inventory: path.join(repo, 'examples/inventory/ui/UI.fairy')
};
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-gen-'));

for (const [label, fairy] of Object.entries(projects)) {
  test(`${label}：网页界面包有 package.xml、散图和 manifest.json，manifest 里的图片都在`, async () => {
    const out = temp();
    const result = await generateWeb(fairy, out);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.ok(Object.keys(manifest.packages).length > 0);
    for (const {name, images} of Object.values(manifest.packages)) {
      const binary = fs.readFileSync(path.join(out, name, 'package.xml'));
      assert.equal(binary.subarray(0, 4).toString(), 'FGUI');
      for (const file of Object.values(images)) assert.ok(fs.existsSync(path.join(out, name, file)), `${name}/${file}`);
    }
    assert.ok(result.files.every(file => fs.existsSync(file)));
  });

  test(`${label}：Unity 界面包有 _fui.bytes`, async () => {
    const out = temp();
    const result = await generateUnity(fairy, out);
    const bytes = result.files.filter(file => file.endsWith('_fui.bytes'));
    assert.ok(bytes.length > 0);
    for (const file of bytes) assert.equal(fs.readFileSync(file).subarray(0, 4).toString(), 'FGUI');
  });
}

test('背包示例：41 张散图全部输出（Bag 26、Common 14、Main 1），Unity 端打成图集', async () => {
  const web = await generateWeb(projects.inventory, temp());
  const counts = Object.fromEntries(Object.entries(web.manifest.packages).map(([id, p]) => [id, Object.keys(p.images ?? {}).length]));
  assert.deepEqual([counts.bag00001, counts.cmn00001, counts.main0001], [26, 14, 1]);
  const unity = await generateUnity(projects.inventory, temp());
  assert.ok(unity.files.some(file => /_atlas0\.png$/.test(file)));
});

test('每次都全部重新生成：旧输出里的多余文件会被清掉', async () => {
  const out = temp();
  fs.writeFileSync(path.join(out, 'stale.txt'), 'old');
  await generateWeb(projects.template, out);
  assert.equal(fs.existsSync(path.join(out, 'stale.txt')), false);
});

test('界面工程校验不过时报 LGUI-CLI-020', async () => {
  const dir = temp();
  fs.cpSync(path.dirname(projects.template), dir, {recursive: true});
  const pkgXml = path.join(dir, 'assets/Main/package.xml');
  fs.writeFileSync(pkgXml, fs.readFileSync(pkgXml, 'utf8').replace('<resources>', '<resources><component id="missing1" name="Missing.xml" path="/"/>'));
  await assert.rejects(generateWeb(path.join(dir, 'UI.fairy'), temp()), error => (error.errors ?? [error]).every(item => item.code === 'LGUI-CLI-020'));
});

test('找不到界面工程文件时报 LGUI-CLI-020', async () => {
  await assert.rejects(generateWeb(path.join(temp(), 'UI.fairy'), temp()), error => error.code === 'LGUI-CLI-020');
});

test('图集上限：没写 maxAtlasSize 的包用 ui/settings/Publish.json 的 atlasSetting.maxSize，没写才默认 4096，竖屏的 1080×2600 背景能生成（网页和 Unity）；比上限大的图报 LGUI-CLI-113，写了 <publish maxAtlasSize> 的包按它的', async () => {
  const {sharp} = await import('../../plugin/tools/lib/vendor.mjs');
  const ui = path.join(temp(), 'ui');
  fs.cpSync(path.dirname(projects.template), ui, {recursive: true});
  const main = path.join(ui, 'assets', 'Main');
  const descriptor = path.join(main, 'package.xml');
  const original = fs.readFileSync(descriptor, 'utf8');
  const png = (w, h, file) => sharp()({create: {width: w, height: h, channels: 4, background: {r: 20, g: 40, b: 80, alpha: 1}}}).png().toFile(path.join(main, file));
  await png(1080, 2600, 'bg.png');
  fs.writeFileSync(descriptor, original.replace('</resources>', '  <image id="bg000001" name="bg.png" path="/" exported="true"/>\n  </resources>'));
  const fairy = path.join(ui, 'UI.fairy');
  await generateWeb(fairy, temp());
  await generateUnity(fairy, temp());

  await png(5000, 64, 'strip.png');
  fs.writeFileSync(descriptor, original.replace('</resources>', '  <image id="bg000001" name="bg.png" path="/" exported="true"/>\n    <image id="strip001" name="strip.png" path="/" exported="true"/>\n  </resources>'));
  for (const generate of [generateWeb, generateUnity]) {
    const error = await generate(fairy, temp()).then(() => null, e => e);
    assert.deepEqual(error?.errors?.map(e => e.code), ['LGUI-CLI-113'], String(error?.stack ?? error));
    assert.match(error.errors[0].message, /包 Main 的图片 strip\.png（5000×64）比图集上限 4096×4096（LGUI 默认）大/);
    assert.match(error.errors[0].fix, /<publish name="Main" maxAtlasSize="8192"\/>/);
  }
  // ui/settings/Publish.json 写了全局 atlasSetting.maxSize 就用用户的：8192 时 5000 宽的图能生成；2048 时 1080×2600 的背景就超了
  const publish = path.join(ui, 'settings', 'Publish.json');
  fs.mkdirSync(path.dirname(publish), {recursive: true});
  fs.writeFileSync(publish, JSON.stringify({atlasSetting: {maxSize: 8192}}));
  await generateWeb(fairy, temp());
  await generateUnity(fairy, temp());
  fs.writeFileSync(publish, JSON.stringify({atlasSetting: {maxSize: 2048}}));
  fs.writeFileSync(descriptor, original.replace('</resources>', '  <image id="bg000001" name="bg.png" path="/" exported="true"/>\n  </resources>'));
  const small = await generateWeb(fairy, temp()).then(() => null, e => e);
  assert.deepEqual(small?.errors?.map(e => e.message), ['包 Main 的图片 bg.png（1080×2600）比图集上限 2048×2048（ui/settings/Publish.json 的 atlasSetting.maxSize）大，打不进图集。'], String(small?.stack ?? small));
  fs.rmSync(publish);

  // 模板的 package.xml 已经有空的 <publish name="Main">（编辑器保存的格式），在它上面加 maxAtlasSize
  fs.writeFileSync(descriptor, original.replace('</resources>', '  <image id="bg000001" name="bg.png" path="/" exported="true"/>\n    <image id="strip001" name="strip.png" path="/" exported="true"/>\n  </resources>').replace('<publish name="Main">', '<publish name="Main" maxAtlasSize="8192">'));
  await generateWeb(fairy, temp());

  const {atlasError} = await import('../../plugin/tools/lib/generate/atlas.mjs');
  const converted = atlasError(new Error('atlas: Could not pack every input for package "Lobby".'));
  assert.deepEqual([converted.code, converted.file], ['LGUI-CLI-113', 'ui/assets/Lobby/package.xml']);
  const other = new Error('别的错');
  assert.equal(atlasError(other), other);
});
