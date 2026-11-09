// 项目字体：ui/fonts/<名字>.ttf 或 .otf，文件名就是字体名（defaultFont、XML 的 font、富文本的 [font=…] 都写这个名字）。
// 生成时按项目实际用到的文字做子集：网页出 WOFF2，Unity 出和原文件同格式的 TTF / OTF，写到 <输出目录>/<名字>.<扩展名>。
//
// 字集（每个字体一样）：ASCII 可见字符 + ui/ 的 XML 里写的全部文字 + i18n/ 里全部语言的文案 + 框架自己显示的固定文字
// （framework/mvc/fixed-text.ts，按工程 languages）。字体里本来就没有的字不收。
// 缺字（LGUI-CLI-141）：ui/ 里的每段固定文字按显示它的那个文字控件的字体查（文字控件自己写的 font；按钮、标签、下拉框、
// 列表项的标题看它组件里名为 title 的文字控件写的 font；没写就是默认字体）。i18n/ 里和 ui/ 文字同键的翻译跟着那个控件的字体，
// 其余文案和框架的固定文字查默认字体。运行时才知道的文字（玩家名、服务器数据）不查，缺的字由浏览器 / Unity 按字回退到系统字体。
// 工具：字符表和表目录自己读（不经 WASM，用完就没有残留）；harfbuzz-subset.wasm（HarfBuzz）做子集，用完逐个释放；
// wawoff2（Google woff2 的 WASM 版）压 WOFF2。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {LgCliError, LgCliErrors} from '../errors.mjs';
import {frameworkDir} from '../paths.mjs';
import {harfbuzzSubsetWasm, woff2} from '../vendor.mjs';
import {readTable} from './i18n.mjs';

const FONT_NAME = /^[A-Z][A-Za-z0-9]*$/;
const FONT_EXT = /\.(ttf|otf)$/i;
const UNSUPPORTED = /\.(ttc|otc|woff2?|eot|fnt)$/i;
// FairyGUI 网页端把字体名不加引号写进 CSS 的 font-family（vendor/fairygui.module.js 的 applyFormat、舞台样式），
// Shrink 补丁量宽时也一样：名字是 CSS 的通用字体名或关键字时，浏览器按系统字体画，不报错。这些名字不能用（不分大小写）。
const CSS_RESERVED = ['serif', 'monospace', 'cursive', 'fantasy', 'math', 'emoji', 'fangsong', 'inherit', 'initial', 'unset', 'default', 'revert'];
const HB_SUBSET_FLAGS_NO_HINTING = 1;
const HB_MEMORY_MODE_WRITABLE = 2;
const MAX_LISTED = 20;
const TEXT_TAGS = ['text', 'richtext', 'inputtext'];

export const fontsDir = root => path.join(root, 'ui', 'fonts');
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** ui/fonts/ 里的字体：[{ name, file, ext }]，按名字排好。文件名不合规、格式不支持报 LGUI-CLI-140（一次全部报出）。别的文件（许可说明之类）不管。 */
export function listFonts(root) {
  const dir = fontsDir(root);
  if (!fs.existsSync(dir)) return [];
  const fonts = [];
  const errors = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    if (UNSUPPORTED.test(entry.name)) {
      errors.push(new LgCliError('LGUI-CLI-140', `ui/fonts/${entry.name} 的格式不支持：项目字体只收单个字体的 TTF 或 OTF。`, {file: rel(root, file), fix: '换成 .ttf 或 .otf 文件（字体集 TTC 先拆出要用的那一个；WOFF / WOFF2 用原始的 TTF / OTF，生成时会自己压缩）。'}));
      continue;
    }
    if (!FONT_EXT.test(entry.name)) continue;
    const name = entry.name.replace(FONT_EXT, '');
    if (!FONT_NAME.test(name)) {
      errors.push(new LgCliError('LGUI-CLI-140', `ui/fonts/${entry.name} 的文件名不能当字体名：要以大写字母开头，只用字母和数字。`, {file: rel(root, file), fix: `改名，比如 ${name.replace(/[^A-Za-z0-9]/g, '').replace(/^[^A-Za-z]*/, '').replace(/^./, c => c.toUpperCase()) || 'MyFont'}${path.extname(entry.name).toLowerCase()}；文件名（去掉扩展名）就是在 defaultFont 和 XML 的 font 里写的名字。`}));
      continue;
    }
    if (CSS_RESERVED.includes(name.toLowerCase())) {
      errors.push(new LgCliError('LGUI-CLI-140', `ui/fonts/${entry.name} 的字体名 ${name} 和 CSS 的通用字体名或关键字 ${name.toLowerCase()} 撞名：网页上会按系统字体画。`, {file: rel(root, file), fix: `改一个名字，比如 ${name}Font${path.extname(entry.name).toLowerCase()}。不能用的名字：${CSS_RESERVED.join('、')}（不分大小写）。`}));
      continue;
    }
    if (fonts.some(f => f.name === name)) {
      errors.push(new LgCliError('LGUI-CLI-140', `ui/fonts/ 里有两个都叫 ${name} 的字体文件。`, {file: rel(root, file), fix: '只留一个，或者给其中一个改名。'}));
      continue;
    }
    fonts.push({name, file, ext: path.extname(entry.name).toLowerCase()});
  }
  if (errors.length) throw new LgCliErrors(errors);
  return fonts.sort((a, b) => a.name < b.name ? -1 : 1);
}

/** 工程配置的 defaultFont 不是项目字体时的报错（LGUI-CLI-142）；没问题返回 null。defaultFont 是 null 照旧可以。 */
export function defaultFontProblem(project, names) {
  if (project.defaultFont === null || names.includes(project.defaultFont)) return null;
  return new LgCliError('LGUI-CLI-142', `工程配置的 defaultFont 是 ${JSON.stringify(project.defaultFont)}，ui/fonts/ 里没有这个字体${names.length ? `（有：${names.join('、')}）` : '（现在一个字体都没有）'}。`, {
    file: '.lgui/project.json',
    fix: `把字体文件放到 ui/fonts/${project.defaultFont}.ttf（或 .otf），或者把 defaultFont 改成 ${names.length ? names.join('、') + ' 之一，或者 ' : ''}null（用系统默认字体）。系统字体名各平台不一样，不能写。`
  });
}

// 一个字：用 for…of 按码点拆，跳过控制字符。
const glyphChars = text => [...text].filter(ch => ch.codePointAt(0) >= 0x20 && ch.codePointAt(0) !== 0x7f);

/**
 * 读 TTF / OTF 的表目录和字符表（cmap）：{ tables: Set<表名>, unicodes: Set<码点> }。和 HarfBuzz 一样挑一个 Unicode 子表，
 * 认格式 4、12（格式 13 是给「每个字都画同一个框」这类兜底字体用的，不收）；码点映射到 0 号字形（.notdef）的不算。读不了时抛 Error（说明原因）。tests/unit/fonts.test.mjs 拿它和 HarfBuzz 对过。
 */
export function readSfnt(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (offset, size) => { if (offset < 0 || offset + size > bytes.length) throw new Error('文件被截断了，或者表的位置不对'); };
  need(0, 12);
  const count = view.getUint16(4);
  need(12, count * 16);
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(...bytes.subarray(at, at + 4)), {offset: view.getUint32(at + 8), length: view.getUint32(at + 12)});
  }
  const cmap = tables.get('cmap');
  if (!cmap) throw new Error('没有字符表（cmap）');
  need(cmap.offset, 4);
  const unicodes = new Set();
  const subtables = view.getUint16(cmap.offset + 2);
  need(cmap.offset + 4, subtables * 8);
  // 和 HarfBuzz 一样只用一个子表，按这个顺序挑第一个有的：32 位的 (3,10) (0,6) (0,4)，16 位的 (3,1) (0,3) (0,2) (0,1) (0,0)
  const records = Array.from({length: subtables}, (_, i) => {
    const at = cmap.offset + 4 + i * 8;
    return {key: `${view.getUint16(at)},${view.getUint16(at + 2)}`, offset: cmap.offset + view.getUint32(at + 4)};
  });
  const best = ['3,10', '0,6', '0,4', '3,1', '0,3', '0,2', '0,1', '0,0'].map(key => records.find(r => r.key === key)).find(Boolean);
  if (!best) throw new Error('没有 Unicode 字符表');
  const sub = best.offset;
  need(sub, 2);
  const format = view.getUint16(sub);
  if (format === 4) {
    need(sub, 14);
    const segments = view.getUint16(sub + 6) / 2;
    const ends = sub + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
    need(ends, segments * 8 + 2);
    for (let s = 0; s < segments; s++) {
      const end = view.getUint16(ends + s * 2), start = view.getUint16(starts + s * 2), delta = view.getUint16(deltas + s * 2), range = view.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph;
        if (range === 0) glyph = (c + delta) & 0xffff;
        else {
          const g = ranges + s * 2 + range + (c - start) * 2;
          need(g, 2);
          glyph = view.getUint16(g);
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) unicodes.add(c);
      }
    }
  } else if (format === 12) {
    need(sub, 16);
    const groups = view.getUint32(sub + 12);
    need(sub + 16, groups * 12);
    for (let g = 0; g < groups; g++) {
      const at = sub + 16 + g * 12;
      const start = view.getUint32(at), end = view.getUint32(at + 4), first = view.getUint32(at + 8);
      if (end > 0x10ffff || end < start) throw new Error('字符表里的码点范围不对');
      for (let c = start; c <= end; c++) if (first + (c - start)) unicodes.add(c);
    }
  } else {
    throw new Error(`字符表是格式 ${format}，不认识`);
  }
  return {tables: new Set(tables.keys()), unicodes};
}

// 读字体文件：格式、是不是可变字体、有哪些字。
function inspect(root, font) {
  const bytes = fs.readFileSync(font.file);
  const where = {file: rel(root, font.file)};
  const name = `ui/fonts/${path.basename(font.file)}`;
  const tag = bytes.length >= 4 ? bytes.subarray(0, 4).toString('latin1') : '';
  if (tag === 'ttcf') throw new LgCliError('LGUI-CLI-140', `${name} 是字体集（TTC），不是单个字体。`, {...where, fix: '换成单个字体的 TTF 或 OTF 文件。'});
  if (!(tag === 'OTTO' || tag === 'true' || tag === '\0\x01\0\0')) throw new LgCliError('LGUI-CLI-140', `${name} 不是 TTF / OTF 字体文件（${bytes.length < 4 ? `只有 ${bytes.length} 字节` : '内容开头不对'}）。`, {...where, fix: '换成能用的 TTF 或 OTF 字体文件。'});
  let sfnt;
  try { sfnt = readSfnt(bytes); } catch (error) { throw new LgCliError('LGUI-CLI-140', `${name} 读不出字符表：${error.message}。`, {...where, fix: '换成能用的 TTF 或 OTF 字体文件。'}); }
  if (sfnt.tables.has('fvar')) throw new LgCliError('LGUI-CLI-140', `${name} 是可变字体，项目字体只收单字重的字体。`, {...where, fix: '换成单字重的文件（下载的字体包里一般在 static/ 目录下，比如 NotoSansSC-Regular.ttf）；要粗体就再放一个粗体文件当另一个字体用。'});
  if (!sfnt.unicodes.size) throw new LgCliError('LGUI-CLI-140', `${name} 的字符表是空的，用不了。`, {...where, fix: '换成能用的 TTF 或 OTF 字体文件。'});
  return {bytes, unicodes: sfnt.unicodes};
}

/**
 * 一个控件显示的文字用哪个字体：文字控件看自己的 font；组件实例（按钮、标签、下拉框）和列表项看那个组件里名为 title 的文字控件的 font。
 * 返回字体名，null 是默认字体。
 */
function fontOf(node, ref) {
  if (TEXT_TAGS.includes(node.tag)) return node.attrs.font || null;
  const title = ref?.children.find(child => child.name === 'title' && TEXT_TAGS.includes(child.tag));
  return title?.attrs.font || null;
}

/** 一个控件在 ui/ 里写的、会显示出来的固定文字：[文字, 说明]。 */
function shownTexts(child) {
  const out = [];
  const push = (text, what) => { if (text) out.push([String(text), what]); };
  if (TEXT_TAGS.includes(child.tag)) { push(child.attrs.text, ''); push(child.attrs.prompt, ' 的 prompt'); }
  for (const node of child.children ?? []) {
    if (['Button', 'Label'].includes(node.tag)) { push(node.attrs.title, ' 的 title'); push(node.attrs.selectedTitle, ' 的 selectedTitle'); }
    if (node.tag === 'ComboBox') { push(node.attrs.title, ' 的 title'); node.children.filter(n => n.tag === 'item').forEach((item, j) => push(item.attrs.title, ` 的第 ${j + 1} 项`)); }
    if (node.tag === 'item') push(node.attrs.title, ' 的列表项');
    if (node.tag === 'gearText') { for (const value of String(node.attrs.values ?? '').split('|')) push(value, ' 的 gearText'); push(node.attrs.default, ' 的 gearText'); }
  }
  return out;
}

/** 字集：字 → 第一次出现的位置（给缺字报错用）。required：字体名（null 表示默认字体）→ 这个字体必须有的字。 */
export async function collectChars(root, project, model) {
  const all = new Map();
  const required = new Map();
  const add = (text, where, font) => {
    for (const ch of glyphChars(text ?? '')) {
      if (!all.has(ch)) all.set(ch, where);
      if (font === undefined) continue;
      if (!required.has(font)) required.set(font, new Map());
      if (!required.get(font).has(ch)) required.get(font).set(ch, where);
    }
  };
  for (let cp = 0x20; cp < 0x7f; cp++) add(String.fromCodePoint(cp), 'ASCII');
  // ui/ 的 XML：全部属性值里的字都收进字集；会显示出来的固定文字按显示它的控件的字体查。
  const keyFont = new Map(); // ui/ 文字的键（和 i18n/ 的键一样：<包>/<组件>/<控件名>）→ 字体（null 是默认字体）
  for (const pkg of model.packages) {
    for (const component of pkg.components) {
      const file = rel(root, component.file);
      const visit = node => {
        for (const value of Object.values(node.attrs ?? {})) add(String(value), file);
        for (const child of node.children ?? []) visit(child);
      };
      for (const child of component.children) {
        visit(child);
        const font = fontOf(child, child.ref);
        if (child.name) keyFont.set(`${pkg.name}/${component.name.replace(/@portrait$/, '')}/${child.name}`, font);
        const at = `${file}${child.line ? `:${child.line}` : ''} ${child.name ?? child.id}`;
        for (const [text, what] of shownTexts(child)) add(text, at + what, font);
      }
    }
  }
  // i18n/：全部语言的全部文案（按数量分开写的每一种也算）。ui/ 文字的翻译（<包>/<组件>/<控件名>，带 @prompt、@item<j> 的也算）跟着那个控件的字体，其余要默认字体有。
  for (const language of project.languages) {
    const table = readTable(root, language);
    for (const [key, value] of Object.entries(table)) {
      const font = keyFont.get(key.replace(/@(prompt|item\d+)$/, '')) ?? null;
      for (const text of typeof value === 'string' ? [value] : Object.values(value ?? {})) add(String(text), `i18n/${language}.json ${key}`, font);
    }
  }
  // 框架自己显示的固定文字（format.compact 的单位等），按工程的语言。
  const {fixedText} = await import(pathToFileURL(path.join(frameworkDir, 'mvc', 'fixed-text.ts')).href);
  for (const language of project.languages) for (const [source, text] of fixedText(language)) add(text, `${source}（${language}）`, null);
  return {all, required};
}

/** 查项目字体：文件、defaultFont、缺字。返回 { fonts: [{ name, file, ext, bytes, unicodes }], chars }；有问题一次全部报出（LgCliErrors）。 */
export async function checkFonts(root, project, model) {
  const fonts = listFonts(root);
  const errors = [];
  const problem = defaultFontProblem(project, fonts.map(f => f.name));
  if (problem) errors.push(problem);
  const loaded = [];
  for (const font of fonts) {
    try { loaded.push({...font, ...inspect(root, font)}); } catch (error) { errors.push(error); }
  }
  const {all, required} = await collectChars(root, project, model);
  for (const [fontName, chars] of required) {
    const name = fontName ?? project.defaultFont;
    const font = loaded.find(f => f.name === name);
    if (!font) continue; // 默认字体是 null（系统字体）、字体文件有问题、XML 的 font 写错（lgui check 报 LGUI-UI-080）
    const missing = [...chars].filter(([ch]) => !font.unicodes.has(ch.codePointAt(0)));
    if (!missing.length) continue;
    const listed = missing.slice(0, MAX_LISTED).map(([ch, where]) => `「${ch}」（U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}，${where}）`).join('、');
    errors.push(new LgCliError('LGUI-CLI-141', `字体 ${name}（ui/fonts/${path.basename(font.file)}）没有这 ${missing.length} 个字：${listed}${missing.length > MAX_LISTED ? ' ……' : ''}。这些字会换成系统字体显示。`, {
      file: rel(root, font.file),
      fix: '换一个有这些字的字体（多语言工程的默认字体要覆盖所有语言）；表情符号这类字体里没有的字改用图片或 ArtText；写错的字改掉。'
    }));
  }
  if (errors.length) throw new LgCliErrors(errors);
  return {fonts: loaded, chars: all};
}

let subsetExports = null;
async function subsetModule() {
  if (!subsetExports) {
    const {instance} = await WebAssembly.instantiate(fs.readFileSync(harfbuzzSubsetWasm()));
    instance.exports._initialize?.();
    subsetExports = instance.exports;
  }
  return subsetExports;
}

/** 按码点做子集，去掉 hinting；返回和原文件同格式（TTF / OTF）的字节。 */
export async function subsetFont(bytes, codepoints) {
  const hb = await subsetModule();
  const fontPtr = hb.malloc(bytes.length);
  new Uint8Array(hb.memory.buffer).set(bytes, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, bytes.length, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error('hb_subset_input_create_or_fail 失败');
    hb.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NO_HINTING);
    const set = hb.hb_subset_input_unicode_set(input);
    for (const cp of codepoints) hb.hb_set_add(set, cp);
    const result = hb.hb_subset_or_fail(face, input);
    if (!result) throw new Error('hb_subset_or_fail 失败');
    const out = hb.hb_face_reference_blob(result);
    const data = hb.hb_blob_get_data(out, 0);
    const length = hb.hb_blob_get_length(out);
    const copy = new Uint8Array(hb.memory.buffer).slice(data, data + length);
    hb.hb_blob_destroy(out);
    hb.hb_face_destroy(result);
    return copy;
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
}

/**
 * 生成项目字体的子集，写到 outDir/<名字>.woff2（format 'woff2'，网页）或 outDir/<名字>.ttf|.otf（format 'sfnt'，Unity）。
 * 没有项目字体时不建目录。返回字体名（按名字排好），生成的启动入口把它传给 backend.init 的 fonts。
 */
export async function generateFonts(root, project, model, outDir, format) {
  const {fonts, chars} = await checkFonts(root, project, model);
  fs.rmSync(outDir, {recursive: true, force: true});
  if (!fonts.length) return [];
  fs.mkdirSync(outDir, {recursive: true});
  const codepoints = [...chars.keys()].map(ch => ch.codePointAt(0));
  for (const font of fonts) {
    let bytes;
    try {
      bytes = await subsetFont(font.bytes, codepoints.filter(cp => font.unicodes.has(cp)));
      if (format === 'woff2') bytes = await woff2()(bytes);
    } catch (error) {
      throw new LgCliError('LGUI-CLI-140', `字体 ${font.name}（ui/fonts/${path.basename(font.file)}）做子集失败：${error.message}`, {file: rel(root, font.file), fix: '换一个能用的 TTF 或 OTF 字体文件；还不行就把这个字体文件和输出报告给维护者。'});
    }
    fs.writeFileSync(path.join(outDir, `${font.name}${format === 'woff2' ? '.woff2' : font.ext}`), bytes);
  }
  return fonts.map(f => f.name);
}

/** 只要字体名（生成启动入口、headless 用）；文件名不合规时报 LGUI-CLI-140。 */
export const fontNames = root => listFonts(root).map(f => f.name);
