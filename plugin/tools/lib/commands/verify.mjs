// lgui verify：生成一次，在随机端口起服务，用 Chrome 或 Edge 按标准尺寸 × 横竖两种方向截图（同一个画面只截一次），每张图旁边存一份界面快照。
// 每张图都按尺寸的 safeArea 模拟刘海：启动前设好 window.__lguiSafeArea，网页后端读它。
// --size 只截一组；--view 先打开指定的界面（--params 是传给它的参数，JSON 对象）；--lang <语言> 再乘上语言；--lang pseudo 用伪翻译（文字加长 40%、换成带重音的字母），再按最长的语言横竖各截一张。
// 生成物放在 .lgui/build/verify/site/，截图放在 .lgui/build/verify/（和 lgui dev、lgui test 各用各的目录，同时跑不会互相删文件）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {LgCliError} from '../errors.mjs';
import {esbuild, playwright} from '../vendor.mjs';
import {generateProjectTypes, generateWeb, uiProjectPath} from '../generate/index.mjs';
import {buildDir} from '../paths.mjs';
import {readUiModel} from '../generate/model.mjs';
import {extractTexts, generateTranslations, translationXml} from '../generate/i18n.mjs';
import {readTexts, webBuildOptions, writeWebBootstrap, bundleErrors} from '../dev/bundle.mjs';
import {serveBuilt} from '../dev/index.mjs';
import {generateFonts} from '../generate/fonts.mjs';

const ACCENTS = {a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', c: 'ç', n: 'ñ', y: 'ý'};

/** 伪翻译：字母换成带重音的，加长 40%，两头加 [ ]；占位符 {xxx} 原样保留。 */
export function pseudo(text) {
  const parts = text.split(/(\{\w+\})/);
  const body = parts.map(p => /^\{\w+\}$/.test(p) ? p : [...p].map(ch => ACCENTS[ch] ?? ch).join('')).join('');
  const visible = text.replace(/\{\w+\}/g, '').length;
  return `[${body}${'~'.repeat(Math.ceil(visible * 0.4))}]`;
}

const pseudoTable = table => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, typeof v === 'string' ? pseudo(v) : Object.fromEntries(Object.entries(v).map(([f, t]) => [f, pseudo(t)]))]));
const tableLength = table => Object.values(table).reduce((sum, v) => sum + (typeof v === 'string' ? v.length : Object.values(v).join('').length), 0);

const NO_INSETS = {top: 0, right: 0, bottom: 0, left: 0};

/** 要截哪些：每组尺寸横竖各一张，去掉重复的画面（手机横屏转成竖屏，和手机竖屏那组是同一个画面，只留本来就是竖屏的那组）。
 *  safeArea 按尺寸本来的方向写；转到另一个方向时四边跟着转 90°。返回 [{ size, orientation, viewport, safeArea }]。 */
export function verifyShots(sizes) {
  const native = s => (s.width >= s.height ? 'landscape' : 'portrait');
  const viewportOf = (s, o) => { const long = Math.max(s.width, s.height), short = Math.min(s.width, s.height); return o === 'landscape' ? {width: long, height: short} : {width: short, height: long}; };
  const key = v => `${v.width}x${v.height}`;
  const natives = new Set(sizes.map(s => key(viewportOf(s, native(s)))));
  const seen = new Set();
  const shots = [];
  for (const size of sizes) {
    for (const orientation of ['landscape', 'portrait']) {
      const viewport = viewportOf(size, orientation);
      const rotated = orientation !== native(size);
      if (seen.has(key(viewport)) || (rotated && natives.has(key(viewport)))) continue;
      seen.add(key(viewport));
      const a = size.safeArea ?? NO_INSETS;
      const safeArea = !rotated ? {...a} : orientation === 'portrait' ? {top: a.left, right: a.top, bottom: a.right, left: a.bottom} : {top: a.right, right: a.bottom, bottom: a.left, left: a.top};
      shots.push({size, orientation, viewport, safeArea});
    }
  }
  return shots;
}

async function launch() {
  const {chromium} = playwright();
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({channel, headless: true}); } catch { /* 换下一个 */ }
  }
  throw new LgCliError('LGUI-CLI-060', '没找到 Chrome 或 Edge，没法截图。', {fix: '装一个 Chrome 或 Edge；lgui doctor 会告诉你它在哪里找。'});
}

/** 跑一次验证，返回截图清单。 */
export async function runVerify(root, project, {size, view, params, lang} = {}) {
  const sizes = size ? project.verifySizes.filter(s => s.name === size) : project.verifySizes;
  if (!sizes.length) throw new LgCliError('LGUI-CLI-061', `没有名为 ${size} 的验证尺寸。`, {fix: `能用的：${project.verifySizes.map(s => s.name).join('、')}（工程配置 verifySizes）。`});
  if (lang && lang !== 'pseudo' && !project.languages.includes(lang)) throw new LgCliError('LGUI-CLI-062', `工程不支持语言 ${lang}。`, {fix: `能用的：${project.languages.join('、')}，或者 pseudo（伪翻译）。`});

  // 1. 生成（不监听文件）：先清空上次的截图和生成物
  const out = buildDir(root, 'verify');
  const site = path.join(out, 'site');
  fs.rmSync(out, {recursive: true, force: true});
  await generateWeb(uiProjectPath(root), path.join(site, 'ui'));
  await generateProjectTypes(root, {validated: true});
  const model = readUiModel(uiProjectPath(root));
  const i18nDir = path.join(site, 'i18n');
  generateTranslations(root, model, project.languages, i18nDir, project.defaultLanguage);
  await generateFonts(root, project, model, path.join(site, 'ui', 'fonts'), 'woff2');
  const texts = readTexts(root, project.languages);
  const languages = [...project.languages];
  if (lang === 'pseudo') {
    // 伪翻译：从默认语言的文字（ui/ 里的原文和文本表）生成
    const entries = extractTexts(model);
    const base = {...Object.fromEntries(entries.map(e => [e.key, e.text])), ...texts[project.defaultLanguage]};
    texts.pseudo = pseudoTable(base);
    fs.writeFileSync(path.join(i18nDir, 'pseudo.xml'), translationXml(entries, texts.pseudo));
    languages.push('pseudo');
  }
  const verifyProject = {...project, languages};
  const entry = writeWebBootstrap(root, verifyProject, {texts, dir: site});
  try {
    await esbuild().build(webBuildOptions(root, entry, {outfile: path.join(site, 'app.js')}));
  } catch (error) {
    throw bundleErrors(error, root);
  }

  // 2. 随机端口起服务
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/__lgui/events') { res.writeHead(204).end(); return; }
    serveBuilt(site, url, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  // 要截哪些：尺寸 × 方向（去掉重复的画面）× 语言
  const shots = [];
  const langs = lang ? [lang] : [null];
  for (const l of langs) for (const shot of verifyShots(sizes)) shots.push({...shot, lang: l});
  if (lang === 'pseudo') {
    // 再按最长的那种语言，横竖各截一张
    const longest = project.languages.reduce((a, b) => tableLength(texts[b] ?? {}) > tableLength(texts[a] ?? {}) ? b : a);
    for (const shot of verifyShots([sizes[0]])) shots.push({...shot, lang: longest});
  }

  const browser = await launch();
  const results = [];
  try {
    for (const shot of shots) {
      const {viewport, safeArea} = shot;
      const page = await browser.newPage({viewport, locale: project.defaultLanguage});
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message ?? e)));
      try {
        // 模拟刘海：网页后端启动时读 window.__lguiSafeArea（CSS 像素，上右下左）
        await page.addInitScript(insets => { window.__lguiSafeArea = insets; }, safeArea);
        await page.goto(url);
        await page.waitForFunction(() => window.__lguiReady || document.getElementById('lgui-overlay')?.style.display === 'block', null, {timeout: 20000});
        if (shot.lang && shot.lang !== project.defaultLanguage) await page.evaluate(l => window.__lgui.lgui.setLanguage(l), shot.lang);
        if (view) {
          // 打开界面出的错在页面里接住，带着原来的错误码报出来（不让它变成命令行内部错误 LGUI-CLI-999）
          const opened = await page.evaluate(async ({name, params}) => {
            const V = window.__lgui.views[name];
            if (!V) return {missing: true};
            try { await window.__lgui.lgui.ui.open(V, params); return {ok: true}; } catch (e) { return {code: e?.code ?? null, message: String(e?.message ?? e)}; }
          }, {name: view, params});
          if (opened.missing) throw new LgCliError('LGUI-CLI-063', `src/modules/ 里没有导出名为 ${view} 的 View。`, {fix: '写 View 的类名，比如 BagView。'});
          if (!opened.ok) throw new LgCliError('LGUI-CLI-115', `打开 ${view}${params ? `（参数 ${JSON.stringify(params)}）` : ''} 时出错：${opened.code ? `${opened.code} ` : ''}${opened.message}`, {fix: params ? '按报错改参数或代码；参数的字段见这个 View 的 static params。' : `这个界面要参数的话，用 --params 传 JSON 对象，比如 --params '{"id":1}'（字段见这个 View 的 static params）；不然按报错改代码。`});
        }
        // 等框架判好方向、换好版，图片加载完
        const expected = project.orientation === 'both' ? shot.orientation : project.orientation;
        await page.waitForFunction(o => window.__lgui?.snapshot().orientation === o, expected, {timeout: 5000});
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);
        const name = `${shot.size.name}-${shot.orientation}${shot.lang ? `-${shot.lang}` : ''}`;
        const image = path.join(out, `${name}.png`);
        await page.screenshot({path: image});
        const snapshot = await page.evaluate(() => window.__lgui.snapshot());
        fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(snapshot, null, 2) + '\n');
        results.push({name, image: path.relative(root, image).split(path.sep).join('/'), viewport, safeArea, errors});
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  return {url, shots: results};
}

/** lgui verify 命令。 */
export async function verify({projectRoot, project, flags}) {
  let params;
  if (flags.params !== undefined) {
    if (!flags.view) throw new LgCliError('LGUI-CLI-114', '--params 要和 --view 一起用（传给 --view 打开的界面）。', {fix: `写成 --view BagView --params '{"tab":"equip"}'。`});
    try { params = JSON.parse(flags.params); } catch (error) { throw new LgCliError('LGUI-CLI-114', `--params 不是合法的 JSON：${error.message}`, {fix: `写成一个 JSON 对象，比如 --params '{"id":1}'（Windows 的 cmd 里写 --params "{\\"id\\":1}"）。`}); }
    if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new LgCliError('LGUI-CLI-114', `--params 要是一个 JSON 对象（现在是 ${flags.params}）。`, {fix: `写成 --params '{"id":1}'，字段见这个 View 的 static params。`});
  }
  const {shots} = await runVerify(projectRoot, project, {size: flags.size, view: flags.view, params, lang: flags.lang});
  const failed = shots.filter(s => s.errors.length);
  return {
    data: {shots},
    summary: [`截了 ${shots.length} 张图（.lgui/build/verify/，每张旁边有同名的界面快照 .json）：`, ...shots.map(s => `  ${s.image}  ${s.viewport.width}×${s.viewport.height}${Object.values(s.safeArea).some(Boolean) ? `  安全区（上右下左）${Object.values(s.safeArea).join(' ')}` : ''}${s.errors.length ? `  页面报错：${s.errors.join('；')}` : ''}`), '逐张看一遍：文字有没有被截断、横竖两版排得对不对。'],
    errors: failed.map(s => new LgCliError('LGUI-CLI-064', `截图 ${s.name} 时页面报错：${s.errors.join('；')}`, {fix: '按报错改代码；lgui dev 里能看到同样的错误。'}))
  };
}
