// 项目字体：ui/fonts/<名字>.ttf|.otf，按项目用到的字做子集（网页 WOFF2、Unity 原格式）；文件、defaultFont、缺字、XML 的 font 都明确报错。
// 字体样本是 Noto Sans SC 截出的几百个字（tests/fixtures/fonts/README.md）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture} from '../helpers/fixture.mjs';
import {readUiModel} from '../../plugin/tools/lib/generate/model.mjs';
import {uiProjectPath} from '../../plugin/tools/lib/generate/index.mjs';
import {checkFonts, collectChars, generateFonts, listFonts, readSfnt, subsetFont} from '../../plugin/tools/lib/generate/fonts.mjs';
import {fontRules} from '../../plugin/tools/lib/check/font-rules.mjs';
import {validateProject} from '../../plugin/tools/lib/project.mjs';
import {harfbuzz} from '../../plugin/tools/lib/vendor.mjs';
import {importTs} from '../helpers/ts.mjs';

const sample = fileURLToPath(new URL('../fixtures/fonts/NotoSansSC-Sample.otf', import.meta.url));
const project = (fields = {}) => validateProject({name: 'fonts', lguiVersion: '0.3.0', ...fields});
const model = root => readUiModel(uiProjectPath(root));

// titleFont：按钮组件 Bag/Btn 里的 title 文字控件写的 font
function fixture({fonts = {Noto: sample}, i18n = {}, extra = '', titleFont = null} = {}) {
  const root = writeFixture();
  if (extra) {
    const file = path.join(root, 'ui/assets/Bag/BagPanel.xml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</displayList>', `${extra}\n  </displayList>`));
  }
  if (titleFont) {
    const file = path.join(root, 'ui/assets/Bag/Btn.xml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('name="title"', `name="title" font="${titleFont}"`));
  }
  fs.mkdirSync(path.join(root, 'ui/fonts'), {recursive: true});
  for (const [file, from] of Object.entries(fonts)) {
    const target = path.join(root, 'ui/fonts', file.includes('.') ? file : `${file}.otf`);
    if (Buffer.isBuffer(from)) fs.writeFileSync(target, from); else fs.copyFileSync(from, target);
  }
  fs.mkdirSync(path.join(root, 'i18n'), {recursive: true});
  for (const [lang, table] of Object.entries(i18n)) fs.writeFileSync(path.join(root, 'i18n', `${lang}.json`), JSON.stringify(table));
  return root;
}

// 只有 ASCII 和 extra 这几个字的字体（从样本里截）
const smallFont = async (extra = '') => Buffer.from(await subsetFont(fs.readFileSync(sample), [...Array.from({length: 0x5f}, (_, i) => 0x20 + i), ...[...extra].map(ch => ch.codePointAt(0))]));

async function unicodes(file) {
  const hb = await harfbuzz();
  return new Set([...new hb.Face(new hb.Blob(fs.readFileSync(file)), 0).collectUnicodes()].map(cp => String.fromCodePoint(cp)));
}

const errorsOf = async promise => {
  try { await promise; } catch (error) { return error.errors ?? [error]; }
  assert.fail('应该报错');
};

test('子集：收 ASCII、ui/ 的文字、i18n/ 的文案和 format.compact 的单位，字体里没有的字不收；网页出 WOFF2，Unity 出原格式', async () => {
  const root = fixture({i18n: {'zh-CN': {'main.title': '开始游戏', 'main.count': {one: '一个', other: '多个'}}, en: {'main.title': 'Start'}}});
  const p = project({defaultFont: 'Noto'});
  const web = path.join(root, 'out/web');
  const unity = path.join(root, 'out/unity');
  assert.deepEqual(await generateFonts(root, p, model(root), web, 'woff2'), ['Noto']);
  assert.deepEqual(fs.readdirSync(web), ['Noto.woff2']);
  assert.equal(fs.readFileSync(path.join(web, 'Noto.woff2')).subarray(0, 4).toString('latin1'), 'wOF2');
  await generateFonts(root, p, model(root), unity, 'sfnt');
  assert.deepEqual(fs.readdirSync(unity), ['Noto.otf']);
  // 子集的字符表（用 HarfBuzz 读回）正好等于「要的字集 ∩ 原字体有的字」
  const chars = await unicodes(path.join(unity, 'Noto.otf'));
  const font = await unicodes(sample);
  const wanted = [...(await collectChars(root, p, model(root))).all.keys()].filter(ch => font.has(ch)).sort();
  assert.deepEqual([...chars].sort(), wanted);
  for (const ch of ['A', '~', '出', '售', '开', '始', '一', '个', '多', '万', '亿']) assert.ok(wanted.includes(ch), `字集里应该有「${ch}」`);
  for (const ch of ['的', '是', '民']) assert.ok(!chars.has(ch), `没用到的「${ch}」不该在子集里`);
  assert.ok(fs.statSync(path.join(unity, 'Noto.otf')).size < fs.statSync(sample).size / 3, '子集要比原字体小得多');
});

test('没有 ui/fonts/：不生成目录，返回空；defaultFont 是 null 照旧可以', async () => {
  const root = fixture({fonts: {}});
  fs.rmSync(path.join(root, 'ui/fonts'), {recursive: true});
  const out = path.join(root, 'out');
  assert.deepEqual(await generateFonts(root, project(), model(root), out, 'woff2'), []);
  assert.equal(fs.existsSync(out), false);
});

test('LGUI-CLI-141：默认字体没有静态文字里的字，报出是哪个字、在哪里；子集外的动态文字不查', async () => {
  const root = fixture({i18n: {'zh-CN': {'shop.title': '龘的商店'}}, extra: '<text id="n9" name="tip" xy="0,0" size="200,40" fontSize="24" autoSize="shrink" singleLine="true" text="齉"/>'});
  const errors = await errorsOf(checkFonts(root, project({defaultFont: 'Noto'}), model(root)));
  assert.deepEqual(errors.map(e => e.code), ['LGUI-CLI-141']);
  assert.match(errors[0].message, /字体 Noto.*2 个字/);
  assert.match(errors[0].message, /「龘」（U\+9F98，i18n\/zh-CN\.json shop\.title）/);
  assert.match(errors[0].message, /「齉」（U\+9F49，ui\/assets\/Bag\/BagPanel\.xml:\d+ tip）/);
  assert.equal(errors[0].file, 'ui/fonts/Noto.otf');
  // 默认字体是 null（系统字体）：不查缺字
  await checkFonts(root, project(), model(root));
});

test('LGUI-CLI-141：写了 font 的文字要那个字体有；框架的固定文字按工程语言查（韩文的 조）', async () => {
  const root = fixture({fonts: {Noto: sample, Title: sample}, extra: '<text id="n9" name="banner" xy="0,0" size="200,40" fontSize="24" font="Title" autoSize="shrink" singleLine="true" text="齉"/>'});
  let errors = await errorsOf(checkFonts(root, project({defaultFont: 'Noto'}), model(root)));
  assert.deepEqual(errors.map(e => e.code), ['LGUI-CLI-141']);
  assert.match(errors[0].message, /字体 Title.*「齉」.*BagPanel\.xml:\d+ banner/);
  fs.writeFileSync(path.join(root, 'ui/assets/Bag/BagPanel.xml'), fs.readFileSync(path.join(root, 'ui/assets/Bag/BagPanel.xml'), 'utf8').replace('text="齉"', 'text="开始"'));
  await checkFonts(root, project({defaultFont: 'Noto'}), model(root));
  fs.writeFileSync(path.join(root, 'i18n/ko.json'), '{}');
  errors = await errorsOf(checkFonts(root, project({defaultFont: 'Noto', languages: ['zh-CN', 'ko']}), model(root)));
  assert.match(errors[0].message, /「조」（U\+C870，format\.compact（ko））/);
});

test('LGUI-CLI-140：文件名、格式、内容不对；LGUI-CLI-142：defaultFont 不是项目字体', async () => {
  const bad = fixture({fonts: {'noto-sans.otf': sample, 'Web.woff2': Buffer.from('wOF2'), 'Fake.ttf': Buffer.from('not a font at all'), 'Pack.otf': Buffer.concat([Buffer.from('ttcf'), Buffer.alloc(32)]), 'OFL.txt': Buffer.from('license')}});
  const listed = await errorsOf(Promise.resolve().then(() => listFonts(bad)));
  assert.deepEqual(listed.map(e => [e.code, e.file]).sort(), [['LGUI-CLI-140', 'ui/fonts/Web.woff2'], ['LGUI-CLI-140', 'ui/fonts/noto-sans.otf']]);
  fs.rmSync(path.join(bad, 'ui/fonts/Web.woff2'));
  fs.rmSync(path.join(bad, 'ui/fonts/noto-sans.otf'));
  const errors = await errorsOf(checkFonts(bad, project({defaultFont: 'Arial'}), model(bad)));
  assert.deepEqual(errors.map(e => e.code).sort(), ['LGUI-CLI-140', 'LGUI-CLI-140', 'LGUI-CLI-142']);
  assert.match(errors.find(e => e.file === 'ui/fonts/Pack.otf').message, /字体集（TTC）/);
  assert.match(errors.find(e => e.file === 'ui/fonts/Fake.ttf').message, /不是 TTF \/ OTF/);
  assert.match(errors.find(e => e.code === 'LGUI-CLI-142').message, /defaultFont 是 "Arial"，ui\/fonts\/ 里没有这个字体（有：Fake、Pack）/);
});

test('lgui check：XML 的 font、[font=…] 只能写项目字体（LGUI-UI-080），也报 CLI-141', async () => {
  const root = fixture({extra: `<text id="n9" name="a" xy="0,0" size="200,40" fontSize="24" font="Arial" autoSize="shrink" singleLine="true" text="开始"/>
    <text id="n10" name="b" xy="0,0" size="200,40" fontSize="24" font="ui://bag00001font0001" autoSize="shrink" singleLine="true" text="开始"/>
    <richtext id="n11" name="c" xy="0,0" size="200,40" fontSize="24" autoSize="height" text="[font=Noto]开[/font][font=Fancy]始[/font]"/>
    <text id="n12" name="d" xy="0,0" size="200,40" fontSize="24" font="Noto" autoSize="shrink" singleLine="true" text="开始"/>`});
  const tables = {'zh-CN': {'x.y': '[font=Gothic]龘[/font]'}};
  const found = await fontRules({root, project: project({defaultFont: 'Noto'}), model: model(root), tables});
  const ui = found.filter(f => f.code === 'LGUI-UI-080');
  assert.deepEqual(ui.map(f => f.message.match(/font="[^"]+"|\[font=\w+\]/)[0]), ['font="Arial"', 'font="ui://bag00001font0001"', '[font=Fancy]', '[font=Gothic]']);
  assert.ok(ui.slice(0, 3).every(f => f.file === 'ui/assets/Bag/BagPanel.xml' && f.line > 0));
  assert.match(ui[1].message, /包里的资源地址/);
  assert.equal(ui[3].file, 'i18n/zh-CN.json');
  // fontRules 拿到的 tables 只用来查 [font=…]；缺字按 i18n/ 目录下的文本表查（这里没写 i18n/，不报 CLI-141）
  assert.deepEqual(found.filter(f => f.code !== 'LGUI-UI-080').map(f => f.code), []);
});

test('框架的固定文字从 fixed-text.ts 取：format.compact 和它用同一张单位表', async () => {
  const {fixedText, compactUnits} = await import('../../plugin/framework/mvc/fixed-text.ts');
  assert.deepEqual(fixedText('zh-CN').map(([, t]) => t), ['万亿', '亿', '万']);
  assert.deepEqual(fixedText('zh-TW').map(([, t]) => t), ['兆', '億', '萬']);
  assert.deepEqual(fixedText('en').map(([, t]) => t), ['T', 'B', 'M', 'K']);
  assert.equal(compactUnits('ko').length, 4);
});

test('网页的启动入口把字体名传给 backend.init', async () => {
  const {writeWebBootstrap} = await import('../../plugin/tools/lib/dev/bundle.mjs');
  const root = fixture();
  const p = project({defaultFont: 'Noto'});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-boot-'));
  fs.mkdirSync(path.join(root, '.lgui', 'build'), {recursive: true});
  fs.writeFileSync(path.join(root, '.lgui', 'build', 'deps.json'), '{}');
  const entry = writeWebBootstrap(root, p, {texts: {}, dir});
  assert.match(fs.readFileSync(entry, 'utf8'), /defaultFont: "Noto", fonts: \["Noto"\]/);
});

test('headless：只登记字体名（state.fonts），不读字体文件', async () => {
  const {createHeadlessBackend} = await importTs(fileURLToPath(new URL('../../plugin/framework/backends/headless/index.ts', import.meta.url)));
  const backend = createHeadlessBackend([]);
  await backend.init({projectName: 'fonts', defaultFont: 'Noto', fonts: ['Noto', 'Title'], uiBase: ''});
  assert.deepEqual(backend.state.fonts, ['Noto', 'Title']);
  const plain = createHeadlessBackend([]);
  await plain.init({projectName: 'fonts', defaultFont: null, uiBase: ''});
  assert.deepEqual(plain.state.fonts, []);
});

test('LGUI-CLI-141：按钮的标题按按钮组件里 title 文字控件的 font 查，i18n 里同一个键的翻译也是', async () => {
  // 默认字体 Noto 只有 ASCII；Title 是整个样本。按钮的 title 写 font="Title"，标题「出售」只有 Title 有：不该报 Noto
  const root = fixture({fonts: {Noto: await smallFont(), Title: sample}, titleFont: 'Title', i18n: {'zh-CN': {'Bag/BagPanel/sellButton': '出售'}}});
  const p = project({defaultFont: 'Noto', languages: ['zh-CN']});
  let errors = await errorsOf(checkFonts(root, p, model(root)));
  assert.ok(!errors.some(e => /字体 Noto.*「出」/.test(e.message)), '按钮标题不该按默认字体查');
  // Title 没有的字：按钮实例的 title、i18n 里同键的翻译，都报在 Title 上
  fs.writeFileSync(path.join(root, 'i18n/zh-CN.json'), JSON.stringify({'Bag/BagPanel/sellButton': '龘'}));
  errors = await errorsOf(checkFonts(root, p, model(root)));
  const title = errors.find(e => /字体 Title/.test(e.message));
  assert.match(title.message, /「龘」（U\+9F98，i18n\/zh-CN\.json Bag\/BagPanel\/sellButton）/);
  assert.ok(!errors.some(e => /字体 Noto.*龘/.test(e.message)));
});

test('LGUI-CLI-141：列表项的 title、按钮的 selectedTitle、gearText 的值也查缺字，按各自显示它的控件的字体', async () => {
  const root = fixture({fonts: {Noto: sample, Title: await smallFont('出售开始')}, titleFont: 'Title', extra: `
    <list id="n20" name="menu" xy="0,0" size="400,400" defaultItem="ui://bag00001btn00001"><item title="开始"/><item title="齉"/></list>
    <component id="n21" name="toggle" src="btn00001" xy="0,0" size="160,56"><Button title="开始" selectedTitle="龘"/></component>
    <text id="n22" name="state" xy="0,0" size="200,40" fontSize="24" autoSize="shrink" singleLine="true" text="开始"><gearText controller="tabs" pages="1" values="鬱" default="开始"/></text>`});
  const errors = await errorsOf(checkFonts(root, project({defaultFont: 'Noto', languages: ['zh-CN']}), model(root)));
  const byFont = name => errors.find(e => e.message.startsWith(`字体 ${name}`))?.message ?? '';
  assert.match(byFont('Title'), /「齉」（U\+9F49，ui\/assets\/Bag\/BagPanel\.xml:\d+ menu 的列表项）/);
  assert.match(byFont('Title'), /「龘」（U\+9F98，ui\/assets\/Bag\/BagPanel\.xml:\d+ toggle 的 selectedTitle）/);
  assert.match(byFont('Noto'), /「鬱」（U\+9B31，ui\/assets\/Bag\/BagPanel\.xml:\d+ state 的 gearText）/);
});

test('LGUI-CLI-140：空文件、不到 4 字节的文件不抛 RangeError；字体名和 CSS 通用字体名、关键字撞名', async () => {
  const short = fixture({fonts: {Noto: sample, 'Empty.ttf': Buffer.alloc(0), 'Tiny.otf': Buffer.from([0, 1, 0])}});
  const errors = await errorsOf(checkFonts(short, project(), model(short)));
  assert.deepEqual(errors.map(e => [e.code, e.file]).sort(), [['LGUI-CLI-140', 'ui/fonts/Empty.ttf'], ['LGUI-CLI-140', 'ui/fonts/Tiny.otf']]);
  assert.match(errors.find(e => e.file === 'ui/fonts/Empty.ttf').message, /只有 0 字节/);
  // 头对、表目录被截断
  const cut = fixture({fonts: {Noto: sample, 'Cut.otf': fs.readFileSync(sample).subarray(0, 20)}});
  assert.match((await errorsOf(checkFonts(cut, project(), model(cut))))[0].message, /Cut\.otf 读不出字符表：文件被截断了/);
  const clash = fixture({fonts: {'Serif.otf': sample, 'Monospace.ttf': sample, 'Default.otf': sample, 'Emoji.otf': sample, 'Serif2.otf': sample}});
  const listed = await errorsOf(Promise.resolve().then(() => listFonts(clash)));
  assert.deepEqual(listed.map(e => e.file).sort(), ['ui/fonts/Default.otf', 'ui/fonts/Emoji.otf', 'ui/fonts/Monospace.ttf', 'ui/fonts/Serif.otf']);
  assert.match(listed.find(e => e.file === 'ui/fonts/Serif.otf').message, /和 CSS 的通用字体名或关键字 serif 撞名/);
});

test('字符表自己读：和 HarfBuzz 读出来的一样', async () => {
  const bytes = fs.readFileSync(sample);
  const hb = [...await unicodes(sample)].map(ch => ch.codePointAt(0)).sort((a, b) => a - b);
  assert.deepEqual([...readSfnt(bytes).unicodes].sort((a, b) => a - b), hb);
  assert.ok(readSfnt(bytes).tables.has('CFF '));
});
