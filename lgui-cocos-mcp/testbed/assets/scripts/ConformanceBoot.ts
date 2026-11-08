// T008 一致性桥：预览页带 ?conf=<用例名> 时进入 conformance 模式（普通冒烟跳过）。
// cocos 端 = 真引擎控件 + CDP 合成输入（与 h5 runner 同哲学：本页把控件中心换算成页面像素，runner 经 __pw 派发真实输入，
// 走 cc 画布 → fairygui InputProcessor → 框架手势的完整链路；不做 simulateClick 直呼目标——命中测试也是被测面）。
// Node 侧 runner：__confCases 列用例、__confRun(name) 返回与 headless 同格式的快照、__confProbe 导出坐标校准数据。
import {Camera, director, Director, screen as ccScreen, UITransform, Vec2, Vec3, view} from 'cc';
import {EDITOR} from 'cc/env';
import * as fgui from 'fairygui-cc';
import {lgui} from '../lgui-framework/index';
import {createCocosBackend} from '../lgui-framework/backends/cocos/index';
import {stage} from '../lgui-framework/backends/cocos/screen';
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

/** 测试传进来的是 LGUI 包装对象（testing.ts 的 object(path)），取底层 fgui GObject。 */
const raw = (o: unknown): fgui.GObject => (o as {native: fgui.GObject}).native;
const centerCss = (o: unknown): Pt => worldToCss(objectCenterWorld(raw(o)));

// ---- 输入操作位 ----

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Pw = (op: string, ...args: unknown[]) => Promise<void>;
const pw = (...args: [string, ...unknown[]]) => (globalThis as unknown as {__pw: Pw}).__pw(...args);
/** 没接的操作统一走这里；runner 靠 T008d 字样把它们标成「待输入」。 */
const todo = (what: string): never => { throw new Error(`cocos 一致性测试的${what}在 T008d 接。`); };

/** 设计单位 → 页面像素：GRoot vanilla 挂载下内容世界尺寸 = 设计 × stage.scale，画布与视口 1:1，css = 设计 × stage.scale。 */
function designToCss(): number {
  return stage.scale || 1;
}

/** 按住 → 挪 → 松开（触摸轨迹，CDP 派发）。deltaX/Y 是设计坐标，换算成页面像素（设计和页面都是 y 向下，同号）。 */
async function touchPath(o: unknown, dx: number, dy: number, ms: number, steps: number): Promise<void> {
  const p = centerCss(o);
  const k = designToCss();
  await pw('touchPath', p.x, p.y, p.x + dx * k, p.y + dy * k, ms, steps);
  await wait(50);
}

const sim = {
  async click(_b: unknown, o: unknown, holdMs = 50, pointerType = 'mouse') {
    const p = centerCss(o);
    await pw('press', p.x, p.y, holdMs, pointerType);
    await wait(50);
  },
  async doubleClick(b: unknown, o: unknown) { await sim.click(b, o); await sim.click(b, o); },
  async hold(_b: unknown, o: unknown, ms: number) { const p = centerCss(o); await pw('press', p.x, p.y, ms); await wait(50); },
  drag: (_b: unknown, o: unknown, dx: number, dy: number) => touchPath(o, dx, dy, 400, 10),
  swipe: (_b: unknown, o: unknown, dx: number, dy: number) => touchPath(o, dx, dy, 80, 4),
  async dragTo(_b: unknown, from: unknown, to: unknown) {
    const a = centerCss(from), b = centerCss(to);
    await pw('touchPath', a.x, a.y, b.x, b.y, 400, 10);
    await wait(50);
  },
  pinch() { return todo('双指缩放'); },
  async wheel(_b: unknown, o: unknown, dy: number) { const p = centerCss(o); await pw('wheel', p.x, p.y, dy); await wait(50); },
  async key(_b: unknown, name: string) { await pw('key', name); await wait(50); },
  // 打字：点输入框（fairy 的 TOUCH_END 会 openKeyboard 聚焦隐藏的 DOM 输入）、全选，再真键盘逐字输入；
  // 回写落在字符之间由 CocosInput.set text 的聚焦直写保证（headless/h5 同语义）。空串=全选+一次退格（一次清空通知）。
  async type(_b: unknown, o: unknown, text: string) {
    await sim.click(_b, o);
    await pw('selectInput');
    if (text) await pw('type', text);
    else await pw('key', 'Backspace');
    await wait(80);
  },
  // 拖滑动条：按住滑块一次移到目标位置再松开（只发一次移动，FairyGUI 只通知一次）；值域夹取同 headless。
  // _barMaxWidth 是设计单位，位移按 GRoot↔视口的比例换算成页面像素（同 touchPath 的 k）。
  async setValue(_b: unknown, o: unknown, value: number) {
    const n = raw(o) as unknown as {_gripObject: fgui.GObject; _barMaxWidth: number; value: number; min: number; max: number};
    const from = centerCss({native: n._gripObject});
    const k = designToCss();
    const target = (Math.min(n.max, Math.max(n.min, value)) - n.min) / (n.max - n.min);
    const dx = (target - (n.value - n.min) / (n.max - n.min)) * n._barMaxWidth * k;
    await pw('mouseDrag', from.x, from.y, from.x + dx, from.y);
    await wait(80);
  },
  // 选下拉框：点开（此时下拉组件才创建），再点弹出列表里的那一项；列表在弹出层，centerCss 同样能换算。
  async choose(_b: unknown, o: unknown, index: number) {
    await sim.click(_b, o);
    const combo = raw(o) as unknown as {dropdown: {getChild(name: string): {getChildAt(index: number): fgui.GObject}}};
    const item = combo.dropdown.getChild('list').getChildAt(index);
    await wait(100); // 弹出层挂上舞台、worldPosition 就位
    await sim.click(_b, {native: item});
    await wait(80);
  },
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
      // conf 工程的设计尺寸按当前视口横竖取（orientation both），并跟着用例的 setScreen 重贴——
      // 不贴的话 GRoot 停在引擎遗留的 demo 设计分辨率上，所有输入坐标换算打偏（T008c 实测）。
      const pick = () => (window.innerHeight > window.innerWidth ? conf.designSize.portrait : conf.designSize.landscape);
      const fit = () => backend.platform.screen.applyDesignSize(pick());
      fit();
      backend.platform.screen.onResize(fit);
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
    // 坐标校准数据（T008c/d 迭代用）。两种模式：
    // 1) __confProbe(path)：起 app 后按用例同源的 object() 解析单个控件，导出换算坐标与命中。
    // 2) __confProbe(undefined, caseName)：跑整个用例，包一层 t.object，记录每次点击/拖拽目标的换算与命中——输入类差异的分诊入口。
    (globalThis as unknown as {__confProbe: (path?: string, caseName?: string) => Promise<unknown>}).__confProbe = async (path?: string, caseName?: string) => {
      const canvas = document.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect();
      const r = view.getViewportRect();
      const dpr = window.devicePixelRatio || 1;
      const page = {
        page: {w: window.innerWidth, h: window.innerHeight, dpr},
        canvas: rect ? {left: rect.left, top: rect.top, width: rect.width, height: rect.height} : null,
        cc: {windowSize: {...ccScreen.windowSize}, visibleSize: {...view.getVisibleSize()},
          scaleX: view.getScaleX(), scaleY: view.getScaleY(), viewport: {x: r.x, y: r.y, w: r.width, h: r.height}}
      };
      if (!path && !caseName) return {...page, note: 'GRoot 在 testing.start 时才建；带 path 或 caseName 会先启动 app 再算几何'};
      const t = await lgui.testing.start(app, {});
      if (caseName) {
        // 用例模式：t.object 每次解析都记下目标的 sim 页面坐标（centerCss，和派发点同源），
        // 顺带记录 platform 的 pointer 事件流；结束时导出活体几何（转屏类差异就看 fit/applyOrientation
        // 有没有生效：visibleSize 跟没跟窗口、stage.scale、方向）。T008d 输入位迭代的分诊入口。
        const ptr: string[] = [];
        backend.platform.input.onPointer(e => ptr.push(`${e.type}@${Math.round(e.x)},${Math.round(e.y)} ${e.pointerType}`));
        const probes: {path: string; css: Pt}[] = [];
        const orig = (t as unknown as {object: (p: string) => unknown}).object.bind(t);
        (t as unknown as {object: (p: string) => unknown}).object = (p: string) => {
          const o = orig(p) as {native?: fgui.GObject} | undefined;
          if (o?.native) probes.push({path: p, css: centerCss(o)});
          return o;
        };
        let result: unknown;
        let error: string | null = null;
        try { result = await cases[caseName].run(t); }
        catch (e) { error = String((e as {stack?: string}).stack ?? e).slice(0, 500); }
        const r = view.getViewportRect();
        const after = {window: [window.innerWidth, window.innerHeight], windowSize: {...ccScreen.windowSize},
          visibleSize: {...view.getVisibleSize()}, stageScale: stage.scale, gr: grRect(),
          viewport: {x: r.x, y: r.y, w: r.width, h: r.height},
          orientation: lgui.debug.snapshot().orientation};
        t.end();
        return {...page, probes, pointer: ptr, after, result, error};
      }
      // 用例同源解析：object() 能解析列表子项（list[1]）这类路径（ui.find 只认普通控件）。
      const obj = (t as unknown as {object: (p: string) => unknown}).object(path) as {native?: fgui.GObject} | undefined;
      const target = obj?.native;
      if (!target) { t.end(); return {...page, error: `object() 解析不到 ${path}`}; }
      const g = grRect();
      const s = stage.scale;
      // sim 实际请求的页面坐标（centerCss）与换算前的世界坐标（objectCenterWorld）分开看；
      // fairy 的命中测试按 GRoot 单位（y 翻转约定），用世界坐标反推 GRoot 局部点。
      const css = centerCss(obj);
      const world = objectCenterWorld(target);
      const hit = fgui.GRoot.inst.hitTest(new Vec2(world.x - g.left, g.top - world.y), true);
      const root = fgui.GRoot.inst;
      const btnNode = target.node;
      // 父链逐层看：cc 节点树里控件到场景根的每一层位置/缩放/锚点/尺寸（挂载链脱节就断在这中间）。
      const chain: {name: string; pos: number[]; world: number[]; scale: number[]; anchor: number[] | null; size: number[] | null}[] = [];
      for (let n = btnNode; n; n = n.parent) {
        const ut = (n as unknown as {_uiProps?: {uiTransformComp?: {anchorX: number; anchorY: number; contentSize: {width: number; height: number}}}})._uiProps?.uiTransformComp;
        chain.push({name: n.name || n.constructor.name, pos: [Math.round(n.position.x), Math.round(n.position.y)], world: [Math.round(n.worldPosition.x), Math.round(n.worldPosition.y)],
          scale: [n.scale.x, n.scale.y], anchor: ut ? [ut.anchorX, ut.anchorY] : null, size: ut ? [Math.round(ut.contentSize.width), Math.round(ut.contentSize.height)] : null});
      }
      const rootNode = root.node;
      const cam = rootNode.scene?.getChildByName('Canvas')?.getChildByName('Camera')?.getComponent(Camera);
      const camInfo = cam ? {worldPos: [cam.node.worldPosition.x, cam.node.worldPosition.y], orthoHeight: cam.orthoHeight} : null;
      t.end();
      return {...page, stageScale: s, gr: g, rootSize: {w: root.width, h: root.height, scale: root.scaleX},
        rootNode: {worldPos: [rootNode.worldPosition.x, rootNode.worldPosition.y], scale: [rootNode.scale.x, rootNode.scale.y],
          anchor: [rootNode.getComponent(UITransform)!.anchorX, rootNode.getComponent(UITransform)!.anchorY],
          size: [rootNode.getComponent(UITransform)!.contentSize.width, rootNode.getComponent(UITransform)!.contentSize.height]}, cam: camInfo,
        path: {world, css,
          target: {xy: [target.x, target.y], size: [target.width, target.height], name: target.name,
            nodeScale: [btnNode.scale.x, btnNode.scale.y], pivotAsAnchor: target.pivotAsAnchor, chain},
          hit: hit ? {name: hit.name, kind: hit.constructor.name} : null}};
    };
    console.log('[lgui-conf] 就绪，用例：', Object.keys(cases).join('、'));
  });
}
