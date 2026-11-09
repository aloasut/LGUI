// 把随插件带的工具装进 plugin/tools/vendor/：4 个平台各装一次，合并成一份 node_modules。
// 用法：node scripts/vendor-tools.mjs。需要能访问 npm 仓库。只在开发机上跑，结果提交进 git。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'plugin/tools/vendor');

// 固定版本（执行计划 S2-A1 的表）。
export const tools = {
  'typescript': '5.9.3',
  'esbuild': '0.25.10',
  '@openfairygui/core': '0.7.0',
  '@openfairygui/functions': '0.7.0',
  '@openfairygui/cli': '0.7.0',
  'sharp': '0.34.5',
  'playwright-core': '1.64.1',
  'harfbuzzjs': '1.6.4',
  'wawoff2': '2.0.1'
};
export const platforms = [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['win32', 'x64']];
// 每个平台各留一份的原生包；其余平台（musl、arm64 Linux、Windows arm64 等）一律不带。
const nativePackages = new Set([
  ...platforms.map(([p, c]) => `@esbuild/${p}-${c}`),
  ...platforms.map(([p, c]) => `@img/sharp-${p}-${c}`),
  '@img/sharp-libvips-darwin-arm64', '@img/sharp-libvips-darwin-x64', '@img/sharp-libvips-linux-x64'
]);
const isNative = name => name.startsWith('@esbuild/') || (name.startsWith('@img/sharp-') && name !== '@img/sharp');
const MAX_FILE = 100 * 1024 * 1024;

function fail(message) {
  console.error(`vendor-tools：${message}`);
  process.exit(1);
}

function npm(args, cwd) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {cwd, encoding: 'utf8', shell: process.platform === 'win32'});
  if (result.status !== 0) fail(`npm ${args.join(' ')} 失败（目录 ${cwd}）：\n${result.stderr || result.stdout}`);
}

// 列出 node_modules 下的包目录（含 @scope/name），只看顶层。
function packagesIn(modules) {
  const names = [];
  for (const entry of fs.readdirSync(modules)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) for (const sub of fs.readdirSync(path.join(modules, entry))) names.push(`${entry}/${sub}`);
    else names.push(entry);
  }
  return names;
}

function walkFiles(dir, visit) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function dirSize(dir) {
  let bytes = 0;
  walkFiles(dir, file => { bytes += fs.statSync(file).size; });
  return bytes;
}

const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-vendor-'));
  const manifest = {name: 'lgui-vendor', private: true, dependencies: tools};
  const installs = [];
  for (const [platform, cpu] of platforms) {
    const dir = path.join(work, `${platform}-${cpu}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    // 已有的锁文件带上：已经带的包（含间接依赖）版本不变，只补新加的。
    if (fs.existsSync(path.join(vendor, 'package-lock.json'))) fs.copyFileSync(path.join(vendor, 'package-lock.json'), path.join(dir, 'package-lock.json'));
    console.log(`安装 ${platform}/${cpu} …`);
    // Linux 只带 glibc 版；在非 Linux 机器上装时要显式指定，否则 npm 会跳过要求 glibc 的包。
    const libc = platform === 'linux' ? ['--libc=glibc'] : [];
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${platform}`, `--cpu=${cpu}`, ...libc], dir);
    installs.push(dir);
  }

  // 合并：公共包取第一份；原生包按白名单从各平台取。
  const merged = path.join(work, 'merged');
  fs.mkdirSync(path.join(merged, 'node_modules'), {recursive: true});
  for (const name of packagesIn(path.join(installs[0], 'node_modules'))) {
    if (isNative(name)) continue;
    fs.cpSync(path.join(installs[0], 'node_modules', name), path.join(merged, 'node_modules', name), {recursive: true, verbatimSymlinks: true});
  }
  for (const dir of installs) {
    for (const name of packagesIn(path.join(dir, 'node_modules'))) {
      if (!isNative(name) || !nativePackages.has(name)) continue;
      const target = path.join(merged, 'node_modules', name);
      if (!fs.existsSync(target)) fs.cpSync(path.join(dir, 'node_modules', name), target, {recursive: true, verbatimSymlinks: true});
    }
  }
  const missing = [...nativePackages].filter(name => !fs.existsSync(path.join(merged, 'node_modules', name)));
  if (missing.length) fail(`没有装到这些原生包：${missing.join('、')}`);
  // 公共包里的可执行链接（.bin）各平台不同，不带。
  fs.rmSync(path.join(merged, 'node_modules/.bin'), {recursive: true, force: true});
  fs.rmSync(path.join(merged, 'node_modules/.package-lock.json'), {force: true});

  // 检查单个文件大小（GitHub 单文件上限 100 MB）。
  const tooBig = [];
  walkFiles(merged, file => { const size = fs.statSync(file).size; if (size > MAX_FILE) tooBig.push(`${path.relative(merged, file)}（${mb(size)}）`); });
  if (tooBig.length) fail(`这些文件超过 100 MB，GitHub 放不下：${tooBig.join('、')}`);

  // 写 VERSIONS.md：每个包的版本、许可、大小。
  const rows = [];
  for (const name of packagesIn(path.join(merged, 'node_modules')).sort()) {
    const dir = path.join(merged, 'node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    rows.push(`| \`${name}\` | ${pkg.version} | ${pkg.license ?? '（package.json 未写）'} | ${mb(dirSize(dir))} |`);
  }
  const total = dirSize(path.join(merged, 'node_modules'));
  const versions = [
    '# 随插件带的工具',
    '',
    '由仓库的 `scripts/vendor-tools.mjs` 生成，不手改。原生包按 4 个平台各带一份：macOS arm64、macOS x64、Linux x64（glibc）、Windows x64。',
    '',
    `直接依赖：${Object.entries(tools).map(([n, v]) => `\`${n}@${v}\``).join('、')}。`,
    '',
    `\`node_modules/\` 合计 ${mb(total)}。`,
    '',
    '| 包 | 版本 | 许可 | 大小 |',
    '|---|---|---|---|',
    ...rows,
    ''
  ].join('\n');

  // 替换 plugin/tools/vendor/ 里的生成物（README.md 保留）。
  fs.rmSync(path.join(vendor, 'node_modules'), {recursive: true, force: true});
  fs.cpSync(path.join(merged, 'node_modules'), path.join(vendor, 'node_modules'), {recursive: true, verbatimSymlinks: true});
  fs.writeFileSync(path.join(vendor, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.copyFileSync(path.join(installs[0], 'package-lock.json'), path.join(vendor, 'package-lock.json'));
  fs.writeFileSync(path.join(vendor, 'VERSIONS.md'), versions);
  fs.rmSync(work, {recursive: true, force: true});
  console.log(`已写入 plugin/tools/vendor/：node_modules ${mb(total)}，${rows.length} 个包。`);
}
