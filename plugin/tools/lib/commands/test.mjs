// lgui test [文件或目录...] [--name 名字片段] [--browser]：跑 tests/**/*.test.ts。
// 默认用 headless 后端（Node，假时钟）：每个文件用 esbuild 打包，用 node --test 跑，汇总结果。
// --browser：同一套测试在真浏览器（Chrome 或 Edge）里用 h5 后端跑，测 headless 不算的布局、文字排版、命中测试。
// 可以只跑指定的文件或目录、只跑名字里含 --name 的测试；输出写清跑了几个文件、几个测试，跳过、筛掉了几个。
// 失败时附上那个测试结束时的 lgui.debug.snapshot()。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LgCliError} from '../errors.mjs';
import {esbuild, playwright} from '../vendor.mjs';
import {generateProjectTypes, generateWeb, headlessDir} from '../generate/index.mjs';
import {bundleErrors, frameworkEntry, readTexts, runtimeConfig} from '../dev/bundle.mjs';
import {readUiModel} from '../generate/model.mjs';
import {extractTexts, generateTranslations, translationMaps} from '../generate/i18n.mjs';
import {uiProjectPath} from '../generate/index.mjs';
import {fontNames, generateFonts} from '../generate/fonts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeFile = name => path.join(here, 'test', name);
const posix = p => p.split(path.sep).join('/');

/** 测试的输出目录。TODO：P2 在 paths.mjs 加了取输出目录的函数以后换成它。 */
export const testOutDir = root => path.join(root, '.lgui', 'build', 'test');

/** --browser 里一个测试最多跑多久（毫秒），超过算失败，免得整条命令挂住。 */
const BROWSER_TEST_TIMEOUT = 120_000;

function findTests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findTests(full);
    return entry.name.endsWith('.test.ts') ? [full] : [];
  }).sort();
}

/** 要跑哪些测试文件：不写就是 tests/ 里的全部；写了就是这些文件、这些目录里的测试文件（路径按当前目录算，要在 tests/ 里）。 */
export function selectTestFiles(root, cwd, targets = []) {
  const testsDir = path.join(root, 'tests');
  const all = findTests(testsDir);
  if (!all.length) throw new LgCliError('LGUI-CLI-040', 'tests/ 里没有测试文件（*.test.ts）。', {fix: '在 tests/ 下写测试，写法见 references/mvc-spec.md 第 12 节；lgui new module 会生成测试骨架。'});
  if (!targets.length) return {all, files: all};
  const rel = file => posix(path.relative(root, file));
  const example = `比如 lgui test ${rel(all[0])}，或者一个目录 lgui test tests/；不写就跑全部`;
  const picked = new Set();
  for (const target of targets) {
    const full = path.resolve(cwd, target);
    if (!fs.existsSync(full)) throw new LgCliError('LGUI-CLI-130', `没有 ${target}（按当前目录 ${posix(path.relative(root, cwd)) || '.'} 找的，工程根目录是 ${posix(root)}）。`, {fix: `写 tests/ 里的测试文件或目录，${example}。`});
    if (full !== testsDir && !full.startsWith(testsDir + path.sep)) throw new LgCliError('LGUI-CLI-130', `${target} 不在 tests/ 里，lgui test 只跑 tests/ 里的测试。`, {fix: `写 tests/ 里的测试文件或目录，${example}。`});
    const isDir = fs.statSync(full).isDirectory();
    const matched = isDir ? all.filter(f => full === testsDir || f.startsWith(full + path.sep)) : all.filter(f => f === full);
    if (!matched.length) throw new LgCliError('LGUI-CLI-130', isDir ? `目录 ${target} 里没有测试文件（*.test.ts）。` : `${target} 不是测试文件（测试文件的名字以 .test.ts 结尾）。`, {fix: `写 tests/ 里的测试文件或目录，${example}。`});
    for (const f of matched) picked.add(f);
  }
  return {all, files: all.filter(f => picked.has(f))};
}

// 测试环境：headless 后端、模拟操作、界面描述、包依赖、配置和文本表。每个测试结束后记下快照，再收尾（见 testing.ts 的 Harness.finish）。
function writeEnv(root, project, out) {
  const fw = rel => JSON.stringify(posix(path.join(root, '.lgui', 'framework', rel)));
  const packages = fs.readdirSync(headlessDir(root)).map(file => JSON.parse(fs.readFileSync(path.join(headlessDir(root), file), 'utf8')));
  const deps = JSON.parse(fs.readFileSync(path.join(root, '.lgui', 'build', 'deps.json'), 'utf8'));
  const texts = readTexts(root, project.languages);
  const translations = translationMaps(extractTexts(readUiModel(uiProjectPath(root))), texts, project.defaultLanguage);
  const file = path.join(out, 'env.ts');
  fs.writeFileSync(file, `// 由 lgui test 生成，不要手改。
import {afterEach} from 'node:test';
import {writeFileSync} from 'node:fs';
import {createHeadlessBackend} from ${fw('backends/headless/index.ts')};
import * as sim from ${fw('backends/headless/simulate.ts')};

const packages = ${JSON.stringify(packages)};
const env = {
  createBackend: () => createHeadlessBackend(packages, ${JSON.stringify(translations)}),
  sim,
  deps: ${JSON.stringify(deps)},
  config: ${JSON.stringify(runtimeConfig(project))},
  texts: ${JSON.stringify(texts)},
  fonts: ${JSON.stringify(fontNames(root))},
  current: null as null | {snapshot(): unknown; finish(passed: boolean): string | null}
};
(globalThis as unknown as {__lguiTest: typeof env}).__lguiTest = env;

const snapshots: Record<string, unknown> = {};
afterEach(t => {
  const current = env.current;
  env.current = null;
  if (!current) return;
  try { snapshots[t.name] = current.snapshot(); } catch (error) { snapshots[t.name] = String(error); }
  // 没调 t.end() 的补上（通过了照常查泄漏和 error 日志；已经失败的只清理，不再加新的错），同一个文件后面的测试不受连带。
  const note = current.finish(t.passed);
  if (note) t.diagnostic(note);
});
// 每个测试文件在自己的进程里跑，各写一份快照，lgui test 跑完再合并。
process.on('exit', () => { if (process.env.LGUI_TEST_SNAPSHOTS) writeFileSync(process.env.LGUI_TEST_SNAPSHOTS + '/snapshots-' + process.pid + '.json', JSON.stringify(snapshots)); });
`);
  return file;
}

const FILTERED = '不匹配 --name'; // 和 test/node-test-filter.mjs、浏览器的结果一致

// 从 TAP 输出里读出每个测试的结果（describe 本身不算测试）。整个文件没跑起来（加载时出错、测试结束后还有没处理的错误）时，
// node --test 报的是「not ok - <打包出来的 .mjs>」：算这个测试文件失败，名字换成 tests/ 里的源文件。
// 失败的测试再从 YAML 块里读出 error（一行的 'xxx'，或者 |- 下面的几行），--json 里也看得到失败原因。
export function parseTap(text, sourceOf = name => name) {
  const results = [];
  let last = null;
  let block = null; // 正在读的多行 error：{indent, lines}
  for (const line of text.split('\n')) {
    const m = /^\s*(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b ?(.*))?$/.exec(line);
    if (m) {
      const [, status, name, directive, reason = ''] = m;
      last = null; block = null;
      if (/\.mjs$/.test(name)) { if (status !== 'ok') { last = {name: sourceOf(name), ok: false, skipped: false, todo: false, filtered: false}; results.push(last); } continue; }
      const filtered = directive === 'SKIP' && reason.startsWith(FILTERED);
      last = {name, ok: status === 'ok' || directive === 'TODO', skipped: directive === 'SKIP' && !filtered, todo: directive === 'TODO', filtered};
      results.push(last);
      continue;
    }
    if (!last) continue;
    if (block) {
      const indent = line.length - line.trimStart().length;
      if (!line.trim()) continue; // 块里的空行
      if (indent > block.indent) { block.lines.push(line.trim()); continue; }
      if (!last.ok && block.lines.length && last.error === undefined) last.error = block.lines.join('\n');
      block = null;
    }
    if (/^\s*type: 'suite'/.test(line)) { results.splice(results.indexOf(last), 1); last = null; continue; }
    const e = /^(\s*)error: (.*)$/.exec(line);
    if (e && !last.ok && last.error === undefined) {
      if (/^[|>]-?$/.test(e[2])) block = {indent: e[1].length, lines: []};
      else last.error = e[2].replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");
    }
  }
  return results;
}

/** 打包并运行工程里的测试（headless），返回 { files, results, snapshots, output }。files 是要跑的测试文件（绝对路径）；name 是 --name。 */
export async function runProjectTests(root, project, {files, name} = {}) {
  files ??= selectTestFiles(root, root).files;
  await generateProjectTypes(root);
  const out = testOutDir(root);
  fs.rmSync(out, {recursive: true, force: true});
  fs.mkdirSync(out, {recursive: true});
  const env = writeEnv(root, project, out);
  const bundles = [];
  for (const file of files) {
    const outfile = path.join(out, posix(path.relative(path.join(root, 'tests'), file)).replace(/\.ts$/, '.mjs').split('/').join('__'));
    try {
      await esbuild().build({
        entryPoints: [file], bundle: true, platform: 'node', format: 'esm', target: 'es2020', outfile,
        // LGUI_DEV = true：开发模式，写错了直接抛错（见 dev/bundle.mjs 的 webBuildOptions）。
        // --name：node:test 换成包了一层的版本，名字不匹配的测试标成跳过（数得出筛掉了几个）。
        alias: {lgui: frameworkEntry(root), ...(name ? {'node:test': runtimeFile('node-test-filter.mjs')} : {})},
        inject: [env], define: {LGUI_DEV: 'true'}, keepNames: true, absWorkingDir: root, logLevel: 'silent', sourcemap: 'inline'
      });
    } catch (error) {
      throw bundleErrors(error, root);
    }
    bundles.push(outfile);
  }
  const snapshotDir = path.join(out, 'snapshots');
  fs.mkdirSync(snapshotDir);
  // lgui test 本身被别的测试工具调用时（比如在 node --test 里），去掉 NODE_TEST_CONTEXT，否则子进程会把结果报给外层而不是输出 TAP。
  const childEnv = {...process.env, LGUI_TEST_SNAPSHOTS: snapshotDir, LGUI_TEST_NAME: name ?? ''};
  delete childEnv.NODE_TEST_CONTEXT;
  const tap = spawnSync(process.execPath, ['--enable-source-maps', '--test', '--test-reporter=tap', '--test-concurrency=1', ...bundles], {
    cwd: root, encoding: 'utf8', env: childEnv, maxBuffer: 64 * 1024 * 1024
  });
  const output = tap.stdout + tap.stderr;
  const sources = new Map(bundles.map((bundle, i) => [path.resolve(bundle), posix(path.relative(root, files[i]))]));
  const results = parseTap(tap.stdout, n => sources.get(path.resolve(n)) ?? n);
  // 子进程没正常结束、又没读出失败的测试（崩溃、被杀掉）：也算失败，不能当成通过。
  if (tap.status !== 0 && !results.some(r => !r.ok)) results.push({name: `测试进程异常退出（${tap.error?.message ?? `退出码 ${tap.status ?? tap.signal}`}）`, ok: false, skipped: false, todo: false, filtered: false});
  const snapshots = Object.assign({}, ...fs.readdirSync(snapshotDir).map(f => JSON.parse(fs.readFileSync(path.join(snapshotDir, f), 'utf8'))));
  return {files, results, snapshots, output};
}

// ---------- --browser ----------

// 浏览器里的测试文件：node:test、node:assert/strict 换成浏览器版；别的 Node 模块打包时报错（浏览器里没有）。
const browserShims = {
  name: 'lgui-browser-test',
  setup(build) {
    build.onResolve({filter: /^node:test$/}, () => ({path: runtimeFile('browser-node-test.mjs')}));
    build.onResolve({filter: /^(node:)?assert\/strict$/}, () => ({path: runtimeFile('browser-assert.mjs')}));
    build.onResolve({filter: /^(node:)?assert$/}, () => ({errors: [{text: 'lgui test --browser 只支持 node:assert/strict：改成 import assert from \'node:assert/strict\'（headless 里两种都行）。'}]}));
    build.onResolve({filter: /^node:/}, args => ({errors: [{text: `lgui test --browser 里不能用 Node 的模块 ${args.path}（测试在浏览器里跑，只有 node:test 和 node:assert/strict）。用到它的测试不加 --browser，在 headless 里跑。`}]}));
  }
};

const contentTypes = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.map': 'application/json', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.mp3': 'audio/mpeg', '.fui': 'application/octet-stream'};

// 只读地返回 dir 下的文件。
function serveDir(dir) {
  const server = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {'content-type': contentTypes[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'}).end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// 和 lgui verify 一样找 Chrome 或 Edge。TODO：verify.mjs 把 launch 导出来以后改成 import。
async function launchBrowser() {
  const {chromium} = playwright();
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({channel, headless: true}); } catch { /* 换下一个 */ }
  }
  throw new LgCliError('LGUI-CLI-132', '没找到 Chrome 或 Edge，lgui test --browser 跑不了。', {fix: '装一个 Chrome 或 Edge（lgui doctor 会告诉你它在哪里找）；或者先不加 --browser，用 headless 跑。'});
}

// 测试页面的入口：h5 后端、浏览器里的模拟操作和测试环境（test/browser-env.mjs）。
function writeBrowserEnv(root, project, out) {
  const fw = rel => JSON.stringify(posix(path.join(root, '.lgui', 'framework', rel)));
  const packages = fs.readdirSync(headlessDir(root)).map(file => JSON.parse(fs.readFileSync(path.join(headlessDir(root), file), 'utf8')));
  const sounds = {};
  for (const p of packages) for (const s of p.sounds ?? []) { const url = `ui://${p.package}/${s.name}`; sounds[url] = url; sounds[`ui://${p.id}${s.id}`] = url; }
  const file = path.join(out, 'env.ts');
  fs.writeFileSync(file, `// 由 lgui test --browser 生成，不要手改。
import {createH5Backend} from ${fw('backends/h5/index.ts')};
import {stage} from ${fw('backends/h5/scale.ts')};
import {installBrowserEnv} from ${JSON.stringify(posix(runtimeFile('browser-env.mjs')))};

installBrowserEnv({
  createH5Backend, stage,
  config: ${JSON.stringify(runtimeConfig(project))},
  deps: ${JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, '.lgui', 'build', 'deps.json'), 'utf8')))},
  texts: ${JSON.stringify(readTexts(root, project.languages))},
  defaultFont: ${JSON.stringify(project.defaultFont ?? null)},
  fonts: ${JSON.stringify(fontNames(root))},
  sounds: ${JSON.stringify(sounds)}
});
`);
  fs.writeFileSync(path.join(out, 'page.html'), `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}</style>
<body><script type="module">
const file = new URLSearchParams(location.search).get('file');
import('./' + file).then(() => { window.__lguiLoaded = true; }, error => { window.__lguiLoadError = String(error && error.stack || error); });
</script></body>
`);
  return file;
}

// 页面里的模拟操作要发的真实输入（playwright + CDP；坐标是页面像素）。
function inputHandler(page, cdp) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : points});
  return async (op, ...a) => {
    if (op === 'press') {
      // 按压时长交给 Chromium 自己控制：在 Node 里分开发按下、抬起，驱动慢一点就会把 50 毫秒的点击拖成长按。
      if (a[3] !== 'touch') await page.mouse.move(a[0], a[1]);
      await cdp.send('Input.synthesizeTapGesture', {x: a[0], y: a[1], duration: a[2], gestureSourceType: a[3] === 'touch' ? 'touch' : 'mouse'});
    } else if (op === 'touchDrag') {
      // 按绝对时间排好每一步（不等上一步的应答），快滑不会被拖成慢拖。
      const [x, y, dx, dy, ms, steps] = a;
      const at = (delay, send) => sleep(delay).then(send);
      await Promise.all([
        touch('touchStart', [{x, y, id: 1}]),
        ...Array.from({length: steps}, (_, i) => at(ms * (i + 1) / steps, () => touch('touchMove', [{x: x + dx * (i + 1) / steps, y: y + dy * (i + 1) / steps, id: 1}]))),
        at(ms, () => touch('touchEnd', []))
      ]);
    } else if (op === 'touchPath') {
      const [x0, y0, x1, y1, ms, steps] = a;
      await touch('touchStart', [{x: x0, y: y0, id: 1}]);
      await sleep(ms / steps); await touch('touchMove', [{x: x0 + 20, y: y0, id: 1}]);
      for (let i = 2; i <= steps; i++) {
        await sleep(ms / steps);
        const k = (i - 1) / (steps - 1);
        await touch('touchMove', [{x: x0 + 20 + (x1 - x0 - 20) * k, y: y0 + (y1 - y0) * k, id: 1}]);
      }
      await touch('touchEnd', []);
    } else if (op === 'pinch') {
      const [x, y, half, scale, steps, stepMs] = a;
      const at = h => [{x: x - h, y, id: 1}, {x: x + h, y, id: 2}];
      await touch('touchStart', at(half));
      for (let i = 1; i <= steps; i++) { await sleep(stepMs); await touch('touchMove', at(half * (1 + ((scale - 1) * i) / steps))); }
      await touch('touchEnd', []);
    } else if (op === 'wheel') { await page.mouse.move(a[0], a[1]); await page.mouse.wheel(0, a[2]); }
    else if (op === 'key') await page.keyboard.press(a[0]);
    else if (op === 'type') await page.keyboard.type(a[0]);
    else if (op === 'mouseDrag') { await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(a[2], a[3]); await page.mouse.up(); }
    else if (op === 'viewport') await page.setViewportSize({width: a[0], height: a[1]});
    else throw new Error(`LGUI-RT-263  未知的模拟操作 ${op}。`);
  };
}

const withTimeout = (promise, ms, message) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
};

/** 在真浏览器里跑测试（h5 后端），返回和 runProjectTests 一样的 { files, results, snapshots, output }。每个测试一个新页面。 */
export async function runBrowserTests(root, project, {files, name} = {}) {
  files ??= selectTestFiles(root, root).files;
  const out = path.join(testOutDir(root), 'browser');
  fs.rmSync(testOutDir(root), {recursive: true, force: true});
  fs.mkdirSync(out, {recursive: true});
  // 先生成界面包（顺带用 OpenFairyGUI 校验 ui/），再生成类型和 headless 描述（声音表要用）。
  await generateWeb(uiProjectPath(root), path.join(out, 'ui'));
  await generateProjectTypes(root, {validated: true});
  const model = readUiModel(uiProjectPath(root));
  generateTranslations(root, model, project.languages, path.join(out, 'i18n'), project.defaultLanguage);
  await generateFonts(root, project, model, path.join(out, 'ui', 'fonts'), 'woff2');
  const env = writeBrowserEnv(root, project, out);
  const bundles = [];
  for (const file of files) {
    const bundle = posix(path.relative(path.join(root, 'tests'), file)).replace(/\.ts$/, '.js').split('/').join('__');
    try {
      await esbuild().build({
        entryPoints: [file], bundle: true, platform: 'browser', format: 'esm', target: 'es2020', outfile: path.join(out, bundle),
        alias: {lgui: frameworkEntry(root)}, inject: [env], plugins: [browserShims], define: {LGUI_DEV: 'true'}, keepNames: true, absWorkingDir: root, logLevel: 'silent', sourcemap: 'inline'
      });
    } catch (error) {
      throw bundleErrors(error, root);
    }
    bundles.push({file, bundle, source: posix(path.relative(root, file))});
  }

  const server = await serveDir(out);
  const pageUrl = `http://127.0.0.1:${server.address().port}/page.html?file=`;
  const browser = await launchBrowser();
  const results = [];
  const snapshots = {};
  const output = [];
  // 开一个新页面并加载测试文件；返回页面、页面报错和测试清单（加载失败时 list 是 null）。
  const open = async bundle => {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}, hasTouch: true, locale: project.defaultLanguage});
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.stack ?? e.message ?? e)));
    page.on('console', m => { if (m.type() === 'error') output.push(`  [页面控制台] ${m.text()}`); });
    const cdp = await page.context().newCDPSession(page);
    await page.exposeFunction('__lguiInput', inputHandler(page, cdp));
    await page.goto(pageUrl + encodeURIComponent(bundle));
    await page.waitForFunction(() => window.__lguiLoaded || window.__lguiLoadError, null, {timeout: 30_000});
    const loadError = await page.evaluate(() => window.__lguiLoadError ?? null);
    return {page, errors, loadError, list: loadError ? null : await page.evaluate(() => window.__lguiTesting.list())};
  };
  try {
    for (const {bundle, source} of bundles) {
      let fresh = await open(bundle);
      if (fresh.loadError || fresh.errors.length) {
        // 和 headless 一样：整个文件没跑起来，失败项是 tests/ 里的文件名
        results.push({name: source, file: source, ok: false, skipped: false, todo: false, filtered: false, error: fresh.loadError ?? fresh.errors.join('\n')});
        output.push(`not ok - ${source}\n  ${fresh.loadError ?? fresh.errors.join('\n  ')}`);
        await fresh.page.close();
        continue;
      }
      for (const entry of fresh.list) {
        const result = {name: entry.name, file: source, ok: true, skipped: false, todo: false, filtered: false};
        if (name && !entry.fullName.split(' > ').some(n => n.includes(name))) { results.push({...result, filtered: true}); continue; }
        if (entry.skip) { results.push({...result, skipped: true}); continue; }
        const current = fresh ?? await open(bundle);
        fresh = null;
        try {
          const r = await withTimeout(current.page.evaluate(i => window.__lguiTesting.run(i), entry.index), BROWSER_TEST_TIMEOUT, `测试超过 ${BROWSER_TEST_TIMEOUT / 1000} 秒还没结束（浏览器里 t.advance 是真的等；有没有在等一个不会发生的操作？）`);
          const pageErrors = current.errors.length ? `页面报错：${current.errors.join('\n')}` : null;
          const failed = r.status === 'fail' || (pageErrors && r.status !== 'todo' && r.status !== 'skip');
          results.push({...result, ok: !failed, skipped: r.status === 'skip', todo: r.status === 'todo', ...(failed ? {error: r.error?.message ?? pageErrors} : {})});
          snapshots[entry.name] = await current.page.evaluate(n => window.__lguiSnapshots?.[n] ?? null, entry.name);
          if (failed) output.push(`not ok - ${entry.fullName}（${source}）\n  ${r.error?.stack ?? ''}${pageErrors ? `\n  ${pageErrors}` : ''}`);
          for (const note of r.notes ?? []) output.push(`# ${entry.fullName}：${note}`);
        } catch (error) {
          results.push({...result, ok: false, error: error.message});
          output.push(`not ok - ${entry.fullName}（${source}）\n  ${error.message}`);
        } finally {
          await current.page.close();
        }
      }
      if (fresh) await fresh.page.close();
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  return {files, results, snapshots, output: output.join('\n')};
}

/** 一行汇总：跑了几个文件、几个测试，通过、失败、跳过、按名字筛掉了几个。 */
export function countResults(results) {
  const filtered = results.filter(r => r.filtered).length;
  const skipped = results.filter(r => r.skipped || r.todo).length;
  const failed = results.filter(r => !r.ok).length;
  const ran = results.length - filtered - skipped;
  return {ran, passed: ran - failed, failed, skipped, filtered};
}

/** lgui test 命令。 */
export async function test({projectRoot, project, args = [], flags = {}, cwd = projectRoot}) {
  const {all, files} = selectTestFiles(projectRoot, cwd, args);
  const name = flags.name || undefined;
  const run = flags.browser ? runBrowserTests : runProjectTests;
  const {results, snapshots, output} = await run(projectRoot, project, {files, name});
  const counts = countResults(results);
  if (name && !counts.ran && !counts.failed && !counts.skipped) {
    throw new LgCliError('LGUI-CLI-131', `没有名字里含「${name}」的测试（跑的 ${files.length} 个文件里一共 ${counts.filtered} 个测试）。`, {fix: '--name 按测试名（和所在 describe 的名字）里的一段文字筛选，区分大小写；不写 --name 就跑全部。'});
  }
  const failed = results.filter(r => !r.ok);
  const where = flags.browser ? '真浏览器（h5 后端）' : ' headless ';
  const fileCount = files.length === all.length ? `${files.length} 个测试文件` : `${files.length} 个测试文件（tests/ 里一共 ${all.length} 个）`;
  const extra = [counts.skipped ? `跳过 ${counts.skipped}（skip、todo）` : '', counts.filtered ? `按 --name 筛掉 ${counts.filtered}` : ''].filter(Boolean);
  const summary = [`在${where}里跑了 ${fileCount}、${counts.ran} 个测试：通过 ${counts.passed}，失败 ${counts.failed}${extra.length ? `；${extra.join('，')}` : ''}。`];
  for (const r of failed) summary.push(`失败：${r.name}${r.file ? `（${r.file}）` : ''}`);
  // 失败原因压成一行（断言的「实际 / 期望」在后面几行），太长的截断，全文在上面的测试输出里。
  const reason = r => { const text = r.error?.replace(/\s*\n\s*/g, ' ').trim().replace(/[。.]$/, ''); return text ? `原因：${text.length > 300 ? `${text.slice(0, 300)}…` : text}。` : ''; };
  const errors = failed.map(r => new LgCliError('LGUI-CLI-041', `测试没通过：${r.name}。${reason(r)}测试结束时的界面状态：${JSON.stringify(snapshots[r.name] ?? null)}`, {fix: '看上面的测试输出，按断言改代码或测试。'}));
  if (failed.length) summary.unshift(output.trim());
  return {
    data: {
      backend: flags.browser ? 'h5' : 'headless', files: files.map(f => posix(path.relative(projectRoot, f))), totalFiles: all.length, name: name ?? null,
      ...counts, failed: failed.map(r => ({name: r.name, file: r.file ?? null, error: r.error ?? null, snapshot: snapshots[r.name] ?? null})), failedCount: counts.failed, results
    },
    summary, errors
  };
}
