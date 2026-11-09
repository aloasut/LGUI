// 包同步（dev 脚本，不进发布面）：把 examples/inventory 的产物灌进本 CC 工程（决策 004：example 独立工程）。
// 用法：node sync.mjs ——ui/、框架或示例源码变了都要跑。
// 灌六样：界面包（generateCocos → assets/lgui-ui/<包名>/）、翻译（<ui>/i18n/<语言>.xml）、
// 框架副本（assets/lgui-framework/）、生成类型（assets/ui-types/，'lgui/ui' 的落点）、
// 启动配置（assets/scripts/lgui-config.ts，生成不手改）、示例 src（assets/app-src/，别名重写）。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const project = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(project, '..', '..');
const load = rel => import(pathToFileURL(path.join(repo, 'plugin', 'tools', 'lib', rel)));

const {generateCocos, generateProjectTypes, uiProjectPath} = await load('generate/index.mjs');
const {generateTranslations} = await load('generate/i18n.mjs');
const {readUiModel} = await load('generate/model.mjs');

const exampleRoot = path.join(repo, 'examples', 'inventory');
const projectJson = JSON.parse(fs.readFileSync(path.join(exampleRoot, '.lgui', 'project.json'), 'utf8'));
const uiRoot = path.join(project, 'assets', 'lgui-ui');

const ui = await generateCocos(uiProjectPath(exampleRoot), uiRoot);
console.log(`界面包：${ui.files.length} 个文件 → assets/lgui-ui/`);

const {model, deps} = await generateProjectTypes(exampleRoot);
generateTranslations(exampleRoot, model, projectJson.languages, path.join(uiRoot, 'i18n'), projectJson.defaultLanguage);
console.log(`翻译：${projectJson.languages.join('、')} → assets/lgui-ui/i18n/`);

// CC 只编译 assets/ 下的文件：只拷 cocos 后端需要的部分（h5 的 vendor .js 会被 CC 当 CJS 报错）。
{
  const frameworkTarget = path.join(project, 'assets', 'lgui-framework');
  fs.rmSync(frameworkTarget, {recursive: true, force: true});
  for (const part of ['index.ts', 'env.d.ts', 'core', 'mvc', 'backends/cocos']) {
    // project-template 是导出模板（Boot/场景），不是框架源码——混进去会在 Creator 编译时报模块解析错误，
    // 并中断 assets 拷贝阶段（产物只剩 src/，index.html 缺失；T009 实机、T008 testbed 双双实测）。
    fs.cpSync(path.join(repo, 'plugin', 'framework', part), path.join(frameworkTarget, part), {recursive: true, filter: src => !src.includes('project-template')});
  }
}
console.log('框架：assets/lgui-framework/');

// 生成类型（'lgui/ui' 重写的落点）：examples/inventory/.lgui/build/types → assets/ui-types/（纯类型，运行时擦除）。
{
  const typesTarget = path.join(project, 'assets', 'ui-types');
  fs.rmSync(typesTarget, {recursive: true, force: true});
  fs.cpSync(path.join(exampleRoot, '.lgui', 'build', 'types'), typesTarget, {recursive: true});
}
console.log('生成类型：assets/ui-types/');

// 组件表/deps/texts/runtimeConfig 形状 → lgui-config.ts（与 testbed sync 同构；RuntimeConfig 字段是 designSize）。
const components = Object.fromEntries(model.packages.map(pkg => [pkg.name, pkg.components.map(component => component.name)]));
const config = {
  defaultFont: projectJson.defaultFont,
  ...Object.fromEntries(['name', 'designSize', 'orientation', 'languages', 'defaultLanguage', 'keyMap', 'uiCache', 'requestErrorToast', 'requestTimeoutMs', 'placeholder', 'sounds'].map(key => [key, projectJson[key]]))
};
const texts = Object.fromEntries(projectJson.languages.map(language => [language, JSON.parse(fs.readFileSync(path.join(exampleRoot, 'i18n', `${language}.json`), 'utf8'))]));
fs.writeFileSync(
  path.join(project, 'assets', 'scripts', 'lgui-config.ts'),
  `// 由 sync.mjs 生成，不要手改。\nexport const config = ${JSON.stringify(config, null, 2)};\nexport const deps = ${JSON.stringify(deps, null, 2)};\nexport const components = ${JSON.stringify(components, null, 2)};\nexport const texts = ${JSON.stringify(texts, null, 2)};\n`
);
console.log('启动配置：assets/scripts/lgui-config.ts');

// 示例 src → assets/app-src/：'lgui' → 框架相对路径（CC 工程没有 esbuild alias）、
// 'lgui/ui' → ui-types（全部是 import type，运行时擦除，重写只为 typecheck）。
{
  const appTarget = path.join(project, 'assets', 'app-src');
  fs.rmSync(appTarget, {recursive: true, force: true});
  fs.cpSync(path.join(exampleRoot, 'src'), appTarget, {recursive: true});
  let rewritten = 0;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      const relFull = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(full, relFull); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const text = fs.readFileSync(full, 'utf8');
      // 深度按文件到 app-src 根计算：lgui-framework 在 assets/ 下（再上一层），ui-types 同层。
      const depth = relFull.split('/').length - 1;
      const toAssets = '../'.repeat(depth + 1);
      const next = text
        .replace(/from 'lgui\/ui'/g, `from '${toAssets}ui-types/index'`)
        .replace(/from 'lgui'/g, `from '${toAssets}lgui-framework/index'`);
      if (next !== text) { fs.writeFileSync(full, next); rewritten++; }
    }
  };
  walk(appTarget, '');
  console.log(`示例源码：assets/app-src/（重写 ${rewritten} 个文件的 lgui 别名）`);
}
