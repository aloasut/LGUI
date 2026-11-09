// h5 项目字体：backend.init 在创建任何界面之前用 FontFace 加载好 ui/fonts/ 的子集（WOFF2），文字按字体名画出来，
// autoSize="shrink"（补丁 8）按项目字体量宽；字体文件拿不到时报 LGUI-RT-180，不悄悄换成系统字体。
// 对照：不传 fonts 时，init 完成时没有 loaded 的项目字体，Shrink 量出来的是回退字体的宽度。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture} from '../helpers/fixture.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';
import {generateWeb, uiProjectPath} from '../../plugin/tools/lib/generate/index.mjs';
import {readUiModel} from '../../plugin/tools/lib/generate/model.mjs';
import {generateFonts} from '../../plugin/tools/lib/generate/fonts.mjs';
import {validateProject} from '../../plugin/tools/lib/project.mjs';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';

const fw = fileURLToPath(new URL('../../plugin/framework', import.meta.url));
const sample = fileURLToPath(new URL('../fixtures/fonts/NotoSansSC-Sample.otf', import.meta.url));

async function build(fonts) {
  const root = writeFixture();
  fs.mkdirSync(path.join(root, 'ui/fonts'));
  fs.copyFileSync(sample, path.join(root, 'ui/fonts/Noto.otf'));
  // 一个要缩的单行文字（拉丁字母和数字：各字体宽度不同，汉字各字体都是 1 个字号宽，分不出来）、24 号，框宽 100
  const panel = path.join(root, 'ui/assets/Bag/BagPanel.xml');
  fs.writeFileSync(panel, fs.readFileSync(panel, 'utf8').replace('</displayList>', '<text id="n9" name="tip" xy="0,200" size="100,40" fontSize="24" autoSize="shrink" singleLine="true" text="Sell Gold 1234567"/>\n  </displayList>'));
  await generateWeb(uiProjectPath(root), path.join(root, 'web/ui'));
  const project = validateProject({name: 'fonts', lguiVersion: '0.3.0', defaultFont: 'Noto', languages: ['zh-CN']});
  assert.deepEqual(await generateFonts(root, project, readUiModel(uiProjectPath(root)), path.join(root, 'web/ui/fonts'), 'woff2'), ['Noto']);
  const entry = path.join(root, 'entry.ts');
  const f = rel => JSON.stringify(path.join(fw, rel));
  fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'fonts', defaultFont: 'Noto', fonts: ${JSON.stringify(fonts)}, uiBase: '/ui'});
  // 刚启动完、还没创建界面：项目字体的 FontFace 已经是 loaded
  const readyAtInit = [...document.fonts].some(f => f.family === 'Noto' && f.status === 'loaded');
  await backend.loadPackage('Bag');
  const panel = backend.create('Bag', 'BagPanel');
  backend.root.addChild(panel);
  Object.assign(window, {readyAtInit, panel, ready: true});
})().catch(e => { (window as any).failure = {code: e.code ?? null, message: String(e.message ?? e)}; });`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent', keepNames: true});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><body><script type="module" src="/app.js"></script>');
  return root;
}

// 页面里：init 时项目字体是否 loaded；Shrink 实际缩成的字号；按项目字体、按回退字体量宽算出来应该缩成的字号（同补丁 8 的算法）
const probe = () => {
  const span = window.panel.native.getChild('tip').element._span;
  const expected = family => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = `24px ${family}`;
    const m = c.measureText("Sell Gold 1234567");
    return 24 * (100 - 2 * 2) / Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  };
  return {
    readyAtInit: window.readyAtInit,
    faces: [...document.fonts].map(f => [f.family, f.status]),
    family: getComputedStyle(span).fontFamily,
    shrunk: parseFloat(span.style.fontSize),
    noto: expected('Noto'),
    fallback: expected(getComputedStyle(document.body).fontFamily)
  };
};

async function open(browser, fonts) {
  const root = await build(fonts);
  const server = await serve({'/': path.join(root, 'web')});
  const page = await browser.newPage({viewport: {width: 1280, height: 720}});
  await page.goto(server.url + '/index.html');
  await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 15000});
  return {page, server};
}

test('h5：项目字体在第一个界面之前 loaded，文字和 Shrink 都按它量；不加载时（对照）两条都不成立；字体 404 报 LGUI-RT-180', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    let notoSize;
    const {page, server} = await open(browser, ['Noto']);
    try {
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      const r = await page.evaluate(probe);
      assert.equal(r.readyAtInit, true);
      assert.deepEqual(r.faces, [['Noto', 'loaded']]);
      assert.equal(r.family, 'Noto');
      assert.ok(Math.abs(r.noto - r.fallback) > 0.3, `两种字体量出来要有差别才能区分（Noto ${r.noto}，回退 ${r.fallback}）`);
      assert.ok(Math.abs(r.shrunk - r.noto) < 0.01, `Shrink 缩成 ${r.shrunk}，按项目字体算是 ${r.noto}，按回退字体算是 ${r.fallback}`);
      notoSize = r.noto;
    } finally {
      await server.close();
    }

    // 对照：同样的界面不传 fonts。init 时没有 loaded 的 Noto，Shrink 按回退字体量
    const control = await open(browser, []);
    try {
      assert.equal(await control.page.evaluate(() => window.failure ?? null), null);
      const r = await control.page.evaluate(probe);
      assert.equal(r.readyAtInit, false);
      assert.ok(Math.abs(r.shrunk - r.fallback) < 0.01, `对照：Shrink 缩成 ${r.shrunk}，按回退字体算是 ${r.fallback}`);
      assert.ok(Math.abs(r.shrunk - notoSize) > 0.3, `对照：没加载项目字体时不该缩成按项目字体算的 ${notoSize}`);
    } finally {
      await control.server.close();
    }

    const missing = await open(browser, ['Noto', 'Missing']);
    try {
      const failure = await missing.page.evaluate(() => window.failure ?? null);
      assert.equal(failure?.code, 'LGUI-RT-180');
      assert.match(failure.message, /项目字体 Missing 加载失败（\/ui\/fonts\/Missing\.woff2）：HTTP 404/);
    } finally {
      await missing.server.close();
    }
  } finally {
    await browser.close();
  }
});
