// lgui.testing：只在 lgui test 里能用。用 headless 后端和假时钟启动 app（lgui test --browser 换成 h5 后端和真浏览器），提供模拟操作和读控件属性。
// 路径写成「包/组件.控件路径」，列表子项用 list[序号]。
// headless 只算规则、不算布局：读到布局算出来的位置和尺寸、改属性的齿轮管着的属性时报 LGUI-RT-260（要测就用 --browser）。
import type {Backend, Insets, UIComponent, UIController, UIList, UIObject, UIText, UIButton, UILabel, UISlider, UIComboBox, UIMovieClip} from '../core/index';
import {LgRuntimeError, notImplemented} from '../core/index';
import type {AppDefinition, Look, Snapshot, TestHarness} from './lgui';
import type {TweenProp} from '../core/index';
import {engineState, originOf, tweened} from './tween/index';
import type {InputType, ParamsOf, ViewClass} from './types';
import type {RuntimeConfig} from './runtime';
import type {TextTable} from './i18n';
import {boot} from './boot';
import {inputType} from './input/input-type';
import type {UIManager} from './ui/manager';
import {snapshot} from './snapshot';
import {artTextOf} from './art-text';

/** 测试要读的状态：headless 后端自己记；lgui test --browser 在 h5 后端的日志、声音出口上记（一致性测试的 h5 没有它）。 */
interface TestState {
  /** 屏幕尺寸（只有 headless 有）。 */
  screen?: {width: number; height: number};
  sounds: {url: string; volume: number}[];
  music: {url: string; volume: number} | null;
  logs: {level: string; event: string; data?: unknown; error?: unknown}[];
}

/** headless 对象上记的：哪些位置、尺寸由 headless 不算的布局决定（见 backends/headless/objects.ts 的 LayoutUnknown）。 */
type UnknownLayout = {unknownLayout?: {position: string | null; size: string | null}};

/** lgui test 注入的测试环境（由生成的 .lgui/build/test/env.ts 设置）。 */
interface TestEnv {
  createBackend(): Backend & {state?: TestState};
  sim: Record<string, (...args: never[]) => Promise<void> | void>;
  deps: Record<string, string[]>;
  config: RuntimeConfig;
  texts: Record<string, TextTable>;
  /** 项目字体的名字（ui/fonts/）；headless 只登记。 */
  fonts?: string[];
  /** 每个测试结束后（afterEach）：记下当前快照（失败时 lgui test 附上它），再收尾（见 Harness.finish）。 */
  current: {snapshot(): Snapshot; finish(passed: boolean): string | null} | null;
}

type Sim = {
  click(b: Backend, o: UIObject, holdMs?: number, pointerType?: string): Promise<void>;
  doubleClick(b: Backend, o: UIObject): Promise<void>;
  hold(b: Backend, o: UIObject, ms: number): Promise<void>;
  drag(b: Backend, o: UIObject, dx: number, dy: number): Promise<void>;
  dragTo(b: Backend, from: UIObject, to: UIObject): Promise<void>;
  swipe(b: Backend, o: UIObject, dx: number, dy: number): Promise<void>;
  pinch(b: Backend, o: UIObject, scale: number): Promise<void>;
  wheel(b: Backend, o: UIObject, dy: number): Promise<void>;
  key(b: Backend, name: string): Promise<void>;
  type(b: Backend, o: UIObject, text: string): Promise<void>;
  setValue(b: Backend, o: UIObject, value: number): Promise<void>;
  choose(b: Backend, o: UIObject, index: number): Promise<void>;
  setScreen(b: Backend, w: number, h: number): Promise<void>;
  setSafeArea(b: Backend, insets: Insets): Promise<void>;
  advance(b: Backend, ms: number): Promise<void>;
};

const env = (): TestEnv => {
  const found = (globalThis as {__lguiTest?: TestEnv}).__lguiTest;
  if (!found) throw new LgRuntimeError('LGUI-RT-110', 'lgui.testing 只能在 lgui test 里用。', '用 lgui test 跑 tests/ 里的测试。');
  return found;
};

class Harness implements TestHarness {
  /** 已经检查过的日志条数。 */
  private checked = 0;
  /** 调用过 end()（或者测试结束时已经收过尾）。 */
  private ended = false;

  constructor(private readonly backend: Backend & {state?: TestState}, private readonly ui: UIManager, private readonly sim: Sim) {}

  private get state(): TestState {
    if (!this.backend.state) throw notImplemented('t.sounds()、t.music()（只有 lgui test 记下声音，headless 和 --browser 都记）', this.backend.name);
    return this.backend.state;
  }

  /** 记了 error 级的日志（代码或界面写错了，或者游戏代码自己记了 error），这个测试就失败（LGUI-RT-176）。每次模拟操作之后和测试结束时检查。 */
  checkLogs(): void {
    const logs = this.backend.state?.logs ?? []; // h5 上的日志在浏览器控制台里，不检查
    const found = logs.slice(this.checked).find(r => r.level === 'error');
    this.checked = logs.length;
    if (!found) return;
    const data = found.data as {code?: string; message?: string} | undefined;
    const reason = data?.message ? `${data.code ?? ''}  ${data.message}` : found.error instanceof Error ? found.error.message : JSON.stringify(found.data ?? null);
    throw new LgRuntimeError('LGUI-RT-176', `测试里记了 error 级的日志 ${found.event}：${reason}`, '按日志改代码或界面；外部失败（请求、网络图片、声音加载）记 warn，不会让测试失败。');
  }

  // 模拟操作：做完以后检查日志。
  private async step<T>(run: () => Promise<T>): Promise<T> {
    const value = await run();
    this.checkLogs();
    return value;
  }

  /** 按路径找控件：「包/组件.控件路径」，列表子项写 list[序号]。 */
  private resolve(path: string): {object: UIObject | null; parent: UIComponent | null; last: string} {
    const dot = path.indexOf('.');
    const componentName = (dot < 0 ? path : path.slice(0, dot)).replace(/@portrait$/, '');
    const entry = this.ui.all().find(e => e.state === 'open' && e.cls.component === componentName && e.component);
    if (!entry || !entry.component) throw new LgRuntimeError('LGUI-RT-111', `${componentName} 没有打开（路径 ${path}）。`, '先用 t.open(View) 打开它，或者检查组件名。');
    if (dot < 0) return {object: entry.component, parent: null, last: ''};
    let current: UIObject = entry.component;
    let parent: UIComponent | null = null;
    let last = '';
    for (const part of path.slice(dot + 1).split('.')) {
      const match = /^(\w+)(?:\[(\d+)\])?$/.exec(part);
      if (!match) throw new LgRuntimeError('LGUI-RT-111', `路径 ${path} 写法不对。`, '写成 包/组件.控件.子控件，列表子项写 list[序号]。');
      parent = current as UIComponent;
      last = match[1];
      const next = 'child' in current ? (current as UIComponent).child(match[1]) : null;
      if (!next) return {object: null, parent, last};
      current = next;
      if (match[2] !== undefined) {
        const item = (current as UIList).itemAt(Number(match[2]));
        if (!item) throw new LgRuntimeError('LGUI-RT-111', `列表 ${match[1]} 没有第 ${match[2]} 项（路径 ${path}）。`, '检查列表的数据。');
        parent = current as unknown as UIComponent;
        current = item;
      }
    }
    return {object: current, parent, last};
  }

  private object(path: string): UIObject {
    const {object} = this.resolve(path);
    if (!object) throw new LgRuntimeError('LGUI-RT-111', `找不到控件 ${path}。`, '用 lgui ui list 查看真实的控件路径。');
    return object;
  }

  open<V extends ViewClass>(view: V, params?: ParamsOf<V>): Promise<InstanceType<V>> {
    return this.step(async () => {
      const {lgui} = await import('./lgui');
      return lgui.ui.open(view, params);
    });
  }
  click(path: string): Promise<void> { return this.step(() => this.sim.click(this.backend, this.object(path), 50, inputType.get() === 'touch' ? 'touch' : 'mouse')); }
  hold(path: string, ms: number): Promise<void> { return this.step(() => this.sim.hold(this.backend, this.object(path), ms)); }
  drag(path: string, dx: number, dy: number): Promise<void> { return this.step(() => this.sim.drag(this.backend, this.object(path), dx, dy)); }
  dragTo(from: string, to: string): Promise<void> { return this.step(() => this.sim.dragTo(this.backend, this.object(from), this.object(to))); }
  swipe(path: string, dx: number, dy: number): Promise<void> { return this.step(() => this.sim.swipe(this.backend, this.object(path), dx, dy)); }
  pinch(path: string, scale: number): Promise<void> { return this.step(() => this.sim.pinch(this.backend, this.object(path), scale)); }
  wheel(path: string, dy: number): Promise<void> { return this.step(() => this.sim.wheel(this.backend, this.object(path), dy)); }
  key(name: string): Promise<void> { return this.step(() => this.sim.key(this.backend, name)); }
  type(path: string, text: string): Promise<void> { return this.step(() => this.sim.type(this.backend, this.object(path), text)); }
  setValue(path: string, value: number): Promise<void> { return this.step(() => this.sim.setValue(this.backend, this.object(path), value)); }
  choose(path: string, index: number): Promise<void> { return this.step(() => this.sim.choose(this.backend, this.object(path), index)); }
  text(path: string): string {
    const o = this.object(path);
    if ('title' in o) {
      // 和浏览器一样：按钮、标签的文字显示在名为 title 的子控件里，没有它就不显示（写进去的文字读得到，界面上却是空的）。
      const button = o as UIButton | UILabel;
      if (!button.child('title')) throw new LgRuntimeError('LGUI-RT-262', `${path} 是按钮或标签，但组件 ${button.componentName} 里没有名为 title 的子控件：它的文字不会显示（浏览器里也一样）。`, '在 ui/ 里给这个组件加一个名为 title 的文字控件（lgui check 也查这一条）；要读组件里别的文字，路径写到那个子控件。');
      return button.title;
    }
    if ('componentName' in o && (o as UIComponent).componentName === 'Common/ArtText') return artTextOf(o as UIComponent) ?? '';
    if ('text' in o) return (o as UIText).text;
    throw new LgRuntimeError('LGUI-RT-111', `${path} 不是文字或按钮，读不了文字。`, '换一个文字控件的路径。');
  }
  /** 真的显示着：自己和各级父组件都显示，也没被齿轮或组藏起来。 */
  visible(path: string): boolean { return this.object(path).shown; }
  enabled(path: string): boolean { return this.object(path).enabled; }
  page(path: string): string {
    const {parent, last} = this.resolve(path);
    const controller: UIController | null = parent ? parent.controller(last) : null;
    if (!controller) throw new LgRuntimeError('LGUI-RT-111', `${path} 不是控制器。`, '路径的最后一段写控制器名。');
    return controller.selectedPage;
  }
  value(path: string): number {
    const o = this.object(path);
    if ('items' in o && 'selectedIndex' in o) return (o as UIComboBox).selectedIndex;
    if ('value' in o) return (o as UISlider).value;
    throw new LgRuntimeError('LGUI-RT-111', `${path} 不是滑动条、进度条或下拉框，读不了值。`, '换一个滑动条、进度条或下拉框的路径。');
  }
  playing(path: string): boolean {
    const o = this.object(path);
    if (!('playing' in o)) throw new LgRuntimeError('LGUI-RT-111', `${path} 不是序列帧动画。`, '换一个序列帧动画（movieclip）的路径。');
    return (o as UIMovieClip).playing;
  }
  items(path: string): number {
    const o = this.object(path);
    if (!('numItems' in o)) throw new LgRuntimeError('LGUI-RT-111', `${path} 不是列表或树。`, '换一个列表或树的路径。');
    return (o as UIList).numItems;
  }
  /** 控件现在的样子（和 this.tween 同一个意思）。headless 不算布局：尺寸由布局决定、补间也没碰过时，读 width、height 报 LGUI-RT-260。 */
  look(path: string): Look {
    const o = this.object(path);
    const has = (prop: TweenProp): number | undefined => o.supports(prop) ? o.getProp(prop) : undefined;
    const press = 'pressScale' in o ? (o as UIButton).pressScale : 1;
    const color = has('color');
    const size = (prop: 'width' | 'height'): number => {
      const unknown = (o as UnknownLayout).unknownLayout?.size;
      if (unknown && !tweened(o, prop)) {
        throw new LgRuntimeError('LGUI-RT-260', `headless 不算布局，读不了 ${path} 的${prop === 'width' ? '宽' : '高'}：它由${unknown}决定，ui/ 里写的初始值不是网页上的结果。`, '要测尺寸，用 lgui test --browser 在真浏览器里跑这个测试；只看缩放、透明度这些不受影响。');
      }
      return o.getProp(prop);
    };
    const look: Partial<Look> = {};
    Object.defineProperties(look, {
      dx: {enumerable: true, get: () => o.getProp('x') - originOf(o, 'x')},
      dy: {enumerable: true, get: () => o.getProp('y') - originOf(o, 'y')},
      scaleX: {enumerable: true, get: () => o.getProp('scaleX') * press},
      scaleY: {enumerable: true, get: () => o.getProp('scaleY') * press},
      rotation: {enumerable: true, get: () => o.getProp('rotation')},
      alpha: {enumerable: true, get: () => o.getProp('alpha')},
      width: {enumerable: true, get: () => size('width')},
      height: {enumerable: true, get: () => size('height')},
      color: {enumerable: true, get: () => color === undefined ? undefined : '#' + (Math.round(o.getProp('color')) & 0xffffff).toString(16).padStart(6, '0')},
      fontSize: {enumerable: true, get: () => has('fontSize')},
      fillAmount: {enumerable: true, get: () => has('fillAmount')}
    });
    return look as Look;
  }
  /** 换屏幕尺寸，等防抖（150 毫秒）结束、换版完成后返回。 */
  setScreen(width: number, height: number): Promise<void> { return this.step(async () => { await this.sim.setScreen(this.backend, width, height); await this.sim.advance(this.backend, 200); }); }
  /** 换安全区（屏幕像素的边距），等重新摆放完成后返回。 */
  setSafeArea(insets: Insets): Promise<void> { return this.step(async () => { await this.sim.setSafeArea(this.backend, insets); await this.sim.advance(this.backend, 200); }); }
  setLanguage(language: string): Promise<void> {
    return this.step(async () => {
      const {lgui} = await import('./lgui');
      await lgui.setLanguage(language);
    });
  }
  setInputType(type: InputType): void { inputType.set(type); }
  /** headless 是假时钟，按帧（16 毫秒）走；--browser 是真的等。跨天这类长时间用 lgui.time.setServerOffset，不要一帧一帧推。 */
  advance(ms: number): Promise<void> { return this.step(() => this.sim.advance(this.backend, ms)); }
  sounds(): {url: string; volume: number}[] { return this.state.sounds.map(s => ({...s})); }
  music(): string | null { return this.state.music?.url ?? null; }
  snapshot(): Snapshot { return snapshot(this.ui); }
  /** 关闭所有界面、清掉界面缓存，再检查 error 日志和有没有没清理的界面、界面包。 */
  end(): void {
    this.ended = true;
    this.closeEverything();
    this.checkLogs();
    const left = this.snapshot();
    const tweens = engineState();
    const leaked = left.views.length || left.packages.length || tweens.tweens || tweens.subscribed;
    if (leaked) throw new LgRuntimeError('LGUI-RT-112', `关闭所有界面后还有没清理的东西：${JSON.stringify({views: left.views, packages: left.packages, ...(tweens.tweens || tweens.subscribed ? {tweens} : {})})}。`, '检查是不是有界面没走 lgui.ui 关闭，或者在框架外面加了监听；补间没停说明框架漏了一种情况，请报给 LGUI。');
  }
  // 关闭时钩子里又打开的界面（比如 onClose 里弹 toast）也关掉：一直关到没有界面为止，最多 10 轮；
  // 再清掉界面缓存（配了 uiCache.keepClosedViews 时关掉的界面和它的包留在缓存里，不清就会被当成泄漏）。
  private closeEverything(): void {
    for (let round = 0; round < 10 && this.ui.all().length; round++) {
      for (const layer of ['toast', 'modal', 'popup', 'page', 'hud'] as const) this.ui.closeAll(layer);
    }
    this.ui.clearCache();
  }
  /**
   * 内部用：每个测试结束时由 lgui test 调用（生成的 env.ts 的 afterEach）。
   * 调用过 end() 的只再查一次 error 日志；没调用的补上：测试通过了就照常 end()（泄漏、error 日志让这个测试失败）；
   * 测试已经失败了只把界面全关掉、缓存清掉，不再加新的错，同一个文件后面的测试不受连带。清理时出的错返回给调用方记进测试输出。
   */
  finish(passed: boolean): string | null {
    if (this.ended) { this.checkLogs(); return null; }
    if (passed) { this.end(); return null; }
    this.ended = true;
    try {
      this.closeEverything();
      return null;
    } catch (error) {
      return `测试失败后清理界面时出错：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  /** headless 不算布局：lgui.ui.find 要读的位置、尺寸受布局影响时报 LGUI-RT-260（和 UIManager.find 走同样的路径：各级控件的位置相加，最后一级的尺寸）。 */
  checkLayout(path: string): void {
    const dot = path.indexOf('.');
    const componentName = (dot < 0 ? path : path.slice(0, dot)).replace(/@portrait$/, '');
    const entry = this.ui.all().find(e => e.state === 'open' && e.component && e.cls.component === componentName);
    if (!entry || !entry.component || dot < 0) return;
    const parts = path.slice(dot + 1).split('.');
    for (let i = 1; i <= parts.length; i++) {
      const object = entry.component.child(parts.slice(0, i).join('.'));
      if (!object) return;
      const unknown = (object as UnknownLayout).unknownLayout;
      const what = unknown?.position ? '位置' : i === parts.length && unknown?.size ? '尺寸' : null;
      if (!what || !unknown) continue;
      const by = what === '位置' ? unknown.position : unknown.size;
      throw new LgRuntimeError('LGUI-RT-260', `headless 不算布局，读不了 ${path} 的位置和大小：${parts.slice(0, i).join('.')} 的${what}由${by}决定，ui/ 里写的初始值不是网页上的结果。`, '要测位置和尺寸，用 lgui test --browser 在真浏览器里跑这个测试（同一套 t.* 写法）；只看样子用 lgui verify 截图。');
    }
  }
}

/** lgui.testing.start(app, 选项?)。 */
export async function startTest(app: AppDefinition, options: {services?: Record<string, () => object>; language?: string; screen?: {width: number; height: number}} = {}): Promise<TestHarness> {
  const e = env();
  const backend = e.createBackend();
  await backend.init({projectName: e.config.name, defaultFont: null, fonts: e.fonts, uiBase: ''});
  if (options.screen) {
    // headless 直接设屏幕尺寸；浏览器里（lgui test --browser）在启动前把页面换成这个尺寸。
    if (backend.state?.screen) backend.state.screen = {...options.screen};
    else await (e.sim as unknown as Sim).setScreen(backend, options.screen.width, options.screen.height);
  }
  inputType.set('keyboardMouse');
  // 日志和声音总是记进 headless（app.platform 不生效），测试才能读 t.sounds()、t.music()，error 级的日志才能让测试失败。
  const ui = await boot(backend, app, e.config, e.deps, {texts: e.texts, language: options.language ?? e.config.defaultLanguage, services: options.services, wallBase: Date.UTC(2026, 0, 1), platform: {}});
  const harness = new Harness(backend, ui, e.sim as unknown as Sim);
  if (backend.name === 'headless') {
    // headless 不算布局：lgui.ui.find（测试和游戏代码里调用都算）读到受布局影响的位置、尺寸时报 LGUI-RT-260，别的照常返回。
    const find = ui.find.bind(ui);
    ui.find = path => { harness.checkLayout(path); return find(path); };
  }
  e.current = harness;
  return harness;
}
