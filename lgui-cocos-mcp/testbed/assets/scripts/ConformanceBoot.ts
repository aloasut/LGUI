// T008 一致性桥：预览页带 ?conf=<用例名> 时进入 conformance 模式（普通冒烟跳过）。
// cocos 端 = 真引擎控件 + CDP 合成输入（与 h5 runner 同哲学：本页把控件中心换算成页面像素，runner 经 __pw 派发真实输入，
// 走 cc 画布 → fairygui InputProcessor → 框架手势的完整链路；不做 simulateClick 直呼目标——命中测试也是被测面）。
// Node 侧 runner：__confCases 列用例、__confRun(name) 返回与 headless 同格式的快照、__confProbe 导出坐标校准数据。
import {director, Director, screen as ccScreen, UITransform, Vec3, view} from 'cc';
import {EDITOR} from 'cc/env';
import * as fgui from 'fairygui-cc';
import {lgui} from '../lgui-framework/index';
import {createCocosBackend} from '../lgui-framework/backends/cocos/index';
import {capture} from '../conf-src/conformance/harness';
import layout from '../conf-src/conformance/layout';
import app from '../conf-src/src/main';
import {cases} from './conf-cases';
import {conf} from './conf-config';

// ---- 坐标换算：fairy 局部 → cc 世界 → 页面 CSS 像素 ----

type Pt = {x: number; y: number};

/** 控件中心（cc 世界坐标，y 向上）。复刻运行库 localToGlobal 的锚点修正，去掉它按 GRoot.height 的翻转（本后端 GRoot 逻辑尺寸是设计区域，与世界的换算由 GRoot 节点自身承担）。 */
function objectCenterWorld(o: fgui.GObject): Pt {
  const node = o.node;
  const wt = node.getComponent(UITransform)!;
  const s = new Vec3(o.width / 2, -o.height / 2, 0);
  if (!o.pivotAsAnchor) {
    s.x -= wt.anchorX * o.width;
    s.y += (1 - wt.anchorY) * o.height;
  }
  const world = wt.convertToWorldSpaceAR(s, new Vec3());
  return {x: world.x, y: world.y};
}

/** GRoot 的世界矩形（y 向上）。applyDesignSize 保证它覆盖引擎可视区域。 */
function grRect(): {left: number; top: number; width: number; height: number} {
  const node = fgui.GRoot.inst.node;
  const wt = node.getComponent(UITransform)!;
  const width = wt.contentSize.width * node.worldScale.x;
  const height = wt.contentSize.height * node.worldScale.y;
  return {
    left: node.worldPosition.x - wt.anchorX * width,
    top: node.worldPosition.y + (1 - wt.anchorY) * height,
    width, height
  };
}

/** cc 游戏视口的页面矩形（原点左上、CSS 像素）。 */
function viewportCss(): {left: number; top: number; width: number; height: number} {
  const r = view.getViewportRect();
  const dpr = window.devicePixelRatio || 1;
  const height = ccScreen.windowSize.height / dpr;
  return {left: r.x / dpr, top: height - (r.y + r.height) / dpr, width: r.width / dpr, height: r.height / dpr};
}

/** cc 世界 → 页面 CSS 像素：GRoot 世界矩形 ↔ 游戏视口页面矩形做仿射。 */
function worldToCss(world: Pt): Pt {
  const vp = viewportCss();
  const g = grRect();
  return {
    x: vp.left + (world.x - g.left) / g.width * vp.width,
    y: vp.top + (g.top - world.y) / g.height * vp.height
  };
}

const centerCss = (o: fgui.GObject): Pt => worldToCss(objectCenterWorld(o));

// ---- 输入操作位 ----

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Pw = (op: string, ...args: unknown[]) => Promise<void>;
const pw = (...args: [string, ...unknown[]]) => (globalThis as unknown as {__pw: Pw}).__pw(...args);
/** 没接的操作统一走这里；runner 靠 T008d 字样把它们标成「待输入」。 */
const todo = (what: string): never => { throw new Error(`cocos 一致性测试的${what}在 T008d 接。`); };

/** 按住 → 挪 → 松开（触摸轨迹，CDP 派发）。deltaX/Y 是设计坐标，换算成页面像素。 */
async function touchPath(o: fgui.GObject, dx: number, dy: number, ms: number, steps: number): Promise<void> {
  const p = centerCss(o);
  const vp = viewportCss();
  const g = grRect();
  const k = vp.width / g.width; // 设计单位 → 页面像素（横纵同比，fitDesign 等比缩放）
  await pw('touchPath', p.x, p.y, p.x + dx * k, p.y - dy * k, ms, steps);
  await wait(50);
}

const sim = {
  async click(_b: unknown, o: unknown, holdMs = 50, pointerType = 'mouse') {
    const p = centerCss(o as fgui.GObject);
    await pw('press', p.x, p.y, holdMs, pointerType);
    await wait(50);
  },
  async doubleClick(b: unknown, o: unknown) { await sim.click(b, o); await sim.click(b, o); },
  async hold(_b: unknown, o: unknown, ms: number) { const p = centerCss(o as fgui.GObject); await pw('press', p.x, p.y, ms); await wait(50); },
  drag: (_b: unknown, o: unknown, dx: number, dy: number) => touchPath(o as fgui.GObject, dx, dy, 400, 10),
  swipe: (_b: unknown, o: unknown, dx: number, dy: number) => touchPath(o as fgui.GObject, dx, dy, 80, 4),
  async dragTo(_b: unknown, from: unknown, to: unknown) {
    const a = centerCss(from as fgui.GObject), b = centerCss(to as fgui.GObject);
    await pw('touchPath', a.x, a.y, b.x, b.y, 400, 10);
    await wait(50);
  },
  pinch() { return todo('双指缩放'); },
  async wheel(_b: unknown, o: unknown, dy: number) { const p = centerCss(o as fgui.GObject); await pw('wheel', p.x, p.y, dy); await wait(50); },
  async key(_b: unknown, name: string) { await pw('key', name); await wait(50); },
  type() { return todo('打字'); },
  setValue() { return todo('拖滑动条'); },
  choose() { return todo('选下拉框'); },
  setSafeArea() { return todo('安全区注入'); },
  async setScreen(_b: unknown, width: number, height: number) { await pw('viewport', width, height); await wait(50); },
  advance: (_b: unknown, ms: number) => wait(ms),
};

if (!EDITOR && new URL(location.href).searchParams.get('conf')) {
  // 场景 launch 完才初始化（init 要挂 Canvas，getScene 在 launch 前不可靠）。
  director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
    const backend = createCocosBackend();
    const init = backend.init.bind(backend);
    backend.init = async options => {
      await init({...options, uiBase: 'conf-ui', i18nBase: 'i18n', defaultFont: conf.defaultFont});
      return backend;
    };
    (globalThis as unknown as {__lguiTest: unknown}).__lguiTest = {
      createBackend: () => backend,
      sim,
      deps: conf.deps,
      config: conf,
      texts: conf.texts,
      current: null
    };
    (globalThis as unknown as {__confCases: string[]}).__confCases = Object.keys(cases);
    (globalThis as unknown as {__confRun: (name: string) => Promise<unknown>}).__confRun = async name => {
      const c = cases[name];
      if (!c) throw new Error(`没有用例 ${name}（有：${Object.keys(cases).join('、')}）`);
      const t = await lgui.testing.start(app, {});
      const result = capture(t, layout, await c.run(t));
      t.end();
      return result;
    };
    // 坐标校准数据（T008d 迭代用）：页面、cc 视图、GRoot 三个层面的原始几何。
    (globalThis as unknown as {__confProbe: () => unknown}).__confProbe = () => {
      const canvas = document.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect();
      const r = view.getViewportRect();
      const dpr = window.devicePixelRatio || 1;
      const g = grRect();
      return {
        page: {w: window.innerWidth, h: window.innerHeight, dpr},
        canvas: rect ? {left: rect.left, top: rect.top, width: rect.width, height: rect.height} : null,
        cc: {windowSize: {...ccScreen.windowSize}, visibleSize: {...view.getVisibleSize()},
          scaleX: view.getScaleX(), scaleY: view.getScaleY(), viewport: {x: r.x, y: r.y, w: r.width, h: r.height}},
        gr: g,
        sample: worldToCss({x: g.left + g.width / 2, y: g.top - g.height / 2})
      };
    };
    console.log('[lgui-conf] 就绪，用例：', Object.keys(cases).join('、'));
  });
}
