// FairyGUI-dom 渲染补丁（plugin/framework/backends/h5/vendor/PATCHES.md 第 7–12 条）的浏览器测试：每条都先复现问题，再验证修好了。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWeb} from '../../plugin/tools/lib/generate/index.mjs';
import {sharp, esbuild} from '../../plugin/tools/lib/vendor.mjs';
import {serve, launchBrowser} from '../helpers/browser.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const h5 = path.join(repo, 'plugin/framework/backends/h5');
const xml = body => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;
const opened = new Set();
async function closeAll(browser) { for (const close of [...opened]) await close(); await browser.close(); }

// 一个 Test 包：resources 是 package.xml 里的条目，files 是组件 XML，images 是 {文件名: [宽, 高, [r, g, b]]}。
// patched=false 时不装钩子（上游原样 + .patch），用来证明问题确实存在。
async function open(browser, {resources, files, images = {}, patched = true, viewport = {width: 800, height: 600}, deviceScaleFactor = 1}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-render-'));
  const pkg = path.join(root, 'ui/assets/Test');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(path.join(root, 'ui/UI.fairy'), xml('<projectDescription id="render" type="Layabox" version="3.0"/>'));
  for (const [name, [w, h, [r, g, b]]] of Object.entries(images)) {
    await sharp()({create: {width: w, height: h, channels: 4, background: {r, g, b, alpha: 1}}}).png().toFile(path.join(pkg, name));
  }
  fs.writeFileSync(path.join(pkg, 'package.xml'), xml(`<packageDescription id="test0001"><resources>\n${resources}\n</resources></packageDescription>`));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(pkg, name), xml(body));
  await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `import * as fgui from ${JSON.stringify(path.join(h5, 'vendor/fairygui.module.js'))};
    import {installFairyGuiPatches} from ${JSON.stringify(path.join(h5, 'fairygui-patches/index.ts'))};
    (async () => {
      if (${patched}) installFairyGuiPatches();
      else (fgui.UIPackage as any).setImageManifest ??= () => {};
      if (${patched}) await (fgui.UIPackage as any).loadImageManifest('/ui/manifest.json');
      const pkg = await fgui.UIPackage.loadPackage('/ui/Test');
      if (!${patched}) for (const item of (pkg as any)._items) if (item.type === 0) item.file = '/ui/Test/' + item.id + '.png';
      const view = fgui.UIPackage.createObject('Test', 'Main');
      fgui.GRoot.inst.addChild(view);
      document.body.style.margin = '0';
      Object.assign(window, {fgui, view, ready: true});
    })().catch(error => { (window as any).failure = String(error); });`);
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent'});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}</style><body><script type="module" src="/app.js"></script>');
  const server = await serve({'/': path.join(root, 'web')});
  const context = await browser.newContext({viewport, deviceScaleFactor});
  const close = async () => { if (!opened.delete(close)) return; await context.close(); await server.close(); };
  opened.add(close);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(server.url + '/index.html');
  await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 15000});
  assert.equal(await page.evaluate(() => window.failure ?? null), null);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return {page, errors, close};
}

// 截一块区域，数像素：match(r, g, b) 为真的有几个，以及它们的外接矩形（CSS 像素，相对截图区域）。
async function pixels(page, clip, match, scale = 1) {
  const {data, info} = await sharp()(await page.screenshot({clip})).raw().toBuffer({resolveWithObject: true});
  let count = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const k = (y * info.width + x) * info.channels;
    if (!match(data[k], data[k + 1], data[k + 2])) continue;
    count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return {count, box: count ? {x0: x0 / scale, y0: y0 / scale, x1: (x1 + 1) / scale, y1: (y1 + 1) / scale} : null};
}

const near = (r, g, b, [R, G, B], tolerance = 60) => Math.abs(r - R) + Math.abs(g - G) + Math.abs(b - B) <= tolerance;
const BLACK = [0, 0, 0];

// 「露在字外多宽」量的是沿着字的边缘、描边伸出去的宽度，不是外接框：
// - 外接框每边只看最远的那一个像素，它落在字形最尖的地方（「1」的旗、「A」的尖），文字描边在尖角处是斜接（miter），
//   会比 outline 伸得更远，伸多少看字体和系统的栅格化。没修时（outline 8，应为 4）本机 13 种字体量出每边 3–6，
//   Windows 的 Times New Roman 在 outline 6（应为 3）时量出左 5，和修好后本机 Menlo、苹方、Impact 的左边一样，分不开。
// - 所以逐行（逐列）找「外侧是白底、内侧紧挨着字」的那一段描边，数它有几个像素；左、上、右、下各取中位数。
//   斜接、曲线、被描边填满的字间空隙只占少数段，中位数就是直边处的描边宽度。
// - 字和描边用同一个阈值分：白底的绿通道是 255，黑字和红描边都是 0，像素一半以上被盖住时绿通道 < 128。
//   原来按「接近黑」「接近红」分，两种颜色的抗锯齿边要盖住的程度不同，会多算或少算一个像素。
// 中位数和真实宽度允许差 2 像素：两端各按半个像素取整，最多差 1；各系统栅格化字和描边的边缘再差约 1。
// 所以修好后每边 ≥ outline - 2，没修时（描边一半压在字里）每边 ≤ outline / 2 + 2。outline 取 10，两个门槛（≥ 8 对 ≤ 7）
// 不重叠：没修时的量值过不了修好后的断言。本机实测没修每边 4–5，修好后 10–15。描边宽度是不是 2 × outline 由计算后的样式断言。
const OUTLINE = 10;
test('补丁 7：粗描边画在字外，不吃笔画（paint-order: stroke fill，每一边露在字外约 outline）', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const text = '1436 START 开始';
  const files = {'Main.xml': `<component size="800,300"><displayList>
    <text id="n0" name="plain" xy="10,10" size="700,80" fontSize="48" color="#000000" text="${text}"/>
    <text id="n1" name="stroked" xy="10,110" size="700,80" fontSize="48" color="#000000" strokeColor="#ff0000" strokeSize="${OUTLINE}" text="${text}"/>
  </displayList></component>`};
  const resources = '<component id="main0001" name="Main.xml" path="/" exported="true"/>';
  const area = {x: 0, y: 100, width: 760, height: 100};
  const fill = async page => ({
    plain: (await pixels(page, {x: 0, y: 0, width: 760, height: 100}, (r, g, b) => near(r, g, b, BLACK))).count,
    stroked: (await pixels(page, area, (r, g, b) => near(r, g, b, BLACK))).count
  });
  // 描边露在字外多宽（左、上、右、下，各方向的中位数）。字取上面那行没描边的同一段字（同字体、同位置，描边不影响排版）：
  // 没修时描边压住了大半笔画，带描边那行分不出哪里是字。
  const outside = async page => {
    const {data, info} = await sharp()(await page.screenshot({clip: {x: 0, y: 0, width: area.width, height: 200}})).raw().toBuffer({resolveWithObject: true});
    const width = info.width;
    const inked = (row, x, y) => x >= 0 && x < width && y >= 0 && y < 100 && data[((row + y) * width + x) * info.channels + 1] < 128;
    const glyph = (x, y) => inked(0, x, y), painted = (x, y) => inked(100, x, y);
    const outer = (x, y) => painted(x, y) && !glyph(x, y);
    const runs = [[], [], [], []];
    // 沿一条线走，找连续的「字外的描边」：前面是白底、后面是字，记进 before 方向；前面是字、后面是白底，记进 after 方向
    const scan = (lines, length, at, before, after) => {
      for (let i = 0; i < lines; i++) for (let j = 0; j < length; j++) {
        if (!outer(...at(i, j))) continue;
        const start = j;
        while (j + 1 < length && outer(...at(i, j + 1))) j++;
        const head = at(i, start - 1), tail = at(i, j + 1);
        if (!painted(...head) && glyph(...tail)) runs[before].push(j + 1 - start);
        else if (glyph(...head) && !painted(...tail)) runs[after].push(j + 1 - start);
      }
    };
    scan(100, width, (y, x) => [x, y], 0, 2);
    scan(width, 100, (x, y) => [x, y], 1, 3);
    const median = list => [...list].sort((a, b) => a - b)[list.length >> 1] ?? null;
    return {sides: runs.map(median), runs: runs.map(list => list.length)};
  };
  try {
    // 复现：不装补丁，描边一半压进笔画，黑色的字面只剩一小半；露在字外的只有一半宽
    const before = await open(browser, {resources, files, patched: false});
    const lost = await fill(before.page);
    const half = await outside(before.page);
    await before.close();
    assert.ok(lost.stroked < lost.plain * 0.5, `没修时字面被描边吃掉：${JSON.stringify(lost)}`);
    assert.ok(half.sides.every(side => side !== null && side <= OUTLINE / 2 + 2), `没修时每边露在字外不超过 outline / 2 + 2：${JSON.stringify(half)}`);

    const after = await open(browser, {resources, files});
    const kept = await fill(after.page);
    const style = await after.page.evaluate(() => { const s = getComputedStyle(window.view.getChild('stroked').element.querySelector('span.fgui-text')); return [s.paintOrder, s.webkitTextStrokeWidth]; });
    assert.deepEqual(style, ['stroke', `${OUTLINE * 2}px`], '先画描边再画字，描边宽度 2 × outline');
    assert.ok(kept.stroked > kept.plain * 0.9, `字面完整：${JSON.stringify(kept)}`);
    const out = await outside(after.page);
    assert.ok(out.sides.every(side => side !== null && side >= OUTLINE - 2), `每一边露在字外至少 outline - 2：${JSON.stringify(out)}`);
    assert.deepEqual(after.errors, []);
    await after.close();
  } finally {
    await closeAll(browser);
  }
});

test('补丁 8：autoSize="shrink" 缩小字号塞进框里（实际字面和描边都在控件框内），只在文字、尺寸、格式变化时测量', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const long = '这是一段很长很长的按钮标题 Long Title';
  const files = {'Main.xml': `<component size="800,600"><displayList>
    <graph id="g0" name="box0" xy="20,20" size="200,50" type="rect" lineSize="0" fillColor="#ffffff"/>
    <text id="n0" name="title" xy="20,20" size="200,50" fontSize="32" color="#000000" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="${long}"/>
    <text id="n1" name="stroked" xy="20,100" size="200,50" fontSize="32" color="#000000" strokeColor="#ff0000" strokeSize="3" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="${long}"/>
    <text id="n2" name="short" xy="20,180" size="200,50" fontSize="32" color="#000000" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="确定"/>
    <text id="n3" name="wrap" xy="300,20" size="200,120" fontSize="32" color="#000000" autoSize="shrink" text="多行文字自动换行，超出框的高度时也要缩小字号，直到整段都放得下为止。"/>
  </displayList></component>`};
  const resources = '<component id="main0001" name="Main.xml" path="/" exported="true"/>';
  const span = name => `window.view.getChild('${name}').element.querySelector('span.fgui-text')`;
  try {
    // 复现：不装补丁，字号不变，内容比框宽，被裁掉
    const before = await open(browser, {resources, files, patched: false});
    const clipped = await before.page.evaluate(`(() => { const s = ${span('title')}; return {font: s.style.fontSize, overflow: s.scrollWidth > s.clientWidth + 1}; })()`);
    await before.close();
    assert.deepEqual(clipped, {font: '32px', overflow: true}, '没修时只是裁掉');

    const {page, errors, close} = await open(browser, {resources, files});
    const state = name => page.evaluate(`(() => { const s = ${span(name)}; return {font: parseFloat(s.style.fontSize), overflow: getComputedStyle(s).overflow, scrollWidth: s.scrollWidth, scrollHeight: s.scrollHeight, width: s.clientWidth}; })()`);
    const title = await state('title');
    assert.ok(title.font < 32 && title.font > 10, `缩小了字号：${title.font}`);
    assert.ok(title.scrollWidth <= 200 + 1, `内容宽度不超过控件框：${title.scrollWidth}`);
    assert.equal((await state('short')).font, 32, '放得下的不缩');
    // 实际字面（黑色像素）和描边（红色像素）都在控件框内
    const dark = (r, g, b) => r + g + b < 450;
    const red = (r, g, b) => r > 150 && g < 120 && b < 120;
    for (const [name, y, match] of [['title', 20, dark], ['stroked', 100, red]]) {
      const ink = await pixels(page, {x: 0, y: y - 15, width: 260, height: 80}, match);
      assert.ok(ink.count > 100, `${name} 画出来了`);
      assert.ok(ink.box.x0 >= 20 - 0.5 && ink.box.x1 <= 220 + 0.5 && ink.box.y0 >= 15 - 0.5 && ink.box.y1 <= 15 + 50 + 0.5, `${name} 的字面在控件框里：${JSON.stringify(ink.box)}`);
    }
    // 多行：按整数字号缩到高度放得下
    const wrap = await state('wrap');
    assert.ok(wrap.font < 32 && Number.isInteger(wrap.font) && wrap.scrollHeight <= 120, `多行缩到放得下：${JSON.stringify(wrap)}`);

    // 只在变化时测：空等几帧不测；改文字、改尺寸、改字号各测一次（改尺寸用上次的结果，不再测）
    await page.evaluate(() => {
      window.measures = 0;
      const original = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function (text) { window.measures++; return original.call(this, text); };
    });
    await page.evaluate(() => new Promise(r => { let n = 10; const step = () => (--n ? requestAnimationFrame(step) : r()); requestAnimationFrame(step); }));
    assert.equal(await page.evaluate(() => window.measures), 0, '没有变化时不测');
    await page.evaluate(() => { window.view.getChild('title').text = '短'; });
    assert.equal((await state('title')).font, 32, '文字变短，字号回到原值');
    await page.evaluate(() => { window.view.getChild('title').text = '又变成了一段很长很长很长的标题文字'; });
    const narrow = (await state('title')).font;
    await page.evaluate(() => { window.view.getChild('title').setSize(400, 50); });
    const wide = (await state('title')).font;
    assert.ok(wide > narrow, `框变宽，字号跟着变大：${narrow} → ${wide}`);
    const measured = await page.evaluate(() => window.measures);
    assert.equal(measured, 2, '两次改文字各测一次，改尺寸不测');
    await page.evaluate(() => { window.view.getChild('title').setProp(window.fgui.ObjectPropID.FontSize, 40); });
    assert.equal(await page.evaluate(() => window.measures), measured + 1, '改字号重新测');
    // 改回不缩：字号回到原值、不再改
    await page.evaluate(() => { window.view.getChild('title').autoSize = window.fgui.AutoSizeType.Ellipsis; });
    assert.equal((await state('title')).font, 40);
    assert.deepEqual(errors, []);
    await close();
  } finally {
    await closeAll(browser);
  }
});

test('补丁 9：downEffect="scale" 的按压只是视觉效果，按钮跟兄弟控件一起拉宽时位置不变', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const files = {
    'Btn.xml': `<component size="200,60" extention="Button">
      <controller name="button" pages="0,up,1,down" selected="0"/>
      <displayList><graph id="n0" name="bg" xy="0,0" size="200,60" type="rect" lineSize="0" fillColor="#3366ff"><relation target="" sidePair="width-width,height-height"/></graph></displayList>
      <Button downEffect="scale" downEffectValue="0.8"/>
    </component>`,
    // chat 跟 safe 一起变宽（宽度关联兄弟控件，左边对齐）
    'Main.xml': `<component size="800,400"><displayList>
      <graph id="n0" name="safe" xy="0,0" size="400,100" type="rect" lineSize="0" fillColor="#eeeeee"/>
      <component id="n1" name="chat" src="btn00001" xy="100,20" size="200,60"><relation target="n0" sidePair="width-width,left-left"/></component>
    </displayList></component>`
  };
  const resources = `<component id="main0001" name="Main.xml" path="/" exported="true"/>
    <component id="btn00001" name="Btn.xml" path="/" exported="true"/>`;
  const run = async patched => {
    const {page, errors, close} = await open(browser, {resources, files, patched});
    const result = await page.evaluate(() => {
      const chat = window.view.getChild('chat');
      const safe = window.view.getChild('safe');
      safe.width = 600; // 宽屏：safe 变宽 200
      return {x: chat.x, width: chat.width, pivot: [chat.pivotX, chat.pivotY]};
    });
    return {page, errors, close, result};
  };
  try {
    // 复现：上游把轴心改成 0.5，按钮变宽时往左跑了一半宽度差
    const before = await run(false);
    await before.close();
    assert.deepEqual(before.result, {x: 0, width: 400, pivot: [0.5, 0.5]}, '没修时按钮往左跑了 100');

    const {page, errors, close, result} = await run(true);
    assert.deepEqual(result, {x: 100, width: 400, pivot: [0, 0]}, '修好后位置不变、轴心是 XML 里的');
    // 按下：这页没有 LGUI 框架接管（像加载器加载出来的按钮），保持 FairyGUI 原来的一下子缩小，但只改元素的 CSS scale：
    // 视觉缩到 0.8，GObject 的位置、尺寸、scale 不变；松开恢复。框架接管的按钮带缓动，见 tests/e2e/h5-tween.test.mjs。
    const box = await page.evaluate(() => { const r = window.view.getChild('chat').element.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width}; });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    const down = await page.evaluate(() => { const c = window.view.getChild('chat'); return {scale: c.element.style.scale, x: c.x, width: c.width, scaleX: c.scaleX, effect: c._downEffect, visual: Math.round(c.element.getBoundingClientRect().width)}; });
    await page.mouse.up();
    const up = await page.evaluate(() => { const c = window.view.getChild('chat'); return {scale: c.element.style.scale, x: c.x, scaleX: c.scaleX}; });
    assert.deepEqual(down, {scale: '0.8', x: 100, width: 400, scaleX: 1, effect: 0, visual: Math.round(box.width * 0.8)});
    assert.deepEqual(up, {scale: '', x: 100, scaleX: 1});
    assert.deepEqual(errors, []);
    await close();
  } finally {
    await closeAll(browser);
  }
});

test('补丁 10：界面离开舞台再回来（显示齿轮藏起来又显示），代码放的动效暂停后接着放，不停在半路', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  // fly：12 帧（0.5 秒）从 y=400 飞到 y=0；loop：一直来回改透明度；atEnd：options=4，离开舞台时照上游跳到结束
  const files = {'Main.xml': `<component size="800,600"><displayList>
      <graph id="n0" name="coin" xy="0,0" size="20,20" type="rect" lineSize="0" fillColor="#ffcc00"/>
      <graph id="n1" name="glow" xy="100,0" size="20,20" type="rect" lineSize="0" fillColor="#ffffff"/>
      <graph id="n2" name="gem" xy="200,0" size="20,20" type="rect" lineSize="0" fillColor="#00ccff"/>
    </displayList>
    <transition name="fly"><item time="0" type="XY" target="n0" duration="12" tween="true" startValue="0,400" endValue="0,0"/></transition>
    <transition name="loop"><item time="0" type="Alpha" target="n1" duration="12" tween="true" startValue="1" endValue="0.2" repeat="-1" yoyo="true"/></transition>
    <transition name="atEnd" options="4"><item time="0" type="XY" target="n2" duration="12" tween="true" startValue="200,400" endValue="200,0"/></transition>
  </component>`};
  const resources = '<component id="main0001" name="Main.xml" path="/" exported="true"/>';
  const scenario = async patched => {
    const {page, errors, close} = await open(browser, {resources, files, patched});
    // 不按墙上时间等（CI 机器忙时一段时间里可能一帧都没出）：放完马上离开舞台（这时 fly 在起点 y=400、正在放），
    // 再等真实条件：fly 不再在放（没修时离开舞台就停了；修好后放到结束），loop 在之后的 60 帧里透明度变没变。
    const removed = await page.evaluate(() => {
      const v = window.view;
      for (const name of ['fly', 'loop', 'atEnd']) v.getTransition(name).play(null, name === 'loop' ? -1 : 1);
      // 从容器里拿出来再放回去：和显示齿轮把界面藏起来又显示一样，都会收到「离开舞台」「回到舞台」
      window.fgui.GRoot.inst.removeChild(v); window.fgui.GRoot.inst.addChild(v);
      return {coin: v.getChild('coin').y, gem: v.getChild('gem').y};
    });
    await page.waitForFunction(() => !window.view.getTransition('fly').playing, null, {timeout: 10000});
    const loopMoved = await page.evaluate(() => new Promise(resolve => {
      const glow = window.view.getChild('glow'), first = glow.alpha;
      let frames = 60;
      const step = () => { if (Math.abs(glow.alpha - first) > 0.05) resolve(true); else if (--frames) requestAnimationFrame(step); else resolve(false); };
      requestAnimationFrame(step);
    }));
    const result = await page.evaluate(() => ({coin: window.view.getChild('coin').y, gem: window.view.getChild('gem').y, fly: window.view.getTransition('fly').playing, loop: window.view.getTransition('loop').playing}));
    await close();
    return {removed, result, loopMoved, errors};
  };
  try {
    // 复现：不装补丁，fly 停在半路，loop 停了
    const before = await scenario(false);
    assert.equal(before.result.coin, 400, '没修时金币停在离开舞台时的位置（起点），没放完');
    assert.equal(before.result.loop, false, '没修时循环动效停了');
    assert.equal(before.removed.gem, 0, 'options=4 离开舞台时跳到结束');

    const after = await scenario(true);
    assert.equal(after.result.coin, 0, '接着放到结束');
    assert.equal(after.result.fly, false);
    assert.equal(after.result.loop, true);
    assert.ok(after.loopMoved, '循环动效还在动');
    assert.equal(after.removed.gem, 0, 'options=4 照上游跳到结束');
    assert.deepEqual(after.errors, []);
  } finally {
    await closeAll(browser);
  }
});

test('动效目标是组：高级组在浏览器里能动；普通组生成时就被去掉了（连同指向它的动效条目），运行时拿不到', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  const files = {'Main.xml': `<component size="400,600"><displayList>
      <graph id="n0" name="a" xy="0,100" size="50,50" group="n1" type="rect" fillColor="#ff0000"/>
      <group id="n1" name="plain" xy="0,100" size="50,50"/>
      <graph id="n2" name="c" xy="200,100" size="50,50" group="n3" type="rect" fillColor="#0000ff"/>
      <group id="n3" name="adv" xy="200,100" size="50,50" advanced="true"/>
    </displayList>
    <transition name="moveP"><item time="0" type="XY" target="n1" duration="6" tween="true" startValue="0,400" endValue="0,100"/></transition>
    <transition name="moveA"><item time="0" type="XY" target="n3" duration="6" tween="true" startValue="200,400" endValue="200,100"/></transition>
  </component>`};
  try {
    const {page, errors, close} = await open(browser, {resources: '<component id="main0001" name="Main.xml" path="/" exported="true"/>', files});
    // 不按墙上时间等：play() 当场就把起点（y=400）设上了，之后每一帧才往前走；CI 机器忙时 100 毫秒里可能一帧都没出，
    // 读到的还是起点。所以只放到一半（endTime = 0.125 秒，总长 0.25 秒），等它真的放到那里（完成回调）再读：
    // 停下的位置按 0.125 秒算，和中间出了几帧无关。10 秒还没放到就是页面不出帧，直接报出来。
    const state = await page.evaluate(async () => {
      const v = window.view, child = v.getChild('c'), moveA = v.getTransition('moveA');
      const items = name => v.getTransition(name)._items.length;
      let start = null;
      const middle = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('10 秒内动效没放到一半：页面没有出帧')), 10000);
        moveA.play(() => { clearTimeout(timer); resolve(child.y); }, 1, 0, 0, 0.125);
        start = child.y;
      });
      return {plain: v.getChild('plain'), plainItems: items('moveP'), advItems: items('moveA'), start, middle};
    });
    assert.equal(state.plain, null, '普通组只在编辑器里有');
    assert.equal(state.plainItems, 0, '指向普通组的动效条目生成时去掉了（要靠 lgui check 提前报出来）');
    assert.equal(state.advItems, 1);
    assert.equal(state.start, 400, '一放就带着组里的控件到起点');
    assert.ok(state.middle > 100 && state.middle < 400, `放到一半时组里的控件在中间：y=${state.middle}`);
    assert.deepEqual(errors, []);
    await close();
  } finally {
    await closeAll(browser);
  }
});

// 九宫格细线（补丁 12）：走真实的 H5 后端（applyDesignSize 用 transform 缩放根节点），手机尺寸下截图。
// 细线是「比左右（或上下）两侧都亮的 1 像素」，叠深是「比两侧都暗的 1 像素」。GImage 和 Loader 两种 DOM 形式都查。
// 不透明的面板（纯色、外框 + 渐变）修后没有细线；整张半透明的、九宫格平铺的照旧用上游的 border-image（不叠深，也不改）。
async function ninePage(browser, patched) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-seam-'));
  const pkg = path.join(root, 'ui/assets/Test');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(path.join(root, 'ui/UI.fairy'), xml('<projectDescription id="seam" type="Layabox" version="3.0"/>'));
  const S = 96;
  const image = async (name, pixel) => {
    const raw = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) raw.set(pixel(x, y), (y * S + x) * 4);
    await sharp()(raw, {raw: {width: S, height: S, channels: 4}}).png().toFile(path.join(pkg, name + '.png'));
  };
  await image('opaque', () => [0, 160, 160, 255]);
  await image('frame', (x, y) => (x < 8 || y < 8 || x >= S - 8 || y >= S - 8) ? [30, 60, 90, 255] : [120, 160 + Math.round(y * 0.6), 220, 255]);
  await image('half', () => [0, 160, 160, 128]);
  const kinds = ['opaque', 'frame', 'half', 'tiled'];
  fs.writeFileSync(path.join(pkg, 'package.xml'), xml(`<packageDescription id="test0001"><resources>
    <component id="main0001" name="Main.xml" path="/" exported="true"/>
    <image id="img00000" name="opaque.png" path="/" exported="true" scale="9grid" scale9grid="30,30,36,36"/>
    <image id="img10000" name="frame.png" path="/" exported="true" scale="9grid" scale9grid="30,30,36,36"/>
    <image id="img20000" name="half.png" path="/" exported="true" scale="9grid" scale9grid="30,30,36,36"/>
    <image id="img30000" name="frame.png" path="/tile/" exported="true" scale="9grid" scale9grid="30,30,36,36" gridTile="15"/>
  </resources></packageDescription>`));
  fs.mkdirSync(path.join(pkg, 'tile'));
  fs.copyFileSync(path.join(pkg, 'frame.png'), path.join(pkg, 'tile/frame.png'));
  let items = '';
  kinds.forEach((kind, k) => {
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 262, y = 20 + k * 500, w = 230 + i * 7, h = 200 + i * 5;
      items += `<image id="g${kind}${i}" name="g${kind}${i}" src="img${k}0000" xy="${x},${y}" size="${w},${h}"/>`;
      items += `<loader id="l${kind}${i}" name="l${kind}${i}" xy="${x},${y + 230}" size="${w},${h}" url="ui://test0001img${k}0000" fill="scaleFree"/>`;
    }
  });
  fs.writeFileSync(path.join(pkg, 'Main.xml'), xml(`<component size="1080,2100"><displayList>${items}</displayList></component>`));
  await generateWeb(path.join(root, 'ui/UI.fairy'), path.join(root, 'web/ui'));
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, `import {createH5Backend} from ${JSON.stringify(path.join(h5, 'index.ts'))};
    (async () => {
      const backend = createH5Backend();
      await backend.init({projectName: 'seam', defaultFont: null, uiBase: '/ui'});
      await backend.loadPackage('Test');
      backend.platform.screen.applyDesignSize({width: 1080, height: 2100});
      const view = backend.create('Test', 'Main');
      backend.root.addChild(view);
      Object.assign(window, {view: (view as any).native, ready: true});
    })().catch(error => { (window as any).failure = String(error); });`);
  // 复现用：把补丁 12 换成空的
  const stub = path.join(root, 'no-nine-slice.ts');
  fs.writeFileSync(stub, 'export const nineSliceFields = [] as const; export const nineSliceAssigned = [] as const; export function installNineSlice(): void {} export function setNineSliceOverlap(_: number): void {}');
  const plugins = patched ? [] : [{name: 'no-nine-slice', setup(b) { b.onResolve({filter: /nine-slice$/}, () => ({path: stub})); }}];
  await esbuild().build({entryPoints: [entry], bundle: true, format: 'esm', target: 'es2020', outfile: path.join(root, 'web/app.js'), logLevel: 'silent', plugins});
  fs.writeFileSync(path.join(root, 'web/index.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}</style><body><script type="module" src="/app.js"></script>');
  const server = await serve({'/': path.join(root, 'web')});
  const sizes = [[375, 812, 3], [390, 844, 3], [320, 568, 2], [414, 896, 2], [1280, 720, 1]];
  const result = {};
  try {
    for (const [width, height, dpr] of sizes) {
      const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: dpr});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(server.url + '/index.html');
      await page.waitForFunction(() => window.ready || window.failure, null, {timeout: 15000});
      assert.equal(await page.evaluate(() => window.failure ?? null), null);
      // 不按墙上时间等：每个九宫格都画上了（补丁 12 的 9 块，或照旧 border-image；补丁 12 看完透明度之前两样都没有），
      // 用到的图片都解码完，再等两帧画到屏幕上
      await page.evaluate(async () => {
        const nines = [];
        for (let i = 0; i < window.view.numChildren; i++) { const c = window.view.getChildAt(i); nines.push(c.element.matches('fgui-img') ? c.element : c.element.firstElementChild); }
        const painted = el => el.querySelectorAll('[data-lgui-nine]').length === 9 || getComputedStyle(el).borderImageSource !== 'none';
        const deadline = performance.now() + 10000;
        while (!nines.every(painted)) {
          if (performance.now() > deadline) throw new Error('10 秒内九宫格没画上');
          await new Promise(r => requestAnimationFrame(r));
        }
        const urls = new Set();
        for (const el of nines) for (const node of [el, ...el.querySelectorAll('[data-lgui-nine]')]) {
          const style = getComputedStyle(node);
          for (const value of [style.borderImageSource, style.backgroundImage]) { const url = /^url\("?(.*?)"?\)$/.exec(value)?.[1]; if (url) urls.add(url); }
        }
        await Promise.all([...urls].map(url => { const image = new Image(); image.src = url; return image.decode(); }));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const boxes = await page.evaluate(() => { const out = []; for (let i = 0; i < window.view.numChildren; i++) { const c = window.view.getChildAt(i); const el = c.element.matches('fgui-img') ? c.element : c.element.firstElementChild; const r = c.element.getBoundingClientRect(); out.push({name: c.name, x: r.x, y: r.y, w: r.width, h: r.height, pieces: el.querySelectorAll('[data-lgui-nine]').length, borderImage: getComputedStyle(el).borderImageSource !== 'none', repeat: getComputedStyle(el).borderImageRepeat}); } return out; });
      const {data, info} = await sharp()(await page.screenshot({fullPage: true})).raw().toBuffer({resolveWithObject: true});
      const lum = k => data[k] + data[k + 1] + data[k + 2];
      for (const b of boxes) {
        const kind = b.name.slice(1).replace(/\d+$/, '');
        const r = result[kind] ??= {light: 0, dark: 0, pieces: new Set(), borderImage: new Set(), repeat: new Set()};
        r.pieces.add(b.pieces); r.borderImage.add(b.borderImage); r.repeat.add(b.repeat);
        for (let y = Math.ceil(b.y * dpr) + 2; y < Math.min(Math.floor((b.y + b.h) * dpr) - 2, info.height - 1); y++) {
          for (let x = Math.ceil(b.x * dpr) + 2; x < Math.min(Math.floor((b.x + b.w) * dpr) - 2, info.width - 1); x++) {
            const k = (y * info.width + x) * info.channels, c = lum(k), step = info.channels, row = info.width * info.channels;
            if ((c > lum(k - step) + 15 && c > lum(k + step) + 15) || (c > lum(k - row) + 15 && c > lum(k + row) + 15)) r.light++;
            if ((c < lum(k - step) - 15 && c < lum(k + step) - 15) || (c < lum(k - row) - 15 && c < lum(k + row) - 15)) r.dark++;
          }
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await server.close();
  }
  for (const r of Object.values(result)) for (const key of ['pieces', 'borderImage', 'repeat']) r[key] = [...r[key]];
  return result;
}

test('补丁 12：九宫格在分数缩放下没有细线（不透明的面板），半透明、平铺的照旧', async t => {
  const browser = await launchBrowser();
  if (!browser) { t.skip('未找到 Chrome 或 Edge'); return; }
  try {
    // 复现：不装补丁 12，5 种尺寸下纯色和外框面板都有细线
    const before = await ninePage(browser, false);
    assert.ok(before.opaque.light > 1000 && before.frame.light > 1000, `没修时有细线：${JSON.stringify(before)}`);

    const after = await ninePage(browser, true);
    assert.deepEqual([after.opaque.light, after.frame.light], [0, 0], `不透明的面板没有细线：${JSON.stringify(after)}`);
    assert.deepEqual([after.opaque.pieces, after.frame.pieces], [[9], [9]], '不透明的面板分成 9 块画');
    // 半透明、平铺：照旧一个元素的 border-image，结果和不装补丁一样（不叠深）
    assert.deepEqual([after.half.pieces, after.half.borderImage, after.tiled.pieces, after.tiled.borderImage, after.tiled.repeat], [[0], [true], [0], [true], ['repeat']]);
    assert.deepEqual([after.half.light, after.half.dark, after.tiled.dark], [before.half.light, before.half.dark, before.tiled.dark], '半透明、平铺的和不装补丁时一样');
    for (const kind of ['opaque', 'frame']) assert.ok(after[kind].dark <= before[kind].dark, `${kind} 没有叠出深线：${after[kind].dark} ≤ ${before[kind].dark}`);
  } finally {
    await closeAll(browser);
  }
});
