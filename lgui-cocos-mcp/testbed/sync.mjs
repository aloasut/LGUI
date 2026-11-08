// 包同步（dev 脚本，不进发布面）：把 LGUI 的产物灌进 testbed 的 Cocos 工程。
// 用法：node sync.mjs  ——每次 ui/、框架或工程配置变了都要跑。
// 灌四样：界面包（generateCocos → assets/lgui-ui/<包名>/）、翻译（<out>/i18n/<语言>.xml）、
// 框架副本（assets/lgui-framework/，同 examples 的 .lgui/framework）、启动配置（assets/scripts/lgui-config.ts，生成不手改）。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const testbed = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(testbed, '..', '..');
const load = rel => import(pathToFileURL(path.join(repo, 'plugin', 'tools', 'lib', rel)));

const {generateCocos, generateProjectTypes, uiProjectPath} = await load('generate/index.mjs');
const {generateTranslations} = await load('generate/i18n.mjs');
const {readUiModel} = await load('generate/model.mjs');

const projectRoot = path.join(repo, 'examples', 'inventory');
const project = JSON.parse(fs.readFileSync(path.join(projectRoot, '.lgui', 'project.json'), 'utf8'));
const uiRoot = path.join(testbed, 'assets', 'lgui-ui');

const ui = await generateCocos(uiProjectPath(projectRoot), uiRoot);
console.log(`界面包：${ui.files.length} 个文件 → assets/lgui-ui/`);

const {model, deps} = await generateProjectTypes(projectRoot);
generateTranslations(projectRoot, model, project.languages, path.join(uiRoot, 'i18n'), project.defaultLanguage);
console.log(`翻译：${project.languages.join('、')} → assets/lgui-ui/i18n/`);

// CC 只编译 assets/ 下的文件：只拷 cocos 后端需要的部分（h5 的 vendor .js 会被 CC 当 CJS 报错）。
{
  const frameworkTarget = path.join(testbed, 'assets', 'lgui-framework');
  fs.rmSync(frameworkTarget, {recursive: true, force: true});
  for (const part of ['index.ts', 'env.d.ts', 'core', 'mvc', 'backends/cocos']) {
    fs.cpSync(path.join(repo, 'plugin', 'framework', part), path.join(frameworkTarget, part), {recursive: true});
  }
}
console.log('框架：assets/lgui-framework/');

const components = Object.fromEntries(model.packages.map(pkg => [pkg.name, pkg.components.map(component => component.name)]));
// 与框架 runtimeConfig（bundle.mjs）同构：字段原样透传，另带 defaultFont 给 backend.init。
const config = {
  defaultFont: project.defaultFont,
  ...Object.fromEntries(['name', 'designSize', 'orientation', 'languages', 'defaultLanguage', 'keyMap', 'uiCache', 'requestErrorToast', 'requestTimeoutMs', 'placeholder', 'sounds'].map(key => [key, project[key]]))
};
// 运行时文本表（lgui.t 用）：与 bundle.mjs 的 readTexts 同机制，直接读工程 i18n/*.json。
const texts = Object.fromEntries(project.languages.map(language => [language, JSON.parse(fs.readFileSync(path.join(projectRoot, 'i18n', `${language}.json`), 'utf8'))]));
const generated = `// 由 sync.mjs 生成，不要手改。
export const config = ${JSON.stringify(config, null, 2)};
export const deps = ${JSON.stringify(deps, null, 2)};
export const components = ${JSON.stringify(components, null, 2)};
export const texts = ${JSON.stringify(texts, null, 2)};
`;
fs.writeFileSync(path.join(testbed, 'assets', 'scripts', 'lgui-config.ts'), generated);
console.log('启动配置：assets/scripts/lgui-config.ts');

// ---- conformance 模式（node sync.mjs --conformance）：fixture UI 与用例进 testbed，供 T008 四方快照 ----
if (process.argv.includes('--conformance')) {
  const {conformanceProject} = await import(pathToFileURL(path.join(repo, 'tests', 'conformance', 'runner.mjs')));
  const ctx = await conformanceProject();
  const confUi = path.join(testbed, 'assets', 'conf-ui');
  await generateCocos(uiProjectPath(ctx.root), confUi);
  // 翻译要进 conf-ui bundle（cocos 后端的 setLanguage 从界面包 bundle 里读 i18n/<语言>.xml TextAsset）。
  generateTranslations(ctx.root, readUiModel(uiProjectPath(ctx.root)), ctx.project.languages, path.join(confUi, 'i18n'), ctx.project.defaultLanguage);
  console.log(`conf 界面包：→ assets/conf-ui/（翻译：${ctx.project.languages.join('、')}）`);
  // src/conformance 拷进 assets/conf-src/，'lgui' 别名重写为相对路径（CC 工程没有 esbuild alias）。
  const confSrc = path.join(testbed, 'assets', 'conf-src');
  fs.rmSync(confSrc, {recursive: true, force: true});
  for (const part of ['src', 'conformance']) {
    fs.cpSync(path.join(ctx.root, part), path.join(confSrc, part), {recursive: true, filter: src => !src.includes('node_modules')});
  }
  // 原工程在 conformance/ 里放 src 软链给用例导入用；这里导入已按深度重写，软链删掉。
  fs.rmSync(path.join(confSrc, 'conformance', 'src'), {force: true, recursive: true});
  let rewritten = 0;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      const relFull = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(full, relFull); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const text = fs.readFileSync(full, 'utf8');
      // 深度按文件到 conf-src 根计算：lgui → assets/lgui-framework（再上一层），src → conf-src/src。
      const depth = relFull.split('/').length - 1; // 目录层级（文件名不算一层）
      const toAssets = '../'.repeat(depth + 1);
      const toConfRoot = '../'.repeat(depth);
      const next = text
        .replace(/from 'lgui'/g, `from '${toAssets}lgui-framework/index'`)
        .replace(/from '((?:\.\.\/)+)src\//g, `from '${toConfRoot}src/`);
      if (next !== text) { fs.writeFileSync(full, next); rewritten++; }
    }
  };
  walk(confSrc, '');
  console.log(`conf 源码：assets/conf-src/（重写 ${rewritten} 个文件的 lgui 别名）`);
  // conf-config：fixture 工程的 runtimeConfig 形状 + texts/deps/defaultFont（ConformanceBoot 用）。
  const confConfig = {defaultFont: null, name: ctx.project.name, designSize: ctx.project.designSize, orientation: ctx.project.orientation, languages: ctx.project.languages, defaultLanguage: ctx.project.defaultLanguage, keyMap: {}, deps: ctx.deps, texts: ctx.texts};
  // conf-cases：静态导入每个用例（CC 的 packer 不支持动态 import 变量）。
  const caseNames = fs.readdirSync(path.join(confSrc, 'conformance', 'cases')).filter(f => f.endsWith('.ts')).map(f => f.slice(0, -3)).sort();
  const caseImports = caseNames.map((n, i) => 'import * as c' + i + " from '../conf-src/conformance/cases/" + n + "';").join('\n');
  const caseEntries = caseNames.map((n, i) => JSON.stringify(n) + ': c' + i + '.default');
  const caseMap = 'export const cases = {' + caseEntries.join(', ') + '};';
  fs.writeFileSync(path.join(testbed, 'assets', 'scripts', 'conf-config.ts'), `// 由 sync.mjs 生成，不要手改。\nexport const conf = ${JSON.stringify(confConfig, null, 2)};\n`);
  fs.writeFileSync(path.join(testbed, 'assets', 'scripts', 'conf-cases.ts'), `// 由 sync.mjs 生成，不要手改。\n${caseImports}\n${caseMap}\n`);
  console.log(`conf 配置：conf-config.ts + conf-cases.ts（${caseNames.length} 个用例）`);
  console.log('注意：conformance 工程的 designSize 不同于 inventory，conf 模式页面要按它 applyDesignSize（Boot 里读 lgui-config 的 confDesign）。');
}
