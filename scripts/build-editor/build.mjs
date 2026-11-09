// 编译编辑器：克隆 FairyGUI-Editor-Online 的固定提交，打补丁、换品牌，vite build，产物放进 plugin/editor/。
// 用法：node scripts/build-editor/build.mjs [--source <已克隆的目录>]。需要能访问 GitHub 和 npm 仓库；只在开发机上跑，结果提交进 git。
// --source：复用一个已经克隆好（并检出固定提交）的目录，跳过克隆；会在那个目录里打补丁和编译。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = path.join(root, 'plugin', 'editor');

export const UPSTREAM = 'https://github.com/OpenFairyGUI/FairyGUI-Editor-Online.git';
export const COMMIT = '45f0bef93bb16d507552b673ace6d5af417a8a0f';
const LICENSE_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md'];

function fail(message) {
  console.error(`build-editor：${message}`);
  process.exit(1);
}

function sh(command, args, cwd) {
  const windows = process.platform === 'win32';
  const result = spawnSync(windows && command === 'npm' ? 'npm.cmd' : command, args, {cwd, stdio: 'inherit', shell: windows});
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 失败（目录 ${cwd}）。`);
}

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
let src = sourceIndex >= 0 ? path.resolve(args[sourceIndex + 1] ?? fail('--source 后面要写目录。')) : null;

// 1. 克隆固定提交和子模块
if (!src) {
  src = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-editor-')), 'editor');
  sh('git', ['clone', '--quiet', UPSTREAM, src], root);
  sh('git', ['checkout', '--quiet', COMMIT], src);
  sh('git', ['submodule', 'update', '--init', '--recursive'], src);
}
const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: src, encoding: 'utf8'}).stdout.trim();
if (head !== COMMIT) fail(`${src} 检出的是 ${head}，要求 ${COMMIT}。`);

// 2. 装依赖
sh('npm', ['ci', '--no-audit', '--no-fund'], src);

// 3. 打补丁、换品牌（补丁说明见 README.md）
const patches = path.join(here, 'patches');
sh('git', ['apply', path.join(patches, 'agent-session.patch')], src);
sh('git', ['apply', path.join(patches, 'rebrand.patch')], src);
sh('git', ['apply', path.join(patches, 'project-reload.patch')], src);
sh('git', ['apply', path.join(patches, 'cross-package-image.patch')], src);
sh('git', ['apply', path.join(patches, 'atlas-default.patch')], src);
sh('git', ['apply', path.join(patches, 'rebrand-ui.patch')], path.join(src, 'vendor', 'FairyGUI-Editor'));
fs.copyFileSync(path.join(here, 'brand', 'logo128.png'), path.join(src, 'vendor', 'FairyGUI-Editor', 'ui', 'assets', 'Builder', 'icons', 'logo128.png'));

// 4. 从换过品牌的界面工程重新发布编辑器界面包，类型检查，编译
sh('npm', ['run', 'publish:editor-ui'], src);
sh('npm', ['run', 'typecheck'], src);
sh('npx', ['vite', 'build'], src);

// 5. 复制产物和许可文件，写 VERSION.md
fs.rmSync(out, {recursive: true, force: true});
fs.cpSync(path.join(src, 'vite-dist'), out, {recursive: true, filter: file => !file.endsWith('.meta')});
for (const file of LICENSE_FILES) fs.copyFileSync(path.join(src, file), path.join(out, file));
fs.writeFileSync(path.join(out, 'VERSION.md'), `# 编辑器版本

- 上游：${UPSTREAM.replace(/\.git$/, '')}
- 提交：\`${COMMIT}\`
- LGUI 的改动：\`scripts/build-editor/patches/\`（实时会话中转、换品牌、重新读 ui/、跨包图片、图集上限默认值）和 \`scripts/build-editor/brand/logo128.png\`。

许可见同目录的 \`LICENSE\`、\`THIRD_PARTY_NOTICES.md\`、\`TRADEMARKS.md\`。
`);
fs.writeFileSync(path.join(out, 'README.md'), '# editor\n\n编辑器（编译好的版本），已换掉 FairyGUI 的名称和 Logo。由仓库的 `scripts/build-editor/` 编译生成，不手改。版本见 [VERSION.md](VERSION.md)。\n');

// 6. 大小
let bytes = 0, files = 0;
const walk = dir => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else { bytes += fs.statSync(f).size; files++; } } };
walk(out);
console.log(`plugin/editor/ 大小：${(bytes / 1024 / 1024).toFixed(2)} MB（${files} 个文件）`);
