// 开发用 cocos 一致性运行器（T008 四方快照的 cocos 侧）。与 headless 复用 cases/、harness.ts 与快照格式，
// cocos 端跑在 testbed 的 web-mobile 构建里（ConformanceBoot 的 ?conf= 桥，页面暴露 __confCases/__confRun）。
// 手动定位同 tests/unity：不进 npm test。构建已存在时直接跑；--build 才触发 Creator CLI 构建。
// 输入类用例的 cocos 输入操作在 T008d 接（ConformanceBoot 的 sim 位会抛 T008d），本 runner 把它们标 PENDING，不算差异。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';
import {webBuildOptions} from '../../plugin/tools/lib/dev/bundle.mjs';
import {cases, conformanceProject, runHeadless} from '../conformance/runner.mjs';
import {launchBrowser} from '../helpers/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const testbed = path.join(repo, 'lgui-cocos-mcp', 'testbed');
const buildDir = path.resolve(testbed, 'build', 'web-mobile');
const posix = p => p.split(path.sep).join('/');
// 本机 Creator 的 CLI 入口（首次导入必须 GUI 打开过一次，见 plan-tree P001 的 T007 证据）。
const creatorBin = process.env.CC_CREATOR_BIN ?? '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator';

/** Creator CLI 构建 testbed。 */
function buildTestbed() {
  if (!fs.existsSync(creatorBin)) throw new Error(`找不到 Creator CLI（${creatorBin}）；用 CC_CREATOR_BIN 覆盖路径，或在 Creator GUI 里构建一次。`);
  const r = spawnSync(creatorBin, ['--project', testbed, '--build', 'platform=web-mobile;debug=true'], {stdio: 'inherit'});
  if (r.status !== 0) throw new Error(`Creator CLI 构建失败（exit ${r.status}）。`);
}

// testbed 构建产物是静态站（cocos-js、assets、.bin/.png/.webp），自己开个只听 127.0.0.1 的服务。
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'};
function serveBuild() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.resolve(buildDir, '.' + url);
    if (!file.startsWith(buildDir + path.sep) || !fs.statSync(file, {throwIfNoEntry: false})?.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {'content-type': types[path.extname(file)] ?? 'application/octet-stream'});
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

// 用例开始时的屏幕尺寸（cocos 页面按它开视口，与 h5 runner 的 caseScreen 同法）。
async function caseScreen(ctx, name) {
  const outfile = path.join(ctx.root, 'conformance', 'out', `screen-${name}.mjs`);
  const entry = path.join(ctx.root, 'conformance', `screen-${name}.ts`);
  fs.writeFileSync(entry, `import c from ${JSON.stringify(posix(path.join(ctx.root, 'conformance', 'cases', `${name}.ts`)))};\nexport const screen = c.screen;\n`);
  await esbuild().build({...webBuildOptions(ctx.root, entry, {outfile}), platform: 'node', sourcemap: false});
  return import(pathToFileURL(outfile).href);
}

const withTimeout = (p, ms, what) => {
  let timer;
  return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} ${ms}ms 未完成`)), ms); })])
    .finally(() => clearTimeout(timer));
};

const args = process.argv.slice(2);
if (args.includes('--build')) buildTestbed();
if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
  throw new Error(`testbed 构建产物不存在（${buildDir}）：先 --build，或 node lgui-cocos-mcp/testbed/sync.mjs --conformance 后再构建。`);
}
const only = args.filter(a => !a.startsWith('--'));
if (only.some(name => !cases.includes(name))) throw new Error(`未知用例，可选：${cases.join('、')}`);

const browser = await launchBrowser();
if (!browser) {
  console.error('未找到 Chrome 或 Edge，跳过。');
  process.exit(2);
}

console.log('fixture 工程生成中…');
const ctx = await conformanceProject();
const base = await serveBuild();
const names = only.length ? only : cases;
const results = [];
console.log(`构建产物服务：${base}；用例 ${names.length} 个。`);

try {
  for (const name of names) {
    console.log(`▸ ${name}`);
    const {screen} = await caseScreen(ctx, name);
    const page = await browser.newPage({viewport: screen, hasTouch: true});
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message ?? e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const result = {name, status: 'PASS'};
    try {
      await page.goto(`${base}/index.html?conf=1`);
      await withTimeout(page.waitForFunction(() => window.__confCases, null, {timeout: 30000}), 35000, 'cocos 页面就绪');
      let snapshot;
      try {
        snapshot = await withTimeout(page.evaluate(n => globalThis.__confRun(n), name), 60000, 'cocos 用例');
      } catch (error) {
        if (String(error).includes('T008d')) { result.status = 'PENDING'; result.note = '输入操作待 T008d'; }
        else throw error;
      }
      if (result.status === 'PASS') {
        const headless = await withTimeout(runHeadless(ctx, name), 120000, 'headless 快照');
        try {
          assert.deepEqual(snapshot, headless);
        } catch (error) {
          result.status = 'DIFF';
          result.note = String(error.message).slice(0, 3000);
        }
      }
    } catch (error) {
      result.status = 'ERROR';
      result.note = String(error.message ?? error).slice(0, 2000);
    }
    if (result.status === 'PASS' && errors.length) {
      result.status = 'ERROR';
      result.note = `cocos 页面报错：${errors.join('；').slice(0, 1500)}`;
    }
    results.push(result);
    await page.close();
  }
} finally {
  await browser.close();
}

for (const r of results) {
  const mark = {PASS: '✅', PENDING: '⏳', DIFF: '❌', ERROR: '❌'}[r.status];
  console.log(`${mark} ${r.name}${r.note ? ` —— ${r.note}` : ''}`);
}
const count = s => results.filter(r => r.status === s).length;
console.log(`共 ${results.length}：过 ${count('PASS')}、待输入(T008d) ${count('PENDING')}、差异/错误 ${count('DIFF') + count('ERROR')}`);
if (count('DIFF') + count('ERROR')) process.exit(1);
