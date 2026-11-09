// Unity 端项目字体改用 TMP 的静态部分（本机没有 Unity，编译和运行在 tests/unity/fonts/ 里跑）：
// FairyGUI.asmdef 只多了打开 FAIRYGUI_TMPRO 的 versionDefines（台账 plugin/framework/backends/unity/PATCHES.md）；
// LGUI.Runtime 引用 TMP；两份材质让出包时带上 FairyGUI 的 TMP shader 和投影用的 UNDERLAY_ON 变体；验收检查器能分出对错。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {checkFontResult} from '../../unity/fonts/checker.mjs';

const pkg = fileURLToPath(new URL('../../../plugin/framework/backends/unity/package/', import.meta.url));
const read = rel => fs.readFileSync(pkg + rel, 'utf8');

// 上游 FairyGUI-unity 提交 8cc8f214 的 Assets/Scripts/FairyGUI.asmdef（SHA-256 b3f4133b…，见 PATCHES.md）
const upstream = {name: 'FairyGUI', rootNamespace: '', references: ['Unity.TextMeshPro'], includePlatforms: [], excludePlatforms: [], allowUnsafeCode: false, overrideReferences: false, precompiledReferences: [], autoReferenced: true, defineConstraints: [], versionDefines: [], noEngineReferences: false};

test('FairyGUI.asmdef 只改了 versionDefines：装了 com.unity.ugui 2.0.0 及以上时定义 FAIRYGUI_TMPRO', () => {
  const asmdef = JSON.parse(read('FairyGUI/FairyGUI.asmdef'));
  assert.deepEqual(asmdef.versionDefines, [{name: 'com.unity.ugui', expression: '2.0.0', define: 'FAIRYGUI_TMPRO'}]);
  assert.deepEqual({...asmdef, versionDefines: []}, upstream);
  assert.deepEqual(JSON.parse(read('package.json')).dependencies['com.unity.ugui'], '2.0.0', 'LGUI 包依赖 ugui 2.0.0，FAIRYGUI_TMPRO 总是打开');
  assert.ok(JSON.parse(read('Runtime/LGUI.Runtime.asmdef')).references.includes('Unity.TextMeshPro'));
});

test('两份材质放在 Resources 里，引用 FairyGUI 的 TMP shader：出包时带上 shader，以及无投影和 UNDERLAY_ON（投影）两个变体', () => {
  const shaderGuid = /guid: ([0-9a-f]{32})/.exec(read('FairyGUI/Extensions/TextMeshPro/Shaders/FairyGUI-TMP.shader.meta'))[1];
  assert.match(read('FairyGUI/Extensions/TextMeshPro/Shaders/FairyGUI-TMP.shader'), /^Shader "FairyGUI\/TextMeshPro\/Distance Field"/);
  assert.match(read('FairyGUI/Extensions/TextMeshPro/TMPFont.cs'), /this\.shader = "FairyGUI\/TextMeshPro\/Distance Field";/);
  assert.match(read('FairyGUI/Extensions/TextMeshPro/TMPFont.cs'), /ToggleKeyword\("UNDERLAY_ON", true\)/);
  for (const [file, keywords] of [['FairyGUI-TMP', '[]'], ['FairyGUI-TMP-Underlay', '\n  - UNDERLAY_ON']]) {
    const mat = read(`Runtime/Resources/LGUI/${file}.mat`);
    assert.match(mat, new RegExp(`m_Shader: \\{fileID: 4800000, guid: ${shaderGuid}, type: 3\\}`));
    assert.ok(mat.includes(`m_ValidKeywords:${keywords === '[]' ? ' []' : keywords}\n`), file);
    assert.match(read(`Runtime/Resources/LGUI/${file}.mat.meta`), /mainObjectFileID: 2100000/);
  }
  for (const meta of ['Runtime/Resources.meta', 'Runtime/Resources/LGUI.meta']) assert.match(read(meta), /folderAsset: yes/);
});

test('C#：项目字体建动态多图集的 TMP 字体、包成 TMPFont 按名字注册；系统回退字体挂在 fallbackFontAssetTable 上', () => {
  const cs = read('Runtime/Platform/Fonts.cs');
  assert.match(cs, /TMP_FontAsset\.CreateFontAsset\(font, SamplingPointSize, AtlasPadding, GlyphRenderMode\.SDFAA,\s+AtlasSize, AtlasSize, AtlasPopulationMode\.Dynamic, true\)/);
  assert.match(cs, /TMP_FontAsset\.CreateFontAsset\(candidate\[0\], candidate\[1\], SamplingPointSize\)/);
  assert.match(cs, /asset\.fallbackFontAssetTable = new List<TMP_FontAsset> \{ _fallback \}/);
  assert.match(cs, /FontManager\.RegisterFont\(tmp, name\)/);
  // 缺 TMP Settings 时 TMP 建字体会空引用：先查，直接按名字从 Resources 读（不经 TMP_Settings.instance，它在编辑器里会弹导入窗口）
  assert.match(cs, /public static bool TmpSettingsFound\s*\{\s*get \{ return Resources\.Load<TMP_Settings>\("TMP Settings"\) != null; \}/);
  for (const family of ['PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei']) assert.ok(cs.includes(`"${family}"`), family);
});

test('C#：项目字体只向 TMP 查 Regular 字重（普通字用 TMPFont.fontWeight，粗体重设 SetFormat 选的字重、保留 FontStyles.Bold 伪粗体），不改 FairyGUI 文件', () => {
  const cs = read('Runtime/Platform/Fonts.cs');
  assert.match(cs, /var tmp = new ProjectTMPFont\(\);/);
  assert.match(cs, /sealed class ProjectTMPFont : TMPFont/);
  assert.match(cs, /fontWeight = FontWeight\.Regular;/);
  assert.match(cs, /base\.SetFormat\(format, fontSizeScale\);\s+if \(format\.bold\) QueryWeight\.SetValue\(this, FontWeight\.Regular\);/);
  assert.match(cs, /typeof\(TMPFont\)\.GetField\("_fontWeight", BindingFlags\.NonPublic \| BindingFlags\.Instance\)/);
  assert.match(cs, /throw new MissingFieldException/, '字段没了要在注册时报错，不能静默画不出字');
  // 依赖的上游写法（FairyGUI 文件不改；改了这里要红）：默认 Medium、粗体时把查询字重定成 Bold、查字用 _fontWeight、伪粗体看 _style 和 format.bold
  const tmp = read('FairyGUI/Extensions/TextMeshPro/TMPFont.cs');
  for (const line of ['FontWeight _fontWeight;', '_defaultFontWeight = FontWeight.Medium;', 'set { _defaultFontWeight = value; }',
    '_style |= FontStyles.Bold;\n                _fontWeight = FontWeight.Bold;', 'GetCharacterFromFontAsset(ch, _style, _fontWeight)', 'override public void SetFormat(TextFormat format, float fontSizeScale)',
    'if (_format.bold)\n                xScale *= -1;']) assert.ok(tmp.includes(line), line);
});

const draw = (text, bold, fonts) => ({text, bold, width: 10 * [...text].length, vertices: 4 * [...text].length, ms: 1.5, fonts});
const good = {missing: {rejected: true, code: 'LGUI-RT-181', message: '项目字体 Missing 在 Unity 的 Resources 里找不到（Resources/UI/fonts/Missing.ttf 或 .otf）'},
  registered: 'ProjectTMPFont:Noto', atlas: 'Dynamic,True,1', drawnWith: 'ProjectTMPFont:Noto', fallbackName: 'Microsoft YaHei', fallbackCandidates: 'PingFang SC, Microsoft YaHei',
  draws: {first: draw('开始齉', false, ['Noto', 'Microsoft YaHei']), second: draw('齉开始', false, ['Microsoft YaHei', 'Noto']), inFont: draw('开始', false, ['Noto']),
    notInFont: draw('齉', false, ['Microsoft YaHei']), en: draw('Start', false, ['Noto']), boldZh: draw('我们齉', true, ['Noto', 'Microsoft YaHei']), boldEn: draw('BOLD', true, ['Noto'])}};
const withDraw = (key, change) => ({...good, draws: {...good.draws, [key]: {...good.draws[key], ...change}}});

test('tests/unity/fonts 的检查器：对的结果通过，耗时取自排出字的那次；回退字体没出字、注册成了别的字体、找不到字体不报错都不通过', () => {
  const checked = checkFontResult(good);
  assert.equal(checked.firstLayoutMs, 1.5);
  for (const bad of [{registered: 'TMPFont:Noto'}, {registered: 'DynamicFont:Noto'}, {drawnWith: 'DynamicFont:Noto'}, {missing: {rejected: false}}, {atlas: 'Static,False,1'}, {fallbackName: ''}, {draws: undefined}]) {
    assert.throws(() => checkFontResult({...good, ...bad}), undefined, JSON.stringify(bad));
  }
  assert.throws(() => checkFontResult(withDraw('notInFont', {fonts: ['Noto']})), /系统回退字体出/);
  assert.throws(() => checkFontResult(withDraw('notInFont', {fonts: []})));
  assert.throws(() => checkFontResult(withDraw('first', {fonts: ['Noto']})), /同时用到/);
});

test('tests/unity/fonts 的检查器：字宽 0 或顶点不够（Windows 上 0.4.1 文字全不显示的样子）不通过，普通、粗体、中文、英文每段都查', () => {
  for (const key of ['first', 'second', 'inFont', 'notInFont', 'en', 'boldZh', 'boldEn']) {
    assert.throws(() => checkFontResult(withDraw(key, {width: 0, vertices: 0})), /字宽是 0/, key);
    assert.throws(() => checkFontResult(withDraw(key, {vertices: 0})), /个顶点/, key);
    assert.throws(() => checkFontResult(withDraw(key, {vertices: 4 * [...good.draws[key].text].length - 4})), /有字没画出来/, key);
  }
  const {draws: {boldEn: _boldEn, ...rest}} = good;
  assert.throws(() => checkFontResult({...good, draws: rest}), /缺少 draws\.boldEn/);
  assert.throws(() => checkFontResult(withDraw('boldEn', {bold: false})), /粗体/);
});

test('tests/unity/fonts 的探针只读 FairyGUI 实际排版和网格，不另外向 TMP 查字（Regular 辅助查询会把字从别的路径加进图集）', () => {
  const metrics = fs.readFileSync(fileURLToPath(new URL('../../unity/fonts/FontProbeMetrics.cs', import.meta.url)), 'utf8');
  const probe = fs.readFileSync(fileURLToPath(new URL('../../unity/fonts/probe.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(metrics, /TMP_FontAssetUtilities|HasCharacter|TryAddCharacters|GetCharacterFromFontAsset/);
  assert.match(metrics, /text\.Redraw\(\);/);
  assert.doesNotMatch(probe, /ServedBy|LayoutMs/);
  for (const key of ['first', 'second', 'inFont', 'notInFont', 'en', 'boldZh', 'boldEn']) assert.match(probe, new RegExp(`\\b${key}: draw\\(`), key);
  assert.ok(probe.indexOf('first: draw(') < probe.indexOf('metrics.DrawnWith('), '第一次排版在任何别的读数之前');
});
