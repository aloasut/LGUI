// lgui check：每条规则一对样例。不通过：在新工程上改一处，应该报这个错误码；通过：新工程本身（或改对以后）不报。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../unit/cli/helpers.mjs';

const fresh = async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-check-'));
  assert.equal((await run(['init', 'g'], parent)).code, 0);
  return path.join(parent, 'g');
};
const edit = (root, file, from, to) => {
  const full = path.join(root, file);
  const text = fs.readFileSync(full, 'utf8');
  assert.ok(typeof from === 'string' ? text.includes(from) : from.test(text), `${file} 里找不到 ${from}`);
  fs.writeFileSync(full, text.replace(from, to));
};
const write = (root, file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); };
const codes = async root => {
  const json = JSON.parse((await run(['check', '--json'], root)).stdout);
  return json.data ? json.data.findings.map(f => f.code) : json.errors.map(e => e.code);
};
const VIEW = 'src/modules/main/MainView.ts';
// 动效：标题转一圈（标题没设轴心时报 LGUI-UI-067）
const SPIN = '</displayList>\n  <transition name="spin"><item time="0" type="Rotation" target="n1" duration="12" tween="true" startValue="0" endValue="360"/></transition>';
// 动效移动一个组（attrs 给组加属性，比如 advanced="true"）
const MOVE_GROUP = attrs => `  <group id="n8" name="g" xy="100,100" size="200,80"${attrs}/>\n  </displayList>\n  <transition name="move"><item time="0" type="XY" target="n8" duration="12" tween="true" startValue="100,100" endValue="300,100"/></transition>`;
const CTRL = 'src/modules/main/MainController.ts';
const MAIN_XML = 'ui/assets/Main/MainView.xml';
const MAIN_PKG = 'ui/assets/Main/package.xml';

const cases = {
  'LGUI-UI-001': {fail: r => edit(r, MAIN_PKG, 'id="main0001"', 'id="Main"')},
  'LGUI-UI-002': {fail: r => edit(r, MAIN_PKG, 'id="mainvw02"', 'id="mainvw01"')},
  'LGUI-UI-003': {fail: r => edit(r, MAIN_XML, '<text id="n3"', '<text id="n2"')},
  'LGUI-UI-004': {fail: r => edit(r, MAIN_XML, 'name="status"', 'name="Status"')},
  'LGUI-UI-005': {fail: r => edit(r, MAIN_XML, '<displayList>', '<controller name="title" pages="0,a,1,b" selected="0"/>\n  <displayList>')},
  'LGUI-UI-006': {fail: r => edit(r, MAIN_PKG, 'name="MainView@portrait.xml"', 'name="MainView@tall.xml"') || fs.renameSync(path.join(r, 'ui/assets/Main/MainView@portrait.xml'), path.join(r, 'ui/assets/Main/MainView@tall.xml'))},
  'LGUI-UI-007': {fail: r => edit(r, 'ui/assets/Main/MainView@portrait.xml', 'name="status"', 'name="state"')},
  'LGUI-UI-009': {fail: r => edit(r, 'ui/assets/Common/Confirm.xml', 'name="cancel" src="button01"', 'name="cancel" src="nope0001"')},
  'LGUI-UI-010': {fail: r => edit(r, MAIN_XML, /(name="title"[^>]*?) autoSize="shrink"/, '$1')},
  'LGUI-UI-011': {fail: r => edit(r, MAIN_XML, 'fontSize="64"', 'fontSize="14"')},
  'LGUI-UI-012': {fail: r => edit(r, VIEW, "button: { click: () => mainController.click() },", "button: { click: () => mainController.click(), redDot: 'main' },")},
  'LGUI-UI-013': {fail: r => edit(r, MAIN_XML, '</displayList>', '  <component id="n9" name="damage" fileName="ArtText.xml" pkg="cmn00001" src="arttext1" xy="0,0" size="200,40" customData="font=dmg"/>\n  </displayList>')},
  'LGUI-UI-014': {fail: r => edit(r, 'ui/assets/Common/Confirm.xml', 'name="ok"', 'name="yes"')},
  'LGUI-UI-015': {fail: r => edit(r, 'ui/assets/Common/package.xml', 'name="placeholder.png" path="/"', 'name="placeholder.png" path="/" scale="9grid"')},
  'LGUI-UI-016': {fail: r => edit(r, MAIN_XML, '</displayList>', '  <list id="n9" name="items" xy="0,0" size="100,100"/>\n  </displayList>')},
  'LGUI-UI-017': {fail: r => { fs.copyFileSync(path.join(r, 'ui/assets/Common/placeholder.png'), path.join(r, 'ui/assets/Common/logo@fr.png')); edit(r, 'ui/assets/Common/package.xml', '</resources>', '  <image id="logo0001" name="logo@fr.png" path="/" exported="true"/>\n  </resources>'); }},
  'LGUI-UI-018': {fail: r => fs.copyFileSync(path.join(r, 'ui/assets/Common/placeholder.png'), path.join(r, 'ui/assets/Main/stray.png'))},
  'LGUI-UI-019': {fail: r => { edit(r, MAIN_PKG, 'name="MainView.xml" path="/" exported="true"', 'name="MainView.xml" path="/"'); edit(r, MAIN_PKG, 'name="MainView@portrait.xml" path="/" exported="true"', 'name="MainView@portrait.xml" path="/"'); }},
  'LGUI-UI-020': {fail: r => edit(r, MAIN_XML, 'name="button" src="button01"', 'name="button" fileName="Button.xml" src="button01"'), warning: true},
  'LGUI-UI-060': {fail: r => { edit(r, MAIN_XML, '<displayList>', '<controller name="state" pages="0,a,1,b" selected="0"/>\n  <displayList>'); edit(r, MAIN_XML, /(text="你好，LGUI"[^>]*>)/, '$1\n      <gearText controller="state" pages="0,1" values="甲|乙" default="甲"/>'); }},
  'LGUI-UI-061': {fail: r => { edit(r, MAIN_XML, '<displayList>', '<controller name="tabs" pages="0,a,1,b" selected="0"/>\n  <displayList>'); edit(r, MAIN_XML, '<Button title="点我"/>', '<Button title="点我" controller="tabs" page="1"/>'); }},
  'LGUI-UI-062': {fail: r => edit(r, 'i18n/en.json', '"Main/MainView/button": "Tap me"', '"Main/MainView/button": "点我"'), warning: true},
  'LGUI-UI-063': {fail: r => edit(r, 'ui/assets/Main/MainView@portrait.xml', 'text="你好，LGUI"', 'text="你好"'), warning: true},
  'LGUI-UI-064': {fail: r => edit(r, 'ui/assets/Main/MainView@portrait.xml', /\s*<graph id="n4" name="safe"[\s\S]*?<\/graph>/, '')},
  'LGUI-UI-065': {fail: r => edit(r, MAIN_XML, '<Button title="点我"/>', '<Button title="点我" sound="ui://Main/click"/>')},
  'LGUI-UI-066': {fail: r => edit(r, 'ui/assets/Common/Button.xml', 'name="title"', 'name="label"')},
  'LGUI-UI-067': {
    fail: r => edit(r, MAIN_XML, '</displayList>', SPIN),
    pass: r => { edit(r, MAIN_XML, '</displayList>', SPIN); edit(r, MAIN_XML, 'name="title" xy="360,380"', 'name="title" xy="360,380" pivot="0.5,0.5"'); }
  },
  'LGUI-UI-068': {
    fail: r => edit(r, MAIN_XML, /(name="title"[^>]*?) singleLine="true"/, '$1'),
    pass: r => edit(r, MAIN_XML, /(name="title"[^>]*?)size="1200,120"([^>]*?) singleLine="true"/, '$1size="1200,140"$2')
  },
  'LGUI-UI-069': {
    fail: r => edit(r, MAIN_XML, '</displayList>', MOVE_GROUP('')),
    pass: r => edit(r, MAIN_XML, '</displayList>', MOVE_GROUP(' advanced="true"'))
  },
  'LGUI-UI-030': {fail: r => edit(r, 'i18n/en.json', /\s*"main\.hint": "[^"]*",/, '')},
  'LGUI-UI-031': {fail: r => edit(r, 'i18n/en.json', '{', '{\n  "nope.unused": "x",'), warning: true},
  'LGUI-UI-032': {fail: r => edit(r, 'i18n/en.json', 'Clicked {count} times', 'Clicked {n} times')},
  'LGUI-MVC-001': {fail: r => edit(r, CTRL, 'click() { mainModel.addClick(); }', 'click() { mainModel.addClick(); document.title = "x"; }')},
  'LGUI-MVC-002': {fail: r => edit(r, VIEW, "  static layer = 'page' as const;\n", '')},
  'LGUI-MVC-003': {fail: r => edit(r, VIEW, "  static fullScreen = true;", "  static fullScreen = true;\n  static cache = true;")},
  'LGUI-MVC-004': {fail: r => edit(r, VIEW, "static layer = 'page' as const;", "static layer = 'dialog' as const;")},
  'LGUI-MVC-005': {fail: r => edit(r, VIEW, '    button: {', "    nope: { visible: true },\n    button: {")},
  'LGUI-MVC-006': {fail: r => edit(r, VIEW, 'button: { click:', 'button: { label: 1, click:')},
  'LGUI-MVC-007': {fail: r => edit(r, VIEW, "    button: {", "    title: { visible: mainModel.get().clicks > 0 },\n    button: {")},
  'LGUI-MVC-008': {fail: r => edit(r, VIEW, 'click: () => mainController.click()', 'click: () => { console.log(1); }')},
  'LGUI-MVC-009': {fail: r => edit(r, VIEW, "  keys: Keys = { back: 'none' };", "  keys: Keys = { back: 'none' };\n  onOpen() { mainModel.addClick(); }")},
  'LGUI-MVC-010': {fail: r => edit(r, VIEW, "  keys: Keys = { back: 'none' };", "  keys: Keys = { back: 'none' };\n  onOpen() { lgui.service<object>('x'); }")},
  'LGUI-MVC-011': {fail: r => edit(r, CTRL, "click() { mainModel.addClick(); }", "click() { mainModel.addClick(); void lgui.ui.get(MainView)?.__component; }") || edit(r, CTRL, "import { Controller } from 'lgui';", "import { Controller, lgui } from 'lgui';\nimport { MainView } from './MainView';")},
  'LGUI-MVC-012': {fail: r => edit(r, 'src/modules/main/MainModel.ts', "import { lgui } from 'lgui';", "import { lgui } from 'lgui';\nimport './MainView';")},
  'LGUI-MVC-013': {fail: r => write(r, 'src/modules/main/MainService.ts', "import { lgui } from 'lgui';\nexport class RealMainService { ping() { lgui.toast('main.hint'); } }\n")},
  'LGUI-MVC-014': {fail: r => edit(r, CTRL, "click() { mainModel.addClick(); }", "click() { mainModel.addClick(); lgui.toast('已售出'); }") || edit(r, CTRL, "import { Controller } from 'lgui';", "import { Controller, lgui } from 'lgui';")},
  'LGUI-MVC-015': {fail: r => edit(r, VIEW, "  keys: Keys = { back: 'none' };", "  keys: Keys = { back: 'none' };\n  onOpen() { this.ui.title.rect = { x: 0, y: 0, width: 10, height: 10 }; }")},
  'LGUI-MVC-016': {
    fail: r => { edit(r, MAIN_PKG, /\s*<component id="mainvw02"[^>]*\/>/, ''); fs.rmSync(path.join(r, 'ui/assets/Main/MainView@portrait.xml')); },
    pass: r => { edit(r, MAIN_PKG, /\s*<component id="mainvw02"[^>]*\/>/, ''); fs.rmSync(path.join(r, 'ui/assets/Main/MainView@portrait.xml')); edit(r, VIEW, '  static fullScreen = true;', '  static fullScreen = true;\n  static bothOrientations = true;'); }
  },
  'LGUI-MVC-017': {fail: r => write(r, 'src/helpers.ts', 'export const x = 1;\n')},
  'LGUI-MVC-018': {fail: r => write(r, 'src/modules/main/OtherView.ts', "import { View, lgui } from 'lgui';\nimport { MainView } from './MainView';\nexport class OtherView extends View<object> { static component = 'Main/MainView'; static layer = 'popup' as const; onOpen() { void lgui.ui.get(MainView)?.__component; } }\n"), warning: true},
  'LGUI-MVC-019': {fail: r => edit(r, VIEW, "keys: Keys = { back: 'none' };", "keys: Keys = { back: 'none', confirm: { do: () => mainController.click(), hint: '出售' } };")},
  'LGUI-MVC-020': {fail: r => edit(r, VIEW, "  keys: Keys = { back: 'none' };", "  keys: Keys = { back: 'none' };\n  onOpen() { this.ui.title.visible = false; }"), warning: true}
};

// 一段 mp3 文件头（ID3 标签 + 一个 MPEG 帧头），音效规则的样例用。
const MP3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const addSound = (r, file, bytes = MP3, id = 'click001') => {
  fs.writeFileSync(path.join(r, 'ui/assets/Main', file), bytes);
  edit(r, MAIN_PKG, '</resources>', `  <sound id="${id}" name="${file}" path="/" exported="true"/>\n  </resources>`);
};

test('新建的工程检查通过：没有任何错误和警告', async () => {
  assert.deepEqual(await codes(await fresh()), []);
});

for (const [code, c] of Object.entries(cases)) {
  test(`${code}：不通过的样例报这个错误码${c.pass ? '；改对以后不报' : ''}`, async () => {
    const root = await fresh();
    c.fail(root);
    const found = await codes(root);
    assert.ok(found.includes(c.code ?? code), `应该报 ${c.code ?? code}，实际：${found.join(', ')}`);
    if (c.pass) {
      const ok = await fresh();
      c.pass(ok);
      assert.ok(!(await codes(ok)).includes(code), '改对以后不应该再报');
    }
  });
}

test('LGUI-UI-017：带字图片放在图片控件里（不会随语言换）报错', async () => {
  const root = await fresh();
  fs.copyFileSync(path.join(root, 'ui/assets/Common/placeholder.png'), path.join(root, 'ui/assets/Common/placeholder@en.png'));
  edit(root, 'ui/assets/Common/package.xml', '</resources>', '  <image id="placehd2" name="placeholder@en.png" path="/" exported="true"/>\n  </resources>');
  assert.ok(!(await codes(root)).includes('LGUI-UI-017'), '只有图片、没有用到时不报');
  edit(root, 'ui/assets/Common/Toast.xml', '</displayList>', '  <image id="n9" name="pic" src="placehd1" xy="0,0" size="32,32"/>\n  </displayList>');
  assert.ok((await codes(root)).includes('LGUI-UI-017'));
});

test('LGUI-UI-031：用模板字符串或条件表达式拼的键算用到了', async () => {
  const root = await fresh();
  for (const lang of ['zh-CN', 'en']) edit(root, `i18n/${lang}.json`, '{', `{\n  "main.tip.a": "A ${lang}",\n  "main.tip.b": "B ${lang}",\n  "main.yes": "Y ${lang}",\n  "main.no": "N ${lang}",`);
  edit(root, CTRL, 'click() { mainModel.addClick(); }', "click() { mainModel.addClick(); lgui.toast(`main.tip.${mainModel.get().clicks % 2 ? 'a' : 'b'}`); lgui.toast(mainModel.get().clicks ? 'main.yes' : 'main.no'); }");
  edit(root, CTRL, "import { Controller } from 'lgui';", "import { Controller, lgui } from 'lgui';");
  assert.deepEqual(await codes(root), []);
});

test('LGUI-MVC-001：window、CS（Unity 的 C# 入口）、globalThis、fetch、setTimeout 也拦得住', async () => {
  for (const use of ['window.alert(1);', 'void CS.UnityEngine.Debug;', 'void globalThis.x;', "void fetch('/x');", 'setTimeout(() => {}, 1);']) {
    const root = await fresh();
    edit(root, CTRL, 'click() { mainModel.addClick(); }', `click() { mainModel.addClick(); ${use} }`);
    assert.ok((await codes(root)).includes('LGUI-MVC-001'), use);
  }
});

test('报错格式：文件:行:列  错误码  说明  → 怎么改；有错误时退出码 1', async () => {
  const root = await fresh();
  cases['LGUI-MVC-001'].fail(root);
  const result = await run(['check'], root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^src\/modules\/main\/MainController\.ts:\d+  LGUI-MVC-001  用了平台全局对象 document。.*  → /m);
});

const findings = async root => {
  const json = JSON.parse((await run(['check', '--json'], root)).stdout);
  return json.data ? json.data.findings : json.errors;
};

test('LGUI-MVC-001：工程里自己声明的同名变量、参数不算平台全局对象；用全局对象赋值也拦得住', async () => {
  const root = await fresh();
  edit(root, CTRL, 'click() { mainModel.addClick(); }', 'click() { mainModel.addClick(); const navigator = 1; void navigator; }\n  distance(location: { x: number }, window = 0) { return location.x + window; }');
  assert.ok(!(await codes(root)).includes('LGUI-MVC-001'));
  const bad = await fresh();
  edit(bad, CTRL, 'click() { mainModel.addClick(); }', 'click() { mainModel.addClick(); const w = window; const o = { navigator }; void w; void o; }');
  assert.equal((await findings(bad)).filter(f => f.code === 'LGUI-MVC-001').length, 2);
});

test('LGUI-UI-030：只有 View 的 keys 表里的 hint 算文本键', async () => {
  const root = await fresh();
  edit(root, CTRL, 'click() { mainModel.addClick(); }', "click() { mainModel.addClick(); }\n  options() { return { hint: 'not.a.key', other: 1 }; }");
  assert.deepEqual(await codes(root), []);
  edit(root, VIEW, "keys: Keys = { back: 'none' };", "keys: Keys = { back: 'none', confirm: { do: () => mainController.click(), hint: 'main.sell' } };");
  assert.ok((await findings(root)).some(f => f.code === 'LGUI-UI-030' && f.message.includes('main.sell')));
});

test('LGUI-UI-011：没写 fontSize 的文字按 FairyGUI 默认的 12 号算', async () => {
  const root = await fresh();
  edit(root, MAIN_XML, ' fontSize="64"', '');
  assert.ok((await findings(root)).some(f => f.code === 'LGUI-UI-011' && f.file === MAIN_XML));
});

test('LGUI-UI-017：装载器的 url、按钮的 icon 写死了带字图片也报错', async () => {
  const lang = r => {
    fs.copyFileSync(path.join(r, 'ui/assets/Common/placeholder.png'), path.join(r, 'ui/assets/Common/placeholder@en.png'));
    edit(r, 'ui/assets/Common/package.xml', '</resources>', '  <image id="placehd2" name="placeholder@en.png" path="/" exported="true"/>\n  </resources>');
  };
  for (const url of ['ui://Common/placeholder', 'ui://cmn00001placehd1']) {
    const root = await fresh();
    lang(root);
    edit(root, 'ui/assets/Common/Toast.xml', '</displayList>', `  <loader id="n9" name="pic" xy="0,0" size="32,32" url="${url}"/>\n  </displayList>`);
    assert.ok((await findings(root)).some(f => f.code === 'LGUI-UI-017' && f.file === 'ui/assets/Common/Toast.xml'), url);
  }
  const root = await fresh();
  lang(root);
  edit(root, MAIN_XML, '<Button title="点我"/>', '<Button title="点我" icon="ui://Common/placeholder"/>');
  assert.ok((await findings(root)).some(f => f.code === 'LGUI-UI-017' && f.file === MAIN_XML));
});

test('LGUI-UI-020：同一个包里写了 pkg 和 fileName 不报', async () => {
  const root = await fresh();
  edit(root, 'ui/assets/Common/Confirm.xml', 'name="cancel" src="button01"', 'name="cancel" fileName="Button.xml" pkg="cmn00001" src="button01"');
  assert.ok(!(await codes(root)).includes('LGUI-UI-020'));
});

test('LGUI-UI-065：按钮音效要存在、已登记、是 mp3；写空表示不出声', async () => {
  const ok = await fresh();
  addSound(ok, 'click.mp3');
  edit(ok, MAIN_XML, '<Button title="点我"/>', '<Button title="点我" sound="ui://Main/click"/>');
  edit(ok, 'ui/assets/Common/Confirm.xml', '<Button title="取消"/>', '<Button title="取消" sound=""/>');
  assert.deepEqual(await codes(ok), []);
  const wav = await fresh();
  addSound(wav, 'click.wav', Buffer.from('RIFF0000WAVEfmt '));
  edit(wav, MAIN_XML, '<Button title="点我"/>', '<Button title="点我" sound="ui://Main/click"/>');
  assert.ok((await findings(wav)).some(f => f.code === 'LGUI-UI-065' && /mp3/.test(f.message)));
  const fake = await fresh();
  addSound(fake, 'click.mp3', Buffer.from('not an mp3 at all'));
  edit(fake, MAIN_XML, '<Button title="点我"/>', '<Button title="点我" sound="ui://main0001click001"/>');
  assert.ok((await findings(fake)).some(f => f.code === 'LGUI-UI-065'));
  const stray = await fresh();
  fs.writeFileSync(path.join(stray, 'ui/assets/Main/click.mp3'), MP3);
  assert.ok((await codes(stray)).includes('LGUI-UI-018'), '包目录里没登记的音效也报');
});

test('static music：写存在的 mp3 音效通过；音效不存在报 LGUI-MVC-004', async () => {
  const ok = await fresh();
  addSound(ok, 'bgm.mp3', MP3, 'bgm00001');
  edit(ok, VIEW, '  static fullScreen = true;', "  static fullScreen = true;\n  static music = 'ui://Main/bgm';");
  const okCodes = await codes(ok);
  assert.ok(!okCodes.includes('LGUI-MVC-003') && !okCodes.includes('LGUI-MVC-004'), okCodes.join(', '));
  const bad = await fresh();
  edit(bad, VIEW, '  static fullScreen = true;', "  static fullScreen = true;\n  static music = 'ui://Main/bgm';");
  assert.ok((await findings(bad)).some(f => f.code === 'LGUI-MVC-004' && f.message.includes('music')));
});

test('绑定表的新词：输入框、滑动条、动效、拖放的词通过；动效只用 playing、play、done；动作只调用 Controller', async () => {
  const root = await fresh();
  for (const f of ['MainView.xml', 'MainView@portrait.xml']) edit(root, `ui/assets/Main/${f}`, '</displayList>', '</displayList>\n  <transition name="enter">\n    <item time="0" type="Alpha" target="n1" duration="12" tween="true" startValue="0" endValue="1"/>\n  </transition>');
  edit(root, VIEW, '    button: {', [
    "    title: { value: pick(mainModel, s => s.clicks), dragData: pick(mainModel, s => s.clicks), dragIcon: 'ui://Common/placeholder' },",
    '    status: { input: text => mainController.click(text), change: v => mainController.click(v), drop: d => mainController.click(d) },',
    '    enter: { playing: pick(mainModel, s => s.clicks > 0), done: () => mainController.click() },',
    '    button: {'
  ].join('\n'));
  const found = await findings(root);
  for (const code of ['LGUI-MVC-005', 'LGUI-MVC-006', 'LGUI-MVC-007', 'LGUI-MVC-008']) assert.ok(!found.some(f => f.code === code), `${code}：${JSON.stringify(found.filter(f => f.code === code))}`);
  edit(root, VIEW, '    enter: { playing: pick(mainModel, s => s.clicks > 0), done: () => mainController.click() },', "    enter: { text: 'x', done: () => { mainModel.addClick(); } },\n    'title.x': { value: mainModel.get().clicks },");
  const bad = (await findings(root)).map(f => f.code);
  for (const code of ['LGUI-MVC-006', 'LGUI-MVC-007', 'LGUI-MVC-008']) assert.ok(bad.includes(code), `应该报 ${code}：${bad.join(', ')}`);
});

test('LGUI-UI-064：全屏界面两版都要有 safe；不是全屏的界面不要求', async () => {
  const root = await fresh();
  edit(root, MAIN_XML, /\s*<graph id="n4" name="safe"[\s\S]*?<\/graph>/, '');
  assert.ok((await findings(root)).some(f => f.code === 'LGUI-UI-064' && f.file === MAIN_XML));
  edit(root, VIEW, '  static fullScreen = true;\n', '');
  edit(root, VIEW, "static layer = 'page' as const;", "static layer = 'popup' as const;");
  assert.ok(!(await codes(root)).includes('LGUI-UI-064'));
});

test('LGUI-UI-066：绑定表给按钮写 text、按钮组件里没有 title 子控件也报，位置在绑定表；有 title 就不报', async () => {
  const root = await fresh();
  edit(root, 'ui/assets/Common/Button.xml', 'name="title"', 'name="label"');
  edit(root, MAIN_XML, '<Button title="点我"/>', '<Button/>');
  edit(root, VIEW, "button: { click: () => mainController.click() },", "button: { text: pick(mainModel, s => String(s.clicks)), click: () => mainController.click() },");
  const json = JSON.parse((await run(['check', '--json'], root)).stdout);
  const found = json.data.findings.filter(f => f.code === 'LGUI-UI-066');
  assert.ok(found.some(f => f.file === VIEW && /button 绑定了 text.*Common\/Button 里没有名为 title 的子控件/.test(f.message) && /现在的文字控件：label/.test(f.fix)), JSON.stringify(found));
  const ok = await fresh();
  edit(ok, VIEW, "button: { click: () => mainController.click() },", "button: { text: pick(mainModel, s => String(s.clicks)), click: () => mainController.click() },");
  assert.ok(!(await codes(ok)).includes('LGUI-UI-066'));
});

test('LGUI-UI-066：标签实例写了标题、下拉框实例写了选项、绑定表给下拉框写 items，组件里没有 title 子控件也报；有 title 就不报', async () => {
  const root = await fresh();
  // 一致性测试的 Controls 包里有标签（label001）和下拉框（combo001）；ControlsPanel 里的 badge 写了标题「徽章」
  fs.cpSync(path.join(import.meta.dirname, '../conformance/ui/Controls'), path.join(root, 'ui/assets/Controls'), {recursive: true});
  const PANEL = 'ui/assets/Controls/ControlsPanel.xml';
  edit(root, PANEL, '<component id="n5" name="mode" src="combo001" xy="60,240" size="300,60"/>', '<component id="n5" name="mode" src="combo001" xy="60,240" size="300,60"><ComboBox><item title="低"/><item title="高"/></ComboBox></component>');
  edit(root, 'ui/assets/Controls/package.xml', '<component id="combo001" name="ComboBox.xml" path="/"/>', '<component id="combo001" name="ComboBox.xml" path="/" exported="true"/>');
  for (const file of [MAIN_XML, 'ui/assets/Main/MainView@portrait.xml']) edit(root, file, '</displayList>', '  <component id="n9" name="mode" pkg="ctl00001" src="combo001" xy="20,20" size="300,60"/>\n  </displayList>');
  edit(root, VIEW, "button: { click: () => mainController.click() },", "button: { click: () => mainController.click() },\n    mode: { items: pick(mainModel, s => [String(s.clicks)]) },");
  assert.ok(!(await codes(root)).includes('LGUI-UI-066'));

  edit(root, 'ui/assets/Controls/Label.xml', 'name="title"', 'name="label"');
  edit(root, 'ui/assets/Controls/ComboBox.xml', 'name="title"', 'name="label"');
  const json = JSON.parse((await run(['check', '--json'], root)).stdout);
  const found = json.data.findings.filter(f => f.code === 'LGUI-UI-066');
  assert.equal(found.length, 3, JSON.stringify(found));
  assert.ok(found.some(f => f.file === PANEL && /标签 badge 写了标题「徽章」，但标签组件 Controls\/Label 里没有名为 title 的子控件，标题在网页上显示不出来/.test(f.message) && /现在的文字控件：label/.test(f.fix)), JSON.stringify(found));
  assert.ok(found.some(f => f.file === PANEL && /下拉框 mode 写了选项，但下拉框组件 Controls\/ComboBox 里没有名为 title 的子控件，选中项的文字在网页上显示不出来/.test(f.message)), JSON.stringify(found));
  assert.ok(found.some(f => f.file === VIEW && /mode 绑定了 items，但它的下拉框组件 Controls\/ComboBox 里没有名为 title 的子控件/.test(f.message)), JSON.stringify(found));
});

test('LGUI-UI-067：缩放、旋转都是原样的值不报；同一个动效里设了 Pivot、按下缩放的按钮（downEffect="scale"）不报；缩放没设轴心报', async () => {
  const root = await fresh();
  const items = [
    '<item time="0" type="Scale" target="n1" value="1,1"/>',                                                    // 复位成原样：不用轴心
    '<item time="0" type="Pivot" target="n3" value="0.5,0.5"/><item time="0" type="Rotation" target="n3" duration="6" tween="true" startValue="0" endValue="90"/>',
    '<item time="0" type="Scale" target="n2" duration="6" tween="true" startValue="1,1" endValue="1.2,1.2"/>'   // 按钮 n2，下面给它加 downEffect="scale"
  ];
  edit(root, MAIN_XML, '</displayList>', `</displayList>\n  <transition name="fx">${items.join('')}</transition>`);
  edit(root, 'ui/assets/Common/Button.xml', '<Button/>', '<Button downEffect="scale" downEffectValue="0.95"/>');
  assert.ok(!(await codes(root)).includes('LGUI-UI-067'));
  edit(root, 'ui/assets/Common/Button.xml', '<Button downEffect="scale" downEffectValue="0.95"/>', '<Button/>');
  const json = JSON.parse((await run(['check', '--json'], root)).stdout);
  const found = json.data.findings.filter(f => f.code === 'LGUI-UI-067');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].message, /动效 fx 给 button 做了缩放/);
  assert.equal(found[0].file, MAIN_XML);
  assert.ok(found[0].line > 1);
});

test('跨包图片：<image pkg="…" src="…"> 引用别的包里导出的图片不报（没有 LGUI-UI-020）；对方没导出报 LGUI-UI-009', async () => {
  const root = await fresh();
  for (const file of [MAIN_XML, 'ui/assets/Main/MainView@portrait.xml']) edit(root, file, '</displayList>', '  <image id="n9" name="logo" pkg="cmn00001" src="placehd1" xy="20,20" size="64,64"/>\n  </displayList>');
  assert.deepEqual(await codes(root), []);
  edit(root, 'ui/assets/Common/package.xml', 'name="placeholder.png" path="/" exported="true"', 'name="placeholder.png" path="/"');
  const json = JSON.parse((await run(['check', '--json'], root)).stdout);
  assert.ok(json.data.findings.some(f => f.code === 'LGUI-UI-009' && /没导出的图片 Common\/placeholder/.test(f.message)), JSON.stringify(json.data.findings));
});
