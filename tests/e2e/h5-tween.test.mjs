// h5：代码补间和按钮的按下与回弹在真实浏览器里走 FairyGUI 的属性（缩放、透明度、颜色、字号、填充、位置），
// 齿轮和 ui/ 动效的主人查得到；按下效果写元素的 CSS scale（补丁 9），GObject 的位置、scale 不变。
// 时间按动效的时钟（Timers.time）判断，等的是条件，不按墙上时间。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture, bagPanel} from '../helpers/fixture.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';
import {generateWeb, generateProjectTypes} from '../../plugin/tools/lib/generate/index.mjs';
import {esbuild} from '../../plugin/tools/lib/vendor.mjs';

const fw = fileURLToPath(new URL('../../plugin/framework', import.meta.url));

const extra = `
    <image id="t1" name="coin" src="flag0001" xy="100,300" size="64,64" pivot="0.5,0.5"/>
    <image id="t3" name="cool" src="flag0001" xy="300,300" size="64,64" pivot="0.5,0.5" fillMethod="radial360" fillAmount="100"/>
    <text id="t4" name="price" xy="0,400" size="200,40" fontSize="20" color="#ffffff" autoSize="none" text="100"/>
    <component id="t7" name="claim" src="pbtn0001" xy="600,600" size="160,56"/>
    <loader id="t8" name="holder" xy="900,600" size="160,56" url="ui://bag00001pbtn0001"/>
    <image id="tb" name="geared" src="flag0001" xy="400,300" size="64,64" pivot="0.5,0.5"><gearSize controller="tabs" pages="0,1" values="64,64,1,1|80,80,1,1"/></image>`;
const motion = `
  <transition name="blink">
    <item time="0" type="Alpha" target="t1" tween="true" startValue="1" endValue="0" duration="240"/>
  </transition>`;
const panel = size => bagPanel({size, extra}).replace(/<\/component>\s*$/, `${motion}\n</component>\n`);

test('h5：代码补间写 FairyGUI 的属性；按钮按下与回弹写 CSS scale；齿轮、动效的主人查得到', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    const root = writeFixture(undefined, {landscape: panel('1920,1080'), portrait: panel('1080,1920')});
    const bag = path.join(root, 'ui/assets/Bag');
    const pkg = path.join(bag, 'package.xml');
    fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace('</resources>', '    <component id="pbtn0001" name="PressBtn.xml" path="/" exported="true"/>\n  </resources>'));
    fs.writeFileSync(path.join(bag, 'PressBtn.xml'), `<?xml version="1.0" encoding="utf-8"?>
<component size="160,56" extention="Button">
  <controller name="button" pages="0,up,1,down" selected="0"/>
  <displayList><graph id="n1" name="bg" xy="0,0" size="160,56" type="rect" lineSize="0" fillColor="#3366ff"/><text id="n0" name="title" xy="0,0" size="160,56" fontSize="24" autoSize="none" text="领取"/></displayList>
  <Button downEffect="scale" downEffectValue="0.8"/>
</component>
`);
    await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
    const {deps} = await generateProjectTypes(root);
    const entry = path.join(root, 'entry.ts');
    const f = rel => JSON.stringify(path.join(fw, rel));
    fs.writeFileSync(entry, `import {createH5Backend} from ${f('backends/h5/index.ts')};
import {boot} from ${f('mvc/boot.ts')};
import {defaultConfig} from ${f('mvc/runtime.ts')};
import {lgui, View} from ${f('index.ts')};
import {Timers} from ${f('backends/h5/vendor/fairygui.module.js')};
class MainView extends View<any> { static component = 'Bag/BagPanel'; static layer = 'page' as const; static fullScreen = true; static bothOrientations = true; }
(async () => {
  const backend = createH5Backend();
  await backend.init({projectName: 'demo', defaultFont: null, uiBase: '/ui'});
  await boot(backend, {backend: 'h5', start() {}}, defaultConfig, ${JSON.stringify(deps)}, {language: 'zh-CN', texts: {'zh-CN': {'lgui.back': '返回', 'lgui.requestFailed': '请求失败（{code}）'}}});
  const view: any = await lgui.ui.open(MainView);
  const c = view.__component;
  const native = (name: string) => c.child(name).native;
  const center = (name: string) => { const r = native(name).element.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; };
  const error = (run: () => unknown) => { try { run(); return null; } catch (e: any) { return e.code; } };
  Object.assign(window, {
    clock: () => Timers.time,
    run: () => { let done = false; view.tween(c.child('coin'), {scale: 1.5, alpha: 0.5, dx: 40, rotation: 90}, {duration: 300}).then(() => { done = true; });
      view.tween(c.child('price'), {color: '#ff0000', fontSize: 30}, {duration: 300});
      view.tween(c.child('cool'), {fillAmount: 0.25}, {duration: 300});
      return {at: Timers.time, done: () => done}; },
    look: () => { const coin = native('coin'), price = native('price'), cool = native('cool');
      return {coin: [coin.scaleX, coin.scaleY, coin.alpha, coin.x, coin.rotation], price: [price.color, price.getProp(8)], cool: cool.fillAmount, tweens: lgui.debug.snapshot().views[0].tweens}; },
    press: () => { const n = native('claim'); return {scale: n.element.style.scale, x: n.x, scaleX: n.scaleX}; },
    loaded: () => { const n = native('holder').component; return n ? {scale: n.element.style.scale, scaleX: n.scaleX} : null; },
    center,
    conflicts: () => [error(() => view.tween(c.child('geared'), {scale: 2}, {duration: 10})), error(() => view.tween(c.child('claim'), {scaleX: 2}, {duration: 10})),
      (c.transition('blink').play(), error(() => view.tween(c.child('coin'), {alpha: 1}, {duration: 10})))],
    ready: true
  });
})().catch(e => { (window as any).failure = String(e); });`);
    await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
    fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><script type="module" src="/app.js"></script>');
    const server = await serve({'/': path.join(root, 'web')});
    try {
      const page = await browser.newPage({viewport: {width: 1280, height: 720}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 20000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);

      // 代码补间：等动效时钟走过 300 毫秒，各项都到终值，补间数回到 0
      const start = await page.evaluate(() => { window.started = window.run(); return window.started.at; });
      await page.waitForFunction(at => window.clock() - at >= 400 && window.started.done(), start, {timeout: 10000});
      const look = await page.evaluate(() => window.look());
      assert.deepEqual(look, {coin: [1.5, 1.5, 0.5, 140, 90], price: [0xff0000, 30], cool: 0.25, tweens: 0});

      // 按下：缩到 0.8（元素的 CSS scale）；GObject 的位置、scale 不变。松开：弹回，CSS scale 清掉
      const p = await page.evaluate(() => window.center('claim'));
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForFunction(() => window.press().scale === '0.8', null, {timeout: 5000});
      assert.deepEqual(await page.evaluate(() => window.press()), {scale: '0.8', x: 600, scaleX: 1});
      await page.mouse.up();
      await page.waitForFunction(() => window.press().scale === '', null, {timeout: 5000});
      assert.deepEqual(await page.evaluate(() => window.press()), {scale: '', x: 600, scaleX: 1});

      // 加载器加载出来的按钮框架走不到：保持 FairyGUI 原来的一下子缩小（只改 CSS scale），松开恢复——和 Unity 上一样
      const q = await page.evaluate(() => window.center('holder'));
      await page.mouse.move(q.x, q.y);
      await page.mouse.down();
      assert.deepEqual(await page.evaluate(() => window.loaded()), {scale: '0.8', scaleX: 1});
      await page.mouse.up();
      assert.deepEqual(await page.evaluate(() => window.loaded()), {scale: '', scaleX: 1});

      // 主人：gearSize、downEffect="scale"、正在放的动效
      assert.deepEqual(await page.evaluate(() => window.conflicts()), ['LGUI-RT-282', 'LGUI-RT-282', 'LGUI-RT-282']);
      assert.deepEqual(errors, []);
    } finally {
      await server.close();
    }
  } finally {
    await browser.close();
  }
});
