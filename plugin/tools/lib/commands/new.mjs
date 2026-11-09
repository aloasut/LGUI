// lgui new view <包>/<组件> --pattern <模式>：按排布模式一次生成横竖两版组件（登记进 package.xml），再在 src/modules/ 下生成 View 骨架。
// lgui new module <名字> [--pattern <模式>]：生成 Model、Controller、测试的骨架；带 --pattern 时连界面和 View 一起生成。
// 目标已存在时报错，不覆盖。
import fs from 'node:fs';
import path from 'node:path';
import {LgCliError} from '../errors.mjs';
import {templatesDir} from '../paths.mjs';
import {readUiModel, findComponent} from '../generate/model.mjs';
import {uiProjectPath} from '../generate/index.mjs';
import {extractTexts, readTable} from '../generate/i18n.mjs';

export const PATTERNS = ['split', 'tabs', 'grid', 'dialog'];
const LIST_PATTERNS = ['split', 'grid'];
const read = rel => fs.readFileSync(path.join(templatesDir, rel), 'utf8');
// 排布模式自己有这个模板就用它（比如 tabs 的 Model 多了标签页），没有就用 module/ 里的通用模板。
const moduleTemplate = (pattern, name) => pattern && fs.existsSync(path.join(templatesDir, 'patterns', pattern, name)) ? `patterns/${pattern}/${name}` : `module/${name}`;
const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in vars ? vars[key] : all));

function checkPattern(pattern) {
  if (!PATTERNS.includes(pattern)) throw new LgCliError('LGUI-CLI-090', `没有排布模式 ${pattern ?? '（没写 --pattern）'}。`, {fix: `能用的：${PATTERNS.join('、')}（UI 开发规范第 7.4 节）。`});
}

function ensureFree(files) {
  const taken = files.filter(f => fs.existsSync(f));
  if (taken.length) throw new LgCliError('LGUI-CLI-091', `这些文件已经存在，不会覆盖：${taken.join('、')}。`, {fix: '换一个名字，或者先删掉旧文件。'});
}

// 8 位 ID：名字的前 4 个字母（小写）加 4 位数字，跳过已经用过的。
function newId(seed, used) {
  const base = (seed.toLowerCase().replace(/[^a-z0-9]/g, '') + 'xxxx').slice(0, 4);
  for (let n = 1; ; n++) {
    const id = base + String(n).padStart(4, '0');
    if (!used.has(id)) { used.add(id); return id; }
  }
}

/** 生成横竖两版组件（列表模式还有子项组件），登记进 package.xml。 */
function writeUi(root, pkg, comp, pattern) {
  const model = readUiModel(uiProjectPath(root));
  const common = findComponent(model, 'Common/Button');
  if (!common) throw new LgCliError('LGUI-CLI-092', '工程里没有 Common/Button，排布模式要用它。', {fix: '用 lgui init 生成的 Common 包，不要删。'});
  const pkgDir = path.join(root, 'ui', 'assets', pkg);
  const descriptor = path.join(pkgDir, 'package.xml');
  const existing = model.packages.find(p => p.name === pkg);
  const pkgIds = new Set(model.packages.map(p => p.id));
  const resIds = new Set(existing ? existing.resources.map(r => r.id) : []);
  const pkgId = existing ? existing.id : newId(pkg, pkgIds);
  const files = [path.join(pkgDir, `${comp}.xml`), path.join(pkgDir, `${comp}@portrait.xml`)];
  const withItem = LIST_PATTERNS.includes(pattern);
  if (withItem) files.push(path.join(pkgDir, `${comp}Item.xml`));
  ensureFree(files);
  const ids = {COMPID: newId(comp, resIds), PORTRAITID: newId(comp, resIds), ITEMID: withItem ? newId(comp + 'Item', resIds) : ''};
  const vars = {...ids, PKGID: pkgId, COMMONID: common.pkg.id, BUTTONID: common.id};
  fs.mkdirSync(pkgDir, {recursive: true});
  fs.writeFileSync(files[0], fill(read(`patterns/${pattern}/landscape.xml`), vars));
  fs.writeFileSync(files[1], fill(read(`patterns/${pattern}/portrait.xml`), vars));
  if (withItem) fs.writeFileSync(files[2], fill(read(`patterns/${pattern}/item.xml`), vars));
  const entries = [`    <component id="${ids.COMPID}" name="${comp}.xml" path="/" exported="true"/>`, `    <component id="${ids.PORTRAITID}" name="${comp}@portrait.xml" path="/" exported="true"/>`];
  if (withItem) entries.push(`    <component id="${ids.ITEMID}" name="${comp}Item.xml" path="/" exported="true"/>`);
  if (existing) fs.writeFileSync(descriptor, fs.readFileSync(descriptor, 'utf8').replace(/(\s*)<\/resources>/, `\n${entries.join('\n')}$1</resources>`));
  // 新包按编辑器保存的格式写（带空的 <publish>），编辑器第一次保存时不会再改这个文件
  else fs.writeFileSync(descriptor, `<?xml version="1.0" encoding="utf-8"?>\n<packageDescription id="${pkgId}">\n  <resources>\n${entries.join('\n')}\n  </resources>\n  <publish name="${pkg}">\n  </publish>\n</packageDescription>\n`);
  return files;
}

/** 把新界面里的固定文字、生成的代码用到的文本键（extra：键 → 原文）补进每种语言的文本表：默认语言写原文；其他语言先填原文，提醒去翻译。 */
function addTexts(root, project, extra = {}) {
  const entries = [...extractTexts(readUiModel(uiProjectPath(root))), ...Object.entries(extra).map(([key, text]) => ({key, text}))];
  const pending = [];
  for (const language of project.languages) {
    const table = readTable(root, language);
    let changed = false;
    for (const e of entries) if (!(e.key in table)) { table[e.key] = e.text; changed = true; if (language !== project.defaultLanguage) pending.push(`${language}: ${e.key}`); }
    if (changed) fs.writeFileSync(path.join(root, 'i18n', `${language}.json`), JSON.stringify(table, null, 2) + '\n');
  }
  return pending;
}

const names = (raw) => {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(raw ?? '')) throw new LgCliError('LGUI-CLI-093', `模块名 ${raw ?? '（没写）'} 不合规范。`, {fix: '用小写开头的英文名，比如 shop、bag。'});
  const NAME = raw[0].toUpperCase() + raw.slice(1);
  return {feature: raw.toLowerCase(), NAME, model: `${raw}Model`, controller: `${raw}Controller`};
};

export async function newView({projectRoot, project, args, flags}) {
  const m = /^([A-Z][A-Za-z0-9]*)\/([A-Z][A-Za-z0-9]*)$/.exec(args[0] ?? '');
  if (!m) throw new LgCliError('LGUI-CLI-093', `${args[0] ?? '（没写）'} 不是「包/组件」的写法。`, {fix: '写成 lgui new view Shop/ShopPanel --pattern tabs。'});
  checkPattern(flags.pattern);
  const [, pkg, comp] = m;
  const feature = pkg.toLowerCase();
  const viewFile = path.join(projectRoot, 'src', 'modules', feature, `${comp}View.ts`);
  const itemFile = path.join(projectRoot, 'src', 'modules', feature, `${comp}ItemView.ts`);
  const tsFiles = LIST_PATTERNS.includes(flags.pattern) ? [viewFile, itemFile] : [viewFile];
  ensureFree(tsFiles);
  const uiFiles = writeUi(projectRoot, pkg, comp, flags.pattern);
  const layer = flags.pattern === 'dialog' ? "'popup' as const" : "'page' as const";
  fs.mkdirSync(path.dirname(viewFile), {recursive: true});
  fs.writeFileSync(viewFile, `import { View } from 'lgui';
import type { Bind, Keys } from 'lgui';
import type { ${comp}UI } from 'lgui/ui';

export class ${comp}View extends View<${comp}UI> {
  static component = '${pkg}/${comp}';
  static layer = ${layer};${flags.pattern === 'dialog' ? '' : '\n  static fullScreen = true;'}

  // 在这里写绑定表：控件名用 lgui ui list 查，写法见 mvc-spec.md 第 6 节。动作只调用 Controller 的方法。
  bind: Bind<${comp}UI> = {};
  keys: Keys = { back: 'close' };
}
`);
  if (tsFiles.length > 1) fs.writeFileSync(itemFile, `import { ItemView } from 'lgui';
import type { ItemBind } from 'lgui';
import type { ${comp}ItemUI } from 'lgui/ui';

// 列表子项。第二个类型参数换成这一项的数据类型。
export class ${comp}ItemView extends ItemView<${comp}ItemUI, { label: string }> {
  static component = '${pkg}/${comp}Item';

  bind: ItemBind<${comp}ItemUI, { label: string }> = {
    label: { text: it => it.label },
  };
}
`);
  const pending = addTexts(projectRoot, project);
  const rel = f => path.relative(projectRoot, f).split(path.sep).join('/');
  return {
    data: {ui: uiFiles.map(rel), code: tsFiles.map(rel), translate: pending},
    summary: [`按排布模式 ${flags.pattern} 生成了 ${pkg}/${comp}（横版和 @portrait 竖版）：`, ...[...uiFiles, ...tsFiles].map(f => `  ${rel(f)}`), ...(pending.length ? [`新界面的固定文字已经补进文本表，其他语言先填的是原文，记得翻译（${pending.length} 条）。`] : []), '接着：lgui check → lgui dev → lgui verify。']
  };
}

export async function newModule({projectRoot, project, args, flags}) {
  const n = names(args[0]);
  if (flags.pattern !== undefined) checkPattern(flags.pattern);
  const dir = path.join(projectRoot, 'src', 'modules', n.feature);
  const pattern = flags.pattern;
  const comp = pattern === 'dialog' ? `${n.NAME}Dialog` : `${n.NAME}Panel`;
  const files = {
    model: path.join(dir, `${n.NAME}Model.ts`),
    controller: path.join(dir, `${n.NAME}Controller.ts`),
    test: path.join(projectRoot, 'tests', `${n.feature}.test.ts`)
  };
  if (pattern) {
    files.view = path.join(dir, `${comp}View.ts`);
    if (LIST_PATTERNS.includes(pattern)) files.item = path.join(dir, `${comp}ItemView.ts`);
  }
  ensureFree(Object.values(files));
  const vars = {...n, PKG: n.NAME, COMP: comp};
  const uiFiles = pattern ? writeUi(projectRoot, n.NAME, comp, pattern) : [];
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(files.model, fill(read(moduleTemplate(pattern, 'model.ts')), vars));
  const viewMethods = !pattern ? '' : pattern === 'dialog'
    ? `  confirm() { lgui.ui.close(${comp}View); }\n  close() { lgui.ui.close(${comp}View); }\n`
    : `  close() { lgui.ui.close(${comp}View); }\n`;
  fs.writeFileSync(files.controller, fill(read(moduleTemplate(pattern, 'controller.ts')), {...vars, LGUI_IMPORT: pattern ? ', lgui' : '', VIEW_IMPORT: pattern ? `import { ${comp}View } from './${comp}View';\n` : '', VIEW_METHODS: viewMethods}));
  if (pattern) {
    fs.writeFileSync(files.view, fill(read(`patterns/${pattern}/view.ts`), vars));
    if (files.item) fs.writeFileSync(files.item, fill(read(`patterns/${pattern}/item-view.ts`), vars));
    fs.writeFileSync(files.test, fill(read(`patterns/${pattern}/test.ts`), vars));
  } else {
    fs.writeFileSync(files.test, fill(read('module/model-test.ts'), vars));
  }
  // 生成的代码里用到的文本键（patterns/<模式>/texts.json）
  const texts = pattern && fs.existsSync(path.join(templatesDir, 'patterns', pattern, 'texts.json')) ? JSON.parse(fill(read(`patterns/${pattern}/texts.json`), vars)) : {};
  const pending = pattern ? addTexts(projectRoot, project, texts) : [];
  const rel = f => path.relative(projectRoot, f).split(path.sep).join('/');
  return {
    data: {code: Object.values(files).map(rel), ui: uiFiles.map(rel), translate: pending},
    summary: [`生成了模块 ${n.feature}${pattern ? `（排布模式 ${pattern}）` : ''}：`, ...[...Object.values(files), ...uiFiles].map(f => `  ${rel(f)}`), ...(pattern ? [] : ['没有界面：要界面就再运行 lgui new view <包>/<组件> --pattern <模式>，或者用 lgui new module <名字> --pattern <模式> 一次生成。']), ...(pending.length ? [`新界面的固定文字已经补进文本表，其他语言先填的是原文，记得翻译（${pending.length} 条）。`] : []), ...(pattern ? [`要它做第一个界面：src/main.ts 的 start() 里改成打开 ${comp}View，它的 keys 改成 { back: 'none' }（page 层最底下的主界面返回键关不掉）；不要的 Main 模块连同 ui/assets/Main/ 一起删掉，再运行 lgui check。`] : []), '接着：lgui check → lgui test → lgui dev。']
  };
}
