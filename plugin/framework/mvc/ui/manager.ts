// UIManager：5 层、界面栈、激活和遮挡、打开和关闭、onClose。规则见方案 5.10 和 references/mvc-spec.md 第 9、10 节。
import type {Backend, Rect, UIComponent} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import type {InputMode, Layer, Orientation, ViewClass} from '../types';
import type {UIList, UIObject} from '../../core/index';
import {orientationState} from './orientation-state';
import {HintBar, canCreateHintBar, hintsFor} from './hint-bar';
import {actionForKey} from '../input/keys';
import {inputType} from '../input/input-type';
import type {KeyInput} from '../../core/index';
import {validateViewClass} from '../view';
import {asActor, currentActor} from '../actor';
import {bus, builtinEvents} from '../events';
import {fault, notice} from '../log';
import {languageSettled, languageSwitches, languageSwitching, later, updatesHeld} from '../language-switch';

/** 从下到上的 5 层。 */
export const LAYERS: readonly Layer[] = ['hud', 'page', 'popup', 'modal', 'toast'];

/** 方向相关的工程配置。 */
export interface OrientationSettings {
  designSize: {landscape: {width: number; height: number}; portrait: {width: number; height: number}};
  orientation: 'both' | 'landscape' | 'portrait';
  /** 界面缓存：最近关掉的 N 个界面不销毁，再打开时直接复用组件。默认 0。 */
  uiCache?: {keepClosedViews: number};
  /** 按平台的「按键 → 动作」。 */
  keyMap?: Record<string, Record<string, string>>;
}

/** 缓存着的、关掉的界面组件（连同它占着的包引用）。 */
interface Cached {
  cls: ViewClass;
  version: string;
  component: UIComponent;
  packages: string[];
}

/** 找出组件里所有列表（不进列表内部），记下滚动位置和选中项，按控件路径。 */
function listStates(component: UIComponent, prefix = ''): Map<string, {scroll: {x: number; y: number}; selected: number}> {
  const states = new Map<string, {scroll: {x: number; y: number}; selected: number}>();
  for (const name of component.childNames()) {
    const child = component.child(name) as UIObject | null;
    if (!child) continue;
    const path = prefix + name;
    if ('numItems' in child) states.set(path, {scroll: {...(child as UIList).scrollPosition}, selected: (child as UIList).selectedIndex});
    else if ('childNames' in child) for (const [k, v] of listStates(child as UIComponent, path + '.')) states.set(k, v);
  }
  return states;
}

function restoreLists(component: UIComponent, states: Map<string, {scroll: {x: number; y: number}; selected: number}>): void {
  for (const [path, state] of states) {
    const list = component.child(path) as UIList | null;
    if (!list || !('numItems' in list)) continue;
    list.selectedIndex = state.selected;
    list.scrollPosition = state.scroll;
  }
}

/** 两次 open 的参数是不是一样：普通对象和数组逐项比较（不管键的顺序），其余的值要是同一个。 */
function sameParams(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const plain = (x: object): boolean => [Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(x));
  if (!plain(a) || !plain(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameParams((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** 报错里写参数。 */
function describe(params: unknown): string {
  if (params === undefined) return '（没传）';
  try { return JSON.stringify(params) ?? String(params); } catch { return String(params); }
}

type Hook = 'onOpen' | 'onActivate' | 'onDeactivate' | 'onCovered' | 'onRevealed' | 'onClose' | 'onOrientationChange';

/** View 实例在框架里需要的部分。 */
interface ViewInstance {
  __mount(component: UIComponent, options: {isActive: () => boolean}): void;
  __dispose(): void;
  __timers: {pause(): void; resume(): void; size: number};
  __pause(): void;
  __resume(): void;
  __listeners: number;
  keys: Record<string, unknown>;
}

/** 一个打开的（或正在打开的）界面。 */
export interface Entry {
  cls: ViewClass;
  view: ViewInstance;
  layer: Layer;
  fullScreen: boolean;
  component: UIComponent | null;
  /** 当前用的是哪一版组件（组件名，竖版带 @portrait）。 */
  version: string;
  state: 'opening' | 'queued' | 'open' | 'closed';
  active: boolean;
  covered: boolean;
  /** 打开它的界面（在 main.ts 里打开的是 null）。 */
  opener: Entry | null;
  onClose: ((result: unknown) => void) | null;
  packages: string[];
  ready: Promise<ViewInstance>;
  /** 打开时从缓存里取到的组件。 */
  cached?: Cached;
  /** 排队中的 modal：轮到它时调用。 */
  show?: () => void;
  /** 打开时实际用的参数（没传就是 static params 的默认值），再 open 时比较。 */
  params: object | undefined;
  /** 包引用已经释放了（或者交给了界面缓存），不再重复释放。 */
  released?: boolean;
}

export class UIManager {
  /** 每层的界面，按栈的顺序（modal 层第一个是正在显示的，后面的在排队）。 */
  readonly stacks: Record<Layer, Entry[]> = {hud: [], page: [], popup: [], modal: [], toast: []};
  private containers = new Map<Layer, UIComponent>();
  private refs = new Map<string, number>();
  private loading = new Map<string, Promise<void>>();
  private visible: Rect;
  private cache: Cached[] = [];
  private hintBar: HintBar | null = null;
  /** 不进 modal 队列、直接盖在最上面的界面（loading）。 */
  readonly overlays = new Set<ViewClass>();
  /** 框架常驻用到的包，永远不释放。 */
  private pinned = new Set<string>();

  /** 当前方向。 */
  orientation: Orientation;
  private readonly refreshHints = (): void => this.updateHints();
  private readonly reorient = (): void => this.applyOrientation();

  constructor(private readonly backend: Backend, private readonly deps: Record<string, string[]>, private readonly settings: OrientationSettings) {
    this.orientation = this.decideOrientation();
    orientationState.current = this.orientation;
    this.visible = backend.platform.screen.applyDesignSize(this.design());
    // 屏幕尺寸一变：防抖 150 毫秒（拖动窗口时不来回切换）再判方向、换版。
    // 输入路由：按键只送给激活的界面；输入类型按最近一次输入判断。
    backend.platform.input.onKey(e => this.onKey(e));
    backend.platform.input.onPointer(e => { if (e.type === 'down') inputType.set(e.pointerType === 'mouse' ? 'keyboardMouse' : 'touch'); });
    inputType.subscribe(() => this.updateHints());
    let waiting = 0;
    let stopWaiting: (() => void) | null = null;
    backend.platform.screen.onResize(() => {
      waiting = 0;
      if (stopWaiting) return;
      stopWaiting = backend.platform.time.onFrame(dt => {
        waiting += dt;
        if (waiting < 150) return;
        stopWaiting?.();
        stopWaiting = null;
        this.applyOrientation();
      });
    });
    for (const layer of LAYERS) {
      // 层容器不设尺寸：只是容器，不能挡住下面层的点击（浏览器里一个铺满屏幕的空容器会吃掉所有指针事件）。
      const container = backend.createContainer(layer);
      if (layer === 'toast') container.touchable = false;
      backend.root.addChild(container);
      this.containers.set(layer, container);
    }
  }

  // ---------- 按键和操作提示栏 ----------

  private onKey(e: KeyInput): void {
    if (e.type !== 'down' || e.repeat || this.backend.platform.textInput.isComposing()) return;
    inputType.set('keyboardMouse');
    const action = actionForKey(e.key, this.backend.name, this.settings.keyMap ?? {});
    if (!action || action === 'none') return;
    if (action === 'back') { this.back(); return; }
    const active = this.all().find(x => x.active);
    if (!active) return;
    const def = active.view.keys[action];
    if (def === 'close') this.closeEntry(active);
    else if (typeof def === 'function') asActor(active.view, () => (def as () => unknown)());
    else if (def && typeof def === 'object' && typeof (def as {do?: unknown}).do === 'function') asActor(active.view, () => (def as {do: () => unknown}).do());
  }

  /** 内部用：建操作提示栏（Common/ActionHintBar）。启动时调用。没有 Common 包或这个组件是写错了（LGUI-RT-172）：正式构建里只记 error、不建提示栏。 */
  async startHintBar(): Promise<void> {
    // 提示栏常驻：它用的包算框架自己的（pinned），不计入界面的引用数，也不会被释放。
    let reason = '';
    try {
      if (!this.backend.platform.resource.hasPackage('Common')) await this.backend.loadPackage('Common');
      if (!canCreateHintBar(this.backend)) reason = 'Common 包里没有 ActionHintBar 组件';
    } catch (error) {
      reason = `Common 包加载不了（${error instanceof Error ? error.message : String(error)}）`;
    }
    if (reason) { fault(new LgRuntimeError('LGUI-RT-172', `${reason}，建不了操作提示栏。`, '用 lgui init 自带的 Common 包，不要删掉 Common/ActionHintBar（lgui check 报 LGUI-UI-014）。')); return; }
    this.pinned.add('Common');
    const component = this.backend.create('Common', 'ActionHintBar');
    component.touchable = false;
    (this.containers.get('toast') as UIComponent).addChild(component);
    this.hintBar = new HintBar(component);
    this.updateHints();
  }

  /** 内部用：重新算操作提示栏的内容（激活界面、输入类型、语言变化时）。 */
  updateHints(): void {
    if (!this.hintBar) return;
    // 换语言的空窗里包不在：切完再算（重建界面时也会算一次）。
    if (updatesHeld()) { later(this.refreshHints); return; }
    const active = this.all().find(x => x.active);
    this.hintBar.update(active ? hintsFor(active.view.keys, this.canGoBack(active), this.backend.name, this.settings.keyMap ?? {}) : [], this.visible);
  }

  /** 返回键能不能关掉它：hud 层的界面、page 层最底下的主界面都关不掉。 */
  private canGoBack(entry: Entry): boolean {
    return entry.layer !== 'hud' && !(entry.layer === 'page' && this.shown('page')[0] === entry);
  }

  // ---------- 横竖屏 ----------

  /** 宽 ≥ 高就是横屏；工程配置锁定了方向时只用那一版。 */
  private decideOrientation(): Orientation {
    if (this.settings.orientation !== 'both') return this.settings.orientation;
    const {width, height} = this.backend.platform.screen.size();
    return width >= height ? 'landscape' : 'portrait';
  }

  private design(): {width: number; height: number} {
    return this.orientation === 'portrait' ? this.settings.designSize.portrait : this.settings.designSize.landscape;
  }

  /** 当前方向用哪一版组件：竖屏时有 @portrait 版本就用它。 */
  private versionOf(cls: ViewClass): string {
    const [pkg, name] = cls.component.split('/');
    return this.orientation === 'portrait' && this.backend.has(pkg, `${name}@portrait`) ? `${name}@portrait` : name;
  }

  /** 安全区（去掉刘海、圆角、系统条的部分）在设计单位下的位置和大小。平台给的是屏幕像素的边距，按当前缩放比换算。 */
  private safeRect(): Rect {
    const {screen} = this.backend.platform;
    const insets = screen.safeArea();
    const scale = screen.size().width / this.visible.width;
    const [top, right, bottom, left] = [insets.top, insets.right, insets.bottom, insets.left].map(v => v / scale);
    return {x: left, y: top, width: this.visible.width - left - right, height: this.visible.height - top - bottom};
  }

  /** 按层和是否全屏摆放界面。 */
  private place(entry: Entry, component: UIComponent): void {
    const safe = this.safeRect();
    if (entry.fullScreen) {
      // 全屏界面铺满整个可见区域；名字叫 safe 的直接子控件摆进安全区（没有也可以）。
      component.rect = {x: 0, y: 0, width: this.visible.width, height: this.visible.height};
      const area = component.child('safe');
      if (area) area.rect = safe;
    } else {
      // 不是全屏的界面（哪一层都一样）放在安全区正中。
      const r = component.rect;
      component.rect = {x: Math.round(safe.x + (safe.width - r.width) / 2), y: Math.round(safe.y + (safe.height - r.height) / 2), width: r.width, height: r.height};
    }
  }

  /** 用同一个 View 实例把界面换到另一个组件上：记下列表的滚动位置和选中项，建新组件，重新绑定，再恢复。不调用 onOpen、onClose。 */
  private swap(entry: Entry, version: string): void {
    if (!entry.component) return;
    const [pkg] = entry.cls.component.split('/');
    const lists = listStates(entry.component);
    const old = entry.component;
    const component = this.backend.create(pkg, version);
    entry.component = component;
    entry.version = version;
    this.place(entry, component);
    component.visible = !entry.covered;
    component.touchable = entry.active;
    (this.containers.get(entry.layer) as UIComponent).addChild(component);
    // 新组件绑定时报错（比如补间在新版里按路径找不到目标）也把换版做完：旧组件照样释放、层里照样排好。
    try {
      entry.view.__mount(component, {isActive: () => entry.active && entry.state === 'open'});
    } finally {
      restoreLists(component, lists);
      old.dispose();
      this.reorder();
    }
  }

  /** 每个界面各换各的：一个界面换版时出错不挡住别的界面，全部换完再把第一个错误抛出去。 */
  private each(entries: readonly Entry[], run: (entry: Entry) => void): void {
    let failure: {error: unknown} | null = null;
    for (const entry of entries) {
      try { run(entry); } catch (error) { if (!failure) failure = {error}; }
    }
    if (failure) throw failure.error;
  }

  /** 换过的组件是后加进去的，按栈的顺序重新排一遍，层内的上下关系不变。只调整顺序：已经在层里的界面移到最上面，不离开舞台
   * （先移走再加回来会让里面的动效收到「离开舞台」而停住）。 */
  private reorder(): void {
    for (const layer of LAYERS) {
      const container = this.containers.get(layer) as UIComponent;
      for (const entry of this.stacks[layer]) if (entry.component) container.addChild(entry.component);
    }
  }

  /** 内部用：换语言后重建所有打开的界面（和旋转同一套机制），清空界面缓存。 */
  rebuildAll(): void {
    this.clearCache();
    try {
      this.each(this.all(), entry => { if (entry.state === 'open' && entry.component) this.swap(entry, entry.version); });
    } finally {
      this.updateHints();
    }
  }

  /** 内部用：现在就按屏幕尺寸判方向并换版（平时由尺寸变化触发，测试里可以直接调用）。 */
  applyOrientation(): void {
    // 换语言的空窗里包不在、建不了新版组件：切完再换版。
    if (updatesHeld()) { later(this.reorient); return; }
    const next = this.decideOrientation();
    const changed = next !== this.orientation;
    this.orientation = next;
    orientationState.current = next;
    this.visible = this.backend.platform.screen.applyDesignSize(this.design());
    try {
      this.each(this.all(), entry => {
        if (entry.state !== 'open' || !entry.component) return;
        const version = this.versionOf(entry.cls);
        try {
          if (version !== entry.version) this.swap(entry, version);
          else this.place(entry, entry.component);
        } finally {
          if (changed) this.hook(entry, 'onOrientationChange', next);
        }
      });
    } finally {
      this.updateHints();
      if (changed) bus.emit(builtinEvents.orientationChange, {orientation: next});
    }
  }

  // ---------- 资源：按需加载界面包（连同它依赖的包），记录有几个界面在用 ----------

  private packagesOf(pkg: string, seen = new Set<string>()): string[] {
    if (seen.has(pkg)) return [];
    seen.add(pkg);
    return [...(this.deps[pkg] ?? []).flatMap(dep => this.packagesOf(dep, seen)), pkg];
  }

  private async acquire(packages: string[]): Promise<void> {
    for (const pkg of packages) this.refs.set(pkg, (this.refs.get(pkg) ?? 0) + 1);
    // 正在换语言：后端正在卸包、装包，等它装完再加载（引用数已经记上，期间关掉照常释放）。
    if (languageSwitching()) await languageSettled();
    for (const pkg of packages) {
      if (this.backend.platform.resource.hasPackage(pkg)) continue;
      let pending = this.loading.get(pkg);
      if (!pending) {
        // 加载完时已经没有界面在用（加载中界面被关掉了）：马上卸载，不留没人用的包。
        pending = this.backend.loadPackage(pkg).then(() => { if (!this.refs.has(pkg) && !this.pinned.has(pkg)) this.backend.releasePackage(pkg); }).finally(() => this.loading.delete(pkg));
        this.loading.set(pkg, pending);
      }
      await pending;
    }
  }

  /** 释放一个界面占着的包引用，只释放一次。 */
  private releaseEntry(entry: Entry): void {
    if (entry.released) return;
    entry.released = true;
    this.release(entry.packages);
  }

  private release(packages: string[]): void {
    for (const pkg of [...packages].reverse()) {
      const left = (this.refs.get(pkg) ?? 0) - 1;
      if (left > 0) { this.refs.set(pkg, left); continue; }
      this.refs.delete(pkg);
      if (!this.pinned.has(pkg)) this.backend.releasePackage(pkg);
    }
  }

  /** 已加载的包和引用数。 */
  packageRefs(): {name: string; refs: number}[] { return Array.from(this.refs).map(([name, refs]) => ({name, refs})); }

  // ---------- 查询 ----------

  all(): Entry[] { return LAYERS.flatMap(layer => this.stacks[layer]); }
  entryOf(cls: ViewClass): Entry | undefined { return this.all().find(e => e.cls === cls && e.state !== 'closed'); }
  private entryOfInstance(instance: object | null): Entry | null { return instance ? this.all().find(e => e.view === instance) ?? null : null; }
  /** 正在显示的界面（不含排队中的 modal、正在打开的）。 */
  shown(layer: Layer): Entry[] { return this.stacks[layer].filter(e => e.state === 'open'); }
  top(layer?: Layer): Entry | undefined {
    // 不指定层时不算 toast（短暂提示，不接收输入）。
    // 层列表不写在三目里：Cocos 的 babel 剥类型管线对带 as const 分支的三目会推导崩（T007 实测）。
    const scanLayers: readonly Layer[] = ['modal', 'popup', 'page', 'hud'];
    for (const l of layer ? [layer] : scanLayers) {
      const list = this.shown(l);
      if (list.length) return list[list.length - 1];
    }
    return undefined;
  }

  // ---------- 激活与遮挡 ----------

  private hook(entry: Entry, name: Hook, arg?: unknown): void {
    const fn = (entry.view as unknown as Record<string, unknown>)[name];
    if (typeof fn === 'function') asActor(entry.view, () => (fn as (a?: unknown) => void).call(entry.view, arg));
  }

  /** 重新计算谁是激活的、谁被盖住了。 */
  private refresh(): void {
    // 激活：所有层合起来最上面那个可交互的界面（toast 不参与）。modal 打开时下面所有层都停用。
    let active: Entry | undefined;
    for (const layer of ['modal', 'popup', 'page', 'hud'] as const) {
      const list = this.shown(layer);
      if (list.length) { active = list[list.length - 1]; break; }
    }
    // 遮挡：全屏界面盖住它下面的所有界面（包括下面层的）。
    const ordered = (['hud', 'page', 'popup', 'modal'] as const).flatMap(layer => this.shown(layer));
    let coveredBelow = -1;
    ordered.forEach((e, i) => { if (e.fullScreen) coveredBelow = i; });
    const deactivated: Entry[] = [];
    const activated: Entry[] = [];
    ordered.forEach((e, i) => {
      const covered = i < coveredBelow;
      if (covered !== e.covered) {
        e.covered = covered;
        if (e.component) e.component.visible = !covered;
        if (covered) { e.view.__pause(); this.hook(e, 'onCovered'); bus.emit(builtinEvents.viewCovered, {view: e.cls}); }
        else { e.view.__resume(); this.hook(e, 'onRevealed'); bus.emit(builtinEvents.viewRevealed, {view: e.cls}); }
      }
      const isActive = e === active;
      if (e.component) e.component.touchable = isActive;
      if (isActive !== e.active) { e.active = isActive; (isActive ? activated : deactivated).push(e); }
    });
    for (const e of deactivated) this.hook(e, 'onDeactivate');
    for (const e of activated) this.hook(e, 'onActivate');
    this.updateHints();
    if (activated.length) {
      const mode: InputMode = active?.cls.inputMode ?? (active?.layer === 'hud' ? 'game' : 'ui');
      this.backend.platform.input.setInputMode(mode);
      bus.emit(builtinEvents.inputModeChange, {inputMode: mode});
    }
  }

  // ---------- 打开 ----------

  open(cls: ViewClass, params?: object, options: {onClose?: (result: unknown) => void} = {}): Promise<object> {
    validateViewClass(cls);
    const effective = params ?? (cls.params ? {...cls.params} : undefined);
    const existing = this.entryOf(cls);
    if (existing) {
      // 正在打开或已经打开：参数相同就合并成一次。参数不同、又登记了 onClose 都报错：这次的参数不会用，onClose 不会被调用。
      if (!sameParams(existing.params ?? {}, effective ?? {})) {
        throw new LgRuntimeError('LGUI-RT-240', `${cls.name} 已经打开（或正在打开），参数是 ${describe(existing.params)}；这次 open 的参数 ${describe(effective)} 和它不同，不会生效。`, `同一个界面同时只开一个：先用 lgui.ui.isOpen(${cls.name}) 判断，要换内容就改它绑定的 Model；要依次显示好几份（比如几份奖励），在 Controller 里排队，前一个关了再开下一个（open 时登记 onClose）。`);
      }
      if (options.onClose) throw new LgRuntimeError('LGUI-RT-084', `${cls.name} 已经打开（或正在打开），这次 open 登记的 onClose 不会被调用。`, `先用 lgui.ui.isOpen(${cls.name}) 判断；要知道它什么时候关，在第一次打开时登记 onClose，或者收听 lgui.events.viewClosed。`);
      return existing.ready;
    }
    const opener = this.entryOfInstance(currentActor());
    const layer = cls.layer;
    const [pkg] = cls.component.split('/');
    const view = new cls() as ViewInstance;
    const entry: Entry = {
      cls, view, layer, fullScreen: cls.fullScreen === true, component: null, version: '', state: 'opening', active: false, covered: false,
      opener, onClose: options.onClose ?? null, packages: this.packagesOf(pkg), ready: Promise.resolve(view), params: effective
    };
    this.stacks[layer].push(entry);
    // 正在换语言时不用缓存的组件：它是旧语言的（切完会清空缓存），等切完按新语言重新建。
    const cachedIndex = languageSwitching() ? -1 : this.cache.findIndex(c => c.cls === cls);
    if (cachedIndex >= 0) [entry.cached] = this.cache.splice(cachedIndex, 1);
    // 取缓存组件时的语言切换次数：之后换过语言，缓存的组件就是旧语言的。
    const switchesAtStart = languageSwitches();
    entry.ready = (async () => {
      // 打开失败或被取消：不留半成品，资源只释放一次，排在后面的 modal 照常放出。
      const abandon = (): void => {
        if (entry.state !== 'closed') { this.remove(entry); entry.state = 'closed'; }
        entry.cached?.component.dispose();
        entry.cached = undefined;
        this.releaseEntry(entry);
        this.nextModal();
      };
      const cancelled = (how: string): LgRuntimeError => {
        abandon();
        return new LgRuntimeError('LGUI-RT-081', `${cls.name} 在${how}时被关闭了，这次打开已取消。`, '不需要处理；不想看到这个错误，就不要在打开完成之前关闭它。');
      };
      try {
        if (!entry.cached) await this.acquire(entry.packages); // 缓存里的组件还占着包引用
      } catch (error) {
        abandon();
        throw new LgRuntimeError('LGUI-RT-080', `打开 ${cls.name} 失败：${error instanceof Error ? error.message : String(error)}`, '确认界面包已经生成（lgui dev 会自动生成），包名和组件名都对。');
      }
      if (entry.state === 'closed') throw cancelled('加载资源');
      // modal 层同一时间只显示一个，按打开的先后排队：已经有一个显示着，或者前面还有没轮到的，就排队。
      if (this.mustQueue(entry)) {
        entry.state = 'queued';
        await new Promise<void>(resolve => { entry.show = resolve; });
        if ((entry.state as Entry['state']) === 'closed') throw cancelled('排队');
      }
      // 显示之前：正在换语言（包不在）就等切完；排队、等待期间换过语言，取来的缓存组件是旧语言的，丢掉按新语言重新建（包引用还留着）。
      if (languageSwitching()) {
        await languageSettled();
        if ((entry.state as Entry['state']) === 'closed') throw cancelled('等语言切换');
      }
      if (entry.cached && languageSwitches() !== switchesAtStart) {
        entry.cached.component.dispose();
        entry.cached = undefined;
      }
      try {
        this.show(entry, params);
      } catch (error) {
        entry.view.__dispose();
        entry.component?.dispose();
        abandon();
        const wrapped = new LgRuntimeError('LGUI-RT-080', `打开 ${cls.name} 失败：${error instanceof Error ? error.message : String(error)}`, '按报错改；不会显示打开了一半的界面。');
        // 内层栈挂在 innerStack 上：RT-080 的栈是包装点，真正出错的那帧在里面（诊断用，不属于错误码语义）。
        if (error instanceof Error) (wrapped as unknown as {innerStack?: string}).innerStack = error.stack;
        throw wrapped;
      }
      return view;
    })();
    return entry.ready;
  }

  /** modal 队列里的界面，按打开的先后。loading 这类 overlay 不参与排队。 */
  private modalQueue(): Entry[] { return this.stacks.modal.filter(e => !this.overlays.has(e.cls) && e.state !== 'closed'); }

  /** 资源准备好的 modal 要不要排队：已经有一个显示着，或者比它先打开的还没轮到。 */
  private mustQueue(entry: Entry): boolean {
    if (entry.layer !== 'modal' || this.overlays.has(entry.cls)) return false;
    const queue = this.modalQueue();
    return queue.some(e => e !== entry && (e.state === 'open' || queue.indexOf(e) < queue.indexOf(entry)));
  }

  /** 放出下一个排队的 modal：没有 modal 显示着、排在最前面的正在排队时，马上把它改成「正在打开」再放出。 */
  private nextModal(): void {
    const queue = this.modalQueue();
    const head = queue[0];
    if (!head || head.state !== 'queued' || queue.some(e => e.state === 'open')) return;
    head.state = 'opening';
    head.show?.();
  }

  private show(entry: Entry, params?: object): void {
    const [pkg] = entry.cls.component.split('/');
    // 打开时先判方向，再加载对应的版本。
    const version = this.versionOf(entry.cls);
    let component: UIComponent;
    if (entry.cached && entry.cached.version === version) {
      component = entry.cached.component;
      component.visible = true;
    } else {
      entry.cached?.component.dispose();
      component = this.backend.create(pkg, version);
    }
    entry.cached = undefined;
    entry.component = component;
    entry.version = version;
    const container = this.containers.get(entry.layer) as UIComponent;
    this.place(entry, component);
    container.addChild(component);
    entry.view.__mount(component, {isActive: () => entry.active && entry.state === 'open'});
    entry.state = 'open';
    this.hook(entry, 'onOpen', params ?? (entry.cls.params ? {...entry.cls.params} : undefined));
    bus.emit(builtinEvents.viewOpened, {view: entry.cls});
    this.refresh();
  }

  /** 关闭后的组件：配置了界面缓存就留着（连同包引用），否则销毁并释放资源。 */
  private discard(entry: Entry): void {
    const component = entry.component;
    entry.component = null;
    const keep = this.settings.uiCache?.keepClosedViews ?? 0;
    if (component && keep > 0) {
      (this.containers.get(entry.layer) as UIComponent).removeChild(component);
      entry.released = true; // 包引用交给缓存
      this.cache.push({cls: entry.cls, version: entry.version, component, packages: entry.packages});
      while (this.cache.length > keep) this.evict(this.cache.shift() as Cached);
      return;
    }
    component?.dispose();
    this.releaseEntry(entry);
  }

  private evict(cached: Cached): void {
    cached.component.dispose();
    this.release(cached.packages);
  }

  /** 清空界面缓存（切换语言时用：缓存的组件是旧语言的）。 */
  clearCache(): void {
    for (const cached of this.cache.splice(0)) this.evict(cached);
  }

  /** 缓存着几个关掉的界面。 */
  cachedCount(): number { return this.cache.length; }

  /** 内部用：有界面离开界面栈时调用（关闭、打开失败、打开中被取消）；背景音乐靠它重新选曲。 */
  onRemoved: () => void = () => {};

  private remove(entry: Entry): void {
    const stack = this.stacks[entry.layer];
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    this.onRemoved();
  }

  // ---------- 关闭 ----------

  close(cls: ViewClass, result?: unknown, quiet = false): void {
    const entry = this.entryOf(cls);
    if (!entry) {
      if (!quiet) notice('LGUI-RT-082', `${cls.name} 没有打开，跳过关闭。`, {view: cls.name});
      return;
    }
    this.closeEntry(entry, result);
  }

  /** 关闭一个界面。batch：一次关好几个（popTo、closeAll），由调用方在最后统一放出排队的 modal、重新算激活。 */
  private closeEntry(entry: Entry, result?: unknown, batch = false): void {
    if (entry.state === 'closed') return; // 已经关过了（比如在别的界面的 onClose 里关掉的）
    const wasOpen = entry.state === 'open';
    const wasQueued = entry.state === 'queued';
    entry.state = 'closed';
    this.remove(entry);
    if (!wasOpen) {
      // 正在打开或排队时被关掉：马上释放资源，资源到了也不显示（打开那边随后报 LGUI-RT-081，不再重复释放）。
      this.releaseEntry(entry);
      if (wasQueued) entry.show?.();
      if (!batch) this.nextModal();
      return;
    }
    if (entry.active) { entry.active = false; this.hook(entry, 'onDeactivate'); }
    this.hook(entry, 'onClose');
    entry.view.__dispose();
    this.discard(entry);
    // 打开者已经关了的界面不再通知；它打开的界面的回调全部取消。
    for (const other of this.all()) if (other.opener === entry) { other.opener = null; other.onClose = null; }
    const notify = entry.onClose;
    entry.onClose = null;
    bus.emit(builtinEvents.viewClosed, {view: entry.cls});
    if (notify) notify(result);
    if (batch) return;
    this.nextModal(); // modal 排队：前一个关掉，下一个弹出来
    this.refresh();
  }

  /** 用新界面替换某一层的栈顶。 */
  async replace(cls: ViewClass, params?: object): Promise<object> {
    const current = this.top(cls.layer);
    if (current) this.closeEntry(current);
    return this.open(cls, params);
  }

  /** 和按返回键一样：关闭当前激活、可以返回的界面。hud 层的界面和 page 层最底下的主界面关不掉；keys.back 写成函数时照常调用。 */
  back(): void {
    const active = this.all().find(e => e.active);
    if (!active) return;
    const back = active.view.keys.back ?? 'close';
    if (back === 'none') return;
    if (typeof back === 'function') { asActor(active.view, () => (back as () => void)()); return; }
    if (this.canGoBack(active)) this.closeEntry(active);
  }

  /** 一直关到指定界面为止（它上面的界面全部关掉）。全部关完才重新算一次激活。 */
  popTo(cls: ViewClass): void {
    const target = this.entryOf(cls);
    if (!target) throw new LgRuntimeError('LGUI-RT-083', `${cls.name} 没有打开，不能 popTo。`, '先确认它已经打开（lgui.ui.isOpen）。');
    const ordered = (['hud', 'page', 'popup', 'modal'] as const).flatMap(layer => this.stacks[layer]);
    const index = ordered.indexOf(target);
    for (const e of ordered.slice(index + 1).reverse()) if (e.layer !== 'hud' || target.layer === 'hud') this.closeEntry(e, undefined, true);
    this.nextModal();
    this.refresh();
  }

  /** 关闭某一层的全部界面。全部关完才重新算一次激活。 */
  closeAll(layer: Layer): void {
    for (const e of [...this.stacks[layer]].reverse()) this.closeEntry(e, undefined, true);
    this.nextModal();
    this.refresh();
  }

  /** 控件在设计尺寸下的位置和大小：路径写成「包/组件.控件路径」。找不到返回 null。 */
  find(path: string): Rect | null {
    const dot = path.indexOf('.');
    const componentName = dot < 0 ? path : path.slice(0, dot);
    const entry = this.all().find(e => e.state === 'open' && e.component && e.cls.component === componentName.replace(/@portrait$/, ''));
    if (!entry || !entry.component) return null;
    let {x, y, width, height} = entry.component.rect;
    if (dot < 0) return {x, y, width, height};
    const parts = path.slice(dot + 1).split('.');
    for (let i = 1; i <= parts.length; i++) {
      const object = entry.component.child(parts.slice(0, i).join('.'));
      if (!object) return null;
      const r = object.rect;
      x += r.x;
      y += r.y;
      width = r.width;
      height = r.height;
    }
    return {x, y, width, height};
  }

  /** 内部用：每个界面的监听和定时器数量。 */
  views(): {name: string; listeners: number; timers: number; tweens: number}[] {
    return this.all().filter(e => e.state === 'open').map(e => ({name: e.cls.name, listeners: e.view.__listeners, timers: e.view.__timers.size, tweens: (e.view as {__tweenCount?: number}).__tweenCount ?? 0}));
  }
}
