// 中文字体的加载和帧耗时对比（开发用，复盘决定第 9 条）：手机配置（375×812、DPR 3、CPU 降速 4 倍）下，比较
//   A 系统字体（不带项目字体，现状）、B 整个 Noto Sans SC 压成 WOFF2、C 只收用到的字的子集 WOFF2（LGUI 生成的样子）。
// 加载：再分慢 4G（1.6 Mbps、往返 150 ms）和快 4G（9 Mbps、往返 40 ms）两档网络，量从打开页面到 backend.init 完成（字体就绪）。
// 首次出字：一次显示 300 个文字控件（覆盖字集里全部的字），从创建到画完两帧。
// 持续帧耗时：300 个文字（一半 autoSize="shrink"）每帧全部换字，跑 frames 帧：rAF 间隔中位数、p95，Chrome 统计的脚本 / 布局 / 样式每帧毫秒。
// 构建：generateFonts 做的事（子集 + WOFF2）对整包字体要多久，分两种字集大小。
// 结果写进 PR，不进测试（数值跟机器有关）。字体用 scripts/fonts/noto.mjs 下载（Google 官方仓库，OFL 1.1，核对 SHA-256）。
//
// 用法：node scripts/fonts/bench.mjs [--frames 120] [--throttle 4] [--runs 3]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWeb} from '../../plugin/tools/lib/generate/index.mjs';
import {subsetFont} from '../../plugin/tools/lib/generate/fonts.mjs';
import {esbuild, harfbuzz, woff2} from '../../plugin/tools/lib/vendor.mjs';
import {serve, launchBrowser} from '../../tests/helpers/browser.mjs';
import {SAMPLE_TEXT, notoSansSC} from './noto.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const h5 = path.join(repo, 'plugin/framework/backends/h5');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const FRAMES = arg('frames', 120), THROTTLE = arg('throttle', 4), RUNS = arg('runs', 3), COUNT = 300;
const NETWORKS = [['慢 4G', 150, 1.6e6 / 8], ['快 4G', 40, 9e6 / 8]];
const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)]; };
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;

const chars = [...new Set([...SAMPLE_TEXT].filter(ch => ch.codePointAt(0) > 0x7f))];
const ascii = Array.from({length: 0x7f - 0x20}, (_, i) => 0x20 + i);

async function fonts(noto) {
  const source = fs.readFileSync(noto);
  // 整包 WOFF2 压一次要十几秒，存在临时目录里反复用
  const full = path.join(os.tmpdir(), 'lgui-fonts', `full-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 12)}.woff2`);
  if (!fs.existsSync(full)) { console.log('整包字体压 WOFF2（只第一次）…'); fs.writeFileSync(full, await woff2()(source)); }
  const sub = await woff2()(await subsetFont(source, [...ascii, ...chars.map(ch => ch.codePointAt(0))]));
  return {source, full: fs.readFileSync(full), sub};
}

// 构建耗时：子集 + WOFF2，3 次取中位数。large：字体里前 3500 个汉字（约等于常用字表的规模）。
async function buildTimes(source) {
  const hb = await harfbuzz();
  const all = [...new hb.Face(new hb.Blob(source), 0).collectUnicodes()];
  const sets = [[`样本字集（${chars.length} 个汉字）`, [...ascii, ...chars.map(ch => ch.codePointAt(0))]], ['3500 个汉字', [...ascii, ...all.filter(cp => cp >= 0x4e00 && cp <= 0x9fff).slice(0, 3500)]]];
  const rows = [];
  for (const [label, cps] of sets) {
    const times = [];
    let size = 0;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const out = await woff2()(await subsetFont(source, cps));
      times.push(performance.now() - t0);
      size = out.length;
    }
    rows.push([label, median(times), size]);
  }
  return rows;
}

async function build(fontFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-font-bench-'));
  const pkg = path.join(root, 'ui/assets/Bench');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(path.join(root, 'ui/UI.fairy'), xml('<projectDescription id="bench" type="Layabox" version="3.0"/>'));
  fs.writeFileSync(path.join(pkg, 'package.xml'), xml('<packageDescription id="bench001"><resources><component id="texts001" name="Texts.xml" path="/" exported="true"/></resources></packageDescription>'));
  const cols = 5, cell = [216, 60];
  const word = i => Array.from({length: 8}, (_, k) => chars[(i * 8 + k) % chars.length]).join('');
  const texts = Array.from({length: COUNT}, (_, i) => `<text id="t${i}" name="t${i}" xy="${(i % cols) * cell[0]},${Math.floor(i / cols) * cell[1]}" size="200,50" fontSize="28" color="#ffffff" align="center" vAlign="middle" ${i % 2 ? 'autoSize="shrink"' : 'autoSize="none"'} singleLine="true" text="${word(i)}"/>`);
  fs.writeFileSync(path.join(pkg, 'Texts.xml'), xml(`<component size="1080,${Math.ceil(COUNT / cols) * cell[1]}"><displayList>${texts.join('')}</displayList></component>`));
  await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
  fs.mkdirSync(path.join(root, 'web/ui/fonts'));
  for (const [name, bytes] of Object.entries(fontFiles)) fs.writeFileSync(path.join(root, 'web/ui/fonts', `${name}.woff2`), bytes);
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `import {createH5Backend} from ${JSON.stringify(path.join(h5, 'index.ts'))};
    const q = new URLSearchParams(location.search);
    const font = q.get('font');
    const chars = ${JSON.stringify(chars)};
    const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    (async () => {
      const backend = createH5Backend();
      await backend.init({projectName: 'bench', defaultFont: font, fonts: font ? [font] : [], uiBase: '/ui'});
      const initDone = performance.now();
      await backend.loadPackage('Bench');
      await frame2();
      const t0 = performance.now();
      const view = backend.create('Bench', 'Texts');
      backend.root.addChild(view);
      await frame2();
      const firstText = performance.now() - t0;
      const native = (view as any).native;
      let frame = 0;
      const update = () => { frame++; for (let i = 0; i < native.numChildren; i++) { let s = ''; for (let k = 0; k < 8; k++) s += chars[(i * 7 + k + frame * 3) % chars.length]; native.getChildAt(i).text = s; } };
      Object.assign(window, {
        initDone, firstText,
        run: (frames: number) => new Promise(resolve => {
          const times: number[] = []; let last = 0, n = 0;
          const tick = (now: number) => { if (last) times.push(now - last); last = now; update(); if (++n <= frames) requestAnimationFrame(tick); else resolve(times); };
          requestAnimationFrame(tick);
        }),
        ready: true
      });
    })().catch(e => { (window as any).failure = String(e && e.message || e); });`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#334}</style><body><script type="module" src="/app.js"></script>');
  return path.join(root, 'web');
}

async function open(browser, url, network) {
  const context = await browser.newContext({viewport: {width: 375, height: 812}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  if (network) await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: network[1], downloadThroughput: network[2], uploadThroughput: 750e3 / 8});
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: THROTTLE});
  await page.goto(url);
  await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 300000});
  const failure = await page.evaluate(() => window.failure ?? null);
  if (failure) throw new Error(failure);
  return {context, page, cdp};
}

async function frames(browser, url) {
  const {context, page, cdp} = await open(browser, url, null);
  const firstText = await page.evaluate(() => window.firstText);
  await page.evaluate(() => window.run(20));
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const m0 = await metrics();
  const times = await page.evaluate(n => window.run(n), FRAMES);
  const m1 = await metrics();
  await context.close();
  const per = name => (m1[name] - m0[name]) * 1000 / FRAMES;
  return {firstText, median: median(times), p95: p95(times), script: per('ScriptDuration'), layout: per('LayoutDuration'), style: per('RecalcStyleDuration')};
}

const noto = await notoSansSC();
const {source, full, sub} = await fonts(noto);
const web = await build({NotoFull: full, NotoSub: sub});
const server = await serve({'/': web});
const browser = await launchBrowser();
if (!browser) throw new Error('没找到 Chrome 或 Edge。');
const cases = [['A 系统字体（现状）', '', 0], ['B 整包 WOFF2', 'NotoFull', full.length], ['C 子集 WOFF2', 'NotoSub', sub.length]];
try {
  console.log(`原字体：Noto Sans SC Regular OTF ${kb(source.length)}；字集：ASCII + ${chars.length} 个汉字。手机配置：375×812，DPR 3，CPU 降速 ${THROTTLE} 倍；每项 ${RUNS} 次取中位数。\n`);
  console.log('**加载**（打开页面到 backend.init 完成、字体就绪，毫秒；页面不缓存）');
  console.log(`\n| 方案 | 字体大小 | ${NETWORKS.map(n => n[0]).join(' | ')} |`);
  console.log(`|---|---|${NETWORKS.map(() => '---').join('|')}|`);
  for (const [label, font, size] of cases) {
    const cells = [];
    for (const network of NETWORKS) {
      const times = [];
      for (let i = 0; i < RUNS; i++) {
        const {context, page} = await open(browser, `${server.url}/index.html?font=${font}`, network);
        times.push(await page.evaluate(() => window.initDone));
        await context.close();
      }
      cells.push(median(times).toFixed(0));
    }
    console.log(`| ${label} | ${size ? kb(size) : '—'} | ${cells.join(' | ')} |`);
  }
  console.log(`\n**帧耗时**（${COUNT} 个文字，一半 shrink；首次出字 = 创建到画完两帧；持续 = 每帧全部换字 ${FRAMES} 帧，毫秒）`);
  console.log('\n| 方案 | 首次出字 | 帧间隔中位数 | 帧间隔 p95 | 脚本 / 帧 | 布局 / 帧 | 样式 / 帧 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [label, font] of cases) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await frames(browser, `${server.url}/index.html?font=${font}`));
    const mid = key => median(runs.map(r => r[key])).toFixed(1);
    console.log(`| ${label} | ${mid('firstText')} | ${mid('median')} | ${mid('p95')} | ${mid('script')} | ${mid('layout')} | ${mid('style')} |`);
  }
} finally {
  await browser.close();
  await server.close();
}
console.log('\n**构建**（子集 + WOFF2，对整包字体，3 次中位数）\n');
console.log('| 字集 | 耗时 | WOFF2 大小 |');
console.log('|---|---|---|');
for (const [label, ms, size] of await buildTimes(source)) console.log(`| ${label} | ${ms.toFixed(0)} ms | ${kb(size)} |`);
