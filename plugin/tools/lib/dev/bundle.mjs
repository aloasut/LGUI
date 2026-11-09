// 打包用户工程：生成一个启动入口（选后端、读文本表和配置、启动 app），用 esbuild 打包。
// lgui dev（网页）用它；lgui test 和 lgui unity export 用同样的写法换后端。
import fs from 'node:fs';
import path from 'node:path';
import {LgCliError, LgCliErrors} from '../errors.mjs';
import {esbuild} from '../vendor.mjs';
import {fontNames} from '../generate/fonts.mjs';

/** 工程配置里框架运行时要用的那部分。 */
export function runtimeConfig(project) {
  const keys = ['name', 'designSize', 'orientation', 'languages', 'defaultLanguage', 'keyMap', 'uiCache', 'requestErrorToast', 'requestTimeoutMs', 'placeholder', 'sounds'];
  return Object.fromEntries(keys.map(key => [key, project[key]]));
}

/** 工程里的框架入口：import 'lgui' 指向它（esbuild alias）。 */
export const frameworkEntry = root => path.join(root, '.lgui', 'framework', 'index.ts');

/** 读 i18n/ 下全部文本表。 */
export function readTexts(root, languages) {
  const texts = {};
  for (const lang of languages) {
    const file = path.join(root, 'i18n', `${lang}.json`);
    if (!fs.existsSync(file)) throw new LgCliError('LGUI-CLI-031', `缺少文本表 i18n/${lang}.json（工程配置 languages 里有 ${lang}）。`, {file: `i18n/${lang}.json`, fix: `新建 i18n/${lang}.json，或者从 languages 里去掉 ${lang}。`});
    try {
      texts[lang] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new LgCliError('LGUI-CLI-031', `文本表 i18n/${lang}.json 不是合法的 JSON：${error.message}`, {file: `i18n/${lang}.json`, fix: '改成合法的 JSON。'});
    }
  }
  return texts;
}

// src/modules/ 下所有 *View.ts（给 lgui verify --view 按名字打开界面用）。
function viewFiles(root) {
  const dir = path.join(root, 'src', 'modules');
  if (!fs.existsSync(dir)) return [];
  const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('View.ts') ? [path.join(d, e.name)] : []);
  return walk(dir);
}

/** 写网页端的启动入口 <dir>/boot.ts（dir 是命令自己的生成目录，比如 .lgui/build/dev/）。texts：不写就读 i18n/ 下的文本表（lgui verify 的伪翻译会传进来）。 */
export function writeWebBootstrap(root, project, {texts, dir}) {
  const fw = rel => JSON.stringify(path.join(root, '.lgui', 'framework', rel).split(path.sep).join('/'));
  const file = path.join(dir, 'boot.ts');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `// 由 lgui dev 生成，不要手改。
import app from ${JSON.stringify(path.join(root, 'src', 'main.ts').split(path.sep).join('/'))};
import {createH5Backend} from ${fw('backends/h5/index.ts')};
import {boot} from ${fw('mvc/boot.ts')};
import {lgui} from ${fw('index.ts')};
${viewFiles(root).map((f, i) => `import * as views${i} from ${JSON.stringify(f.split(path.sep).join('/'))};`).join('\n')}
const views: Record<string, unknown> = {};
for (const mod of [${viewFiles(root).map((_, i) => `views${i}`).join(', ')}] as Record<string, unknown>[]) for (const [name, value] of Object.entries(mod)) if (typeof value === 'function' && 'layer' in value) views[name] = value;

declare const LGUI_DEV: boolean; // 打包时由 esbuild 的 define 换成 true / false（见 webBuildOptions）

const config = ${JSON.stringify(runtimeConfig(project))};
const deps = ${JSON.stringify(readDeps(root))};
const texts = ${JSON.stringify(texts ?? readTexts(root, project.languages))};

(async () => {
  const backend = createH5Backend();
  // 相对页面的路径：页面放在子路径下（比如 GitHub Pages 的 /LGUI/）也能打开。
  await backend.init({projectName: config.name, defaultFont: ${JSON.stringify(project.defaultFont)}, fonts: ${JSON.stringify(fontNames(root))}, uiBase: './ui', i18nBase: './i18n'});
  // 开发模式下给调试面板和端到端测试用；正式构建（LGUI_DEV = false）不挂。
  if (LGUI_DEV) (window as unknown as {__lgui: unknown}).__lgui = {snapshot: () => lgui.debug.snapshot(), lgui, views};
  await boot(backend, app, config, deps, {texts});
  (window as unknown as {__lguiReady: boolean}).__lguiReady = true;
})().catch(error => {
  const e = error as {code?: string; message?: string};
  (window as unknown as {__lguiShowErrors?: (errors: unknown[]) => void}).__lguiShowErrors?.([{code: e.code ?? 'LGUI-RT', message: String(e.message ?? error)}]);
  throw error;
});
`);
  return file;
}

function readDeps(root) {
  const file = path.join(root, '.lgui', 'build', 'deps.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/** esbuild 报错 → LGUI-CLI-032（带文件和行号）。 */
export function bundleErrors(error, root) {
  const errors = error?.errors ?? [];
  if (!errors.length) return new LgCliErrors([new LgCliError('LGUI-CLI-032', `打包失败：${error?.message ?? error}`, {fix: '按提示改代码。'})]);
  return new LgCliErrors(errors.map(e => new LgCliError('LGUI-CLI-032', `打包失败：${e.text}`, {
    file: e.location?.file ? path.relative(root, path.resolve(root, e.location.file)).split(path.sep).join('/') : undefined,
    line: e.location?.line,
    fix: '按提示改代码。'
  })));
}

/**
 * 网页用的 esbuild 选项。dev：开发模式（lgui dev、lgui verify 都是）。框架靠 esbuild 的 define 知道是不是开发模式：
 * LGUI_DEV = true 时，代码或界面写错了（缺文本键等）直接抛错；正式构建传 dev: false（LGUI_DEV = false），只记 error 日志、界面照常显示。
 * lgui test 也定义 LGUI_DEV = true（commands/test.mjs）。outfile：打包出的文件（放在命令自己的生成目录里）。
 */
export function webBuildOptions(root, entry, {dev = true, outfile}) {
  return {
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    sourcemap: true,
    outfile,
    alias: {lgui: frameworkEntry(root)},
    define: {LGUI_DEV: String(dev)},
    keepNames: true, // 界面类名会出现在调试快照和报错里，不能被改名
    absWorkingDir: root,
    logLevel: 'silent'
  };
}

/** 建一个可以反复重新打包的 esbuild context。 */
export async function createWebContext(root, entry, {outfile}) {
  return esbuild().context(webBuildOptions(root, entry, {outfile}));
}
