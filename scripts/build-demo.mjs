// 把一个 LGUI 工程打成静态网页（正式构建：LGUI_DEV = false，没有自动刷新），放在任意路径下都能打开，比如 GitHub Pages 的 /LGUI/。
// 用法：node scripts/build-demo.mjs [工程目录] [输出目录]。默认 examples/inventory → <工程>/.lgui/build/site/。
// 示例工程先运行 node scripts/sync-examples.mjs（框架副本不进 git）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toErrors} from '../plugin/tools/lib/output.mjs';
import {readProject} from '../plugin/tools/lib/project.mjs';
import {esbuild} from '../plugin/tools/lib/vendor.mjs';
import {generateProjectTypes, generateWeb, uiProjectPath} from '../plugin/tools/lib/generate/index.mjs';
import {readUiModel} from '../plugin/tools/lib/generate/model.mjs';
import {generateTranslations} from '../plugin/tools/lib/generate/i18n.mjs';
import {generateFonts} from '../plugin/tools/lib/generate/fonts.mjs';
import {bundleErrors, webBuildOptions, writeWebBootstrap} from '../plugin/tools/lib/dev/bundle.mjs';
import {buildDir} from '../plugin/tools/lib/paths.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repo, 'examples', 'inventory');
const out = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, '.lgui', 'build', 'site');

if (!fs.existsSync(path.join(root, '.lgui', 'framework', 'index.ts'))) {
  console.error(`${path.relative(process.cwd(), root) || '.'} 里没有框架副本 .lgui/framework/  → 仓库里的示例先运行 node scripts/sync-examples.mjs。`);
  process.exit(1);
}

try {
  const project = readProject(root);
  await generateWeb(uiProjectPath(root), path.join(out, 'ui'));
  await generateProjectTypes(root, {validated: true});
  const model = readUiModel(uiProjectPath(root));
  generateTranslations(root, model, project.languages, path.join(out, 'i18n'), project.defaultLanguage);
  await generateFonts(root, project, model, path.join(out, 'ui', 'fonts'), 'woff2');
  const entry = writeWebBootstrap(root, project, {dir: buildDir(root, 'demo')}); // 启动入口不放进要发布的输出目录
  try {
    await esbuild().build({...webBuildOptions(root, entry, {dev: false, outfile: path.join(out, 'app.js')}), sourcemap: false});
  } catch (error) {
    throw bundleErrors(error, root);
  }
  // app.js 带上内容哈希：GitHub Pages 会缓存 10 分钟，微信等内置浏览器可能更久，换了版本要让浏览器重新取脚本。
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'app.js'))).digest('hex').slice(0, 12);
  const shell = fs.readFileSync(path.join(repo, 'plugin', 'tools', 'lib', 'dev', 'shell.html'), 'utf8');
  if (!shell.includes('src="./app.js"')) throw new Error('shell.html 里找不到 src="./app.js"，没法加版本号。');
  fs.writeFileSync(path.join(out, 'index.html'), shell.replace('src="./app.js"', `src="./app.js?v=${hash}"`));
  const shown = path.relative(process.cwd(), out) || '.';
  console.log(`已生成 ${shown.startsWith('..') ? out : shown}/（index.html、app.js、ui/、i18n/）`);
} catch (error) {
  for (const e of toErrors(error)) console.error(`${e.file ? `${e.file}${e.line ? `:${e.line}` : ''}  ` : ''}${e.code}  ${e.message}${e.fix ? `  → ${e.fix}` : ''}`);
  process.exit(1);
}
