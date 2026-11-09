// View 基类：一个界面、列表子项、部件。写法见 references/mvc-spec.md 第 6 节。
import type {UIComponent, UIList, UIObject} from '../core/index';
import {LgRuntimeError} from '../core/index';
import type {Bind, ItemBind, Keys, Layer, InputMode, TweenOptions, TweenProps} from './types';
import type {EventDef} from './lgui';
import {bus} from './events';
import {Scope} from './scope';
import {ViewTimers} from './timers';
import {applyBindings} from './binding/index';
import {ViewMotion, motionOf} from './binding/transition';
import {TweenGroup, itemsOf, startTween, stopTweens} from './tween/index';
import {attachPress} from './tween/press';
import {fault} from './log';

/** 内部用：一个界面（或部件）的补间组：ItemView 的绑定（按下效果）用所在界面的那份。 */
export function tweensOf(owner: object): TweenGroup | null {
  const group = (owner as {__tweens?: unknown}).__tweens;
  return group instanceof TweenGroup ? group : null;
}

type Table = Record<string, Record<string, unknown> | undefined>;

/** 三种 View 共用的部分：绑定、定时器和收听都跟着界面走，关闭时自动清理。 */
abstract class ViewBase<UI> {
  /** 内部用：这个界面的清理清单，关闭时由框架清理。 */
  readonly __scope = new Scope();
  /** 内部用：这个界面的定时器。 */
  readonly __timers = new ViewTimers(this.__scope);
  /** 内部用：这个界面的动效（被盖住时暂停，关闭时停掉）。 */
  readonly __motion = new ViewMotion();
  /** 内部用：这个界面的代码补间（被盖住时暂停，关闭时停掉并还原，重建时接到新组件上）。 */
  readonly __tweens = new TweenGroup();
  /** 内部用：重建时从旧组件上摘下来、等着接到新组件上的补间。 */
  private readonly __moving: ReturnType<TweenGroup['capture']> = [];
  /** 内部用：当前绑定的组件。 */
  __component: UIComponent | null = null;
  /** 内部用：当前这一次绑定的清理清单（换版重新绑定时只清这一份）。 */
  private __bindScope: Scope | null = null;
  /** 内部用：这个界面里的部件和列表子项（定时器跟着这个界面暂停、恢复）。 */
  private readonly __children = new Set<{__timers: ViewTimers; __tweens?: TweenGroup}>();
  /** 内部用：现在是不是被盖住了。 */
  private __paused = false;
  /** 绑定表（子类覆盖）。 */
  abstract bind: object;

  /** 控件（只在生命周期钩子里的特殊情况用；平时写绑定表）。 */
  protected get ui(): UI {
    const component = this.__component;
    if (!component) throw new LgRuntimeError('LGUI-RT-065', `${this.constructor.name} 还没打开或已经关闭，不能用 this.ui。`, '只在生命周期钩子里用 this.ui。');
    return new Proxy({}, {
      get: (_, key) => typeof key === 'string' ? component.child(key) ?? component.controller(key) ?? component.transition(key) ?? undefined : undefined
    }) as UI;
  }

  /** 内部用：绑到一个组件上。已经绑过就先把旧组件的绑定全部清掉（换版时同一个实例重新绑定）。 */
  __mount(component: UIComponent, options: {isActive?: () => boolean; item?: {data: unknown}; owner?: object} = {}): void {
    this.__unmount();
    const moving = this.__moving.splice(0);
    this.__component = component;
    this.__tweens.root = component;
    const scope = new Scope();
    this.__bindScope = scope;
    const owner = options.owner ?? this;
    applyBindings(component, this.bind as Table, {owner, scope, isActive: options.isActive ?? (() => true), item: options.item, where: this.constructor.name});
    // 所在的界面正被盖住（换版、列表新出现的子项）：新组件里自动播放的动效也先停着。
    const motion = motionOf(owner);
    if (motion?.isPaused) motion.pause(component);
    // downEffect="scale" 的按钮：按下与回弹由框架补（用所在界面的补间组，跟着它暂停、停掉）。
    attachPress(component, tweensOf(owner) ?? this.__tweens, scope);
    // 最后才接补间：新组件上按路径找不到目标时报错（开发模式抛出），这时绑定都已经接好了；换版的调用方保证别的界面照样换。
    if (moving.length) {
      try { this.__tweens.reattach(component, moving, this.constructor.name); } catch (e) { if (e instanceof LgRuntimeError) fault(e); else throw e; }
    }
  }

  /** 内部用：解绑。重建（旋转、换语言）时正在走的代码补间按路径记下来，重新挂载到新组件上时接着走。 */
  __unmount(): void {
    if (this.__component) this.__moving.push(...this.__tweens.capture());
    this.__bindScope?.dispose();
    this.__bindScope = null;
    this.__component = null;
  }

  /** 内部用：彻底清理（停掉补间并还原碰过的属性、解绑、停掉动效、取消定时器和收听）。
   * 补间先停：部件（PartView）的补间也在这里停掉并还原——解绑时部件会先解开（__unmount），那时再停就只剩「摘下来等重建」的了。 */
  __dispose(): void {
    this.__tweens.dispose();
    for (const child of this.__children) child.__tweens?.dispose();
    this.__unmount();
    this.__tweens.drop(this.__moving.splice(0));
    this.__motion.stop();
    this.__scope.dispose();
  }

  /** 内部用：登记一个部件或列表子项，它的定时器跟着这个界面暂停、恢复（界面正被盖住时马上暂停）。返回取消登记。 */
  __adopt(child: {__timers: ViewTimers; __tweens?: TweenGroup}): () => void {
    this.__children.add(child);
    if (this.__paused) { child.__timers.pause(); child.__tweens?.pause(); }
    return () => { this.__children.delete(child); };
  }

  /** 内部用：被盖住时暂停定时器（含部件和列表子项的）和动效。 */
  __pause(): void {
    this.__paused = true;
    this.__timers.pause();
    this.__tweens.pause();
    for (const child of this.__children) { child.__timers.pause(); child.__tweens?.pause(); }
    this.__motion.pause(this.__component);
  }

  /** 内部用：露出来时恢复定时器和动效。 */
  __resume(): void {
    this.__paused = false;
    this.__motion.resume();
    this.__tweens.resume();
    for (const child of this.__children) child.__tweens?.resume();
    this.__timers.resume();
    for (const child of this.__children) child.__timers.resume();
  }

  /** 内部用：这个界面（含部件）正在跑的补间数（含 roll 和按钮的按下效果），给调试快照用。 */
  get __tweenCount(): number {
    let n = this.__tweens.size;
    for (const child of this.__children) n += child.__tweens?.size ?? 0;
    return n;
  }

  /** 内部用：绑定和清理清单里一共登记了多少项（给调试快照用）。 */
  get __listeners(): number { return (this.__bindScope?.size ?? 0) + this.__scope.size; }

  /** 延时执行一次。 */
  protected after(ms: number, handler: () => void): void { this.__timers.after(ms, handler); }
  /** 重复执行。 */
  protected every(ms: number, handler: () => void): void { this.__timers.every(ms, handler); }
  /** 倒计时：每秒回调剩余毫秒数，到点调用 done。 */
  protected countdown(endsAt: number, tick: (leftMs: number) => void, done: () => void): void { this.__timers.countdown(endsAt, tick, done); }
  /** 每帧执行。 */
  protected onUpdate(handler: (deltaMs: number) => void): void { this.__timers.onUpdate(handler); }
  /** 收听广播站的事件，关闭时自动取消。 */
  protected on<P>(event: EventDef<P>, handler: (payload: P) => void): void { this.__scope.add(bus.on(event, handler)); }
}

/** 一个界面。UI 是 ui/ 生成的控件类型（比如 BagPanelUI）。 */
export abstract class View<UI> extends ViewBase<UI> {
  /** 对应的「包/组件」。 */
  static component: string;
  /** 放在哪一层。 */
  static layer: Layer;
  /** 是不是全屏。 */
  static fullScreen?: boolean;
  /** 打开时能传的参数。 */
  static params?: object;
  /** 关闭时可以交回的东西（只写类型）。 */
  static result?: unknown;
  /** 游戏场景要不要同时接收输入。 */
  static inputMode?: InputMode;
  /** 全屏又没有竖版时写 true。 */
  static bothOrientations?: boolean;
  /** 背景音乐（ui://包名/声音名）：栈里最上面写了 music 的已打开界面决定放哪首。 */
  static music?: string;
  /** 绑定表。 */
  bind: Bind<UI> = {};
  /** 按键表。 */
  keys: Keys = {};

  /** 补间：把目标（控件或它们的数组）的属性补到终值，放完时 resolve（被停掉、接管、界面关闭时不 resolve）。写法见 mvc-spec「代码补间」。 */
  protected tween(target: UIObject | readonly UIObject[], to: TweenProps, options: TweenOptions): Promise<void> { return startTween(this.__tweens, this.constructor.name, target, to, options); }
  /** 停掉补间（不写目标是这个界面的全部）；complete: true 时跳到终值，算放完。 */
  protected stopTweens(target?: UIObject | readonly UIObject[], options?: {complete?: boolean}): void { stopTweens(this.__tweens, this.constructor.name, target, options); }
  /** 列表的子项，按序号排好（虚拟列表报错）。 */
  protected itemsOf(list: UIList): UIComponent[] { return itemsOf(this.__tweens, this.constructor.name, list); }
}

/** 列表的子项。Data 是这一项的数据类型。 */
export abstract class ItemView<UI, Data> extends ViewBase<UI> {
  /** 对应的「包/组件」。 */
  static component: string;
  /** 绑定表：值是函数，传入这一项的数据。 */
  bind: ItemBind<UI, Data> = {};

  /** 内部用：渲染列表里的一项（数据变了就重新绑定）。 */
  __render(component: UIComponent, data: unknown, isActive: () => boolean, owner: object): void {
    this.__mount(component, {item: {data}, isActive, owner});
  }
}

/** 好几个界面共用的部件，跟着所在界面一起打开和关闭。 */
export abstract class PartView<UI> extends ViewBase<UI> {
  /** 对应的「包/组件」。 */
  static component: string;
  /** 绑定表。 */
  bind: Bind<UI> = {};

  /** 补间：把目标（控件或它们的数组）的属性补到终值，放完时 resolve（被停掉、接管、界面关闭时不 resolve）。写法见 mvc-spec「代码补间」。 */
  protected tween(target: UIObject | readonly UIObject[], to: TweenProps, options: TweenOptions): Promise<void> { return startTween(this.__tweens, this.constructor.name, target, to, options); }
  /** 停掉补间（不写目标是这个界面的全部）；complete: true 时跳到终值，算放完。 */
  protected stopTweens(target?: UIObject | readonly UIObject[], options?: {complete?: boolean}): void { stopTweens(this.__tweens, this.constructor.name, target, options); }
  /** 列表的子项，按序号排好（虚拟列表报错）。 */
  protected itemsOf(list: UIList): UIComponent[] { return itemsOf(this.__tweens, this.constructor.name, list); }
}

const viewStatics = ['component', 'layer', 'fullScreen', 'params', 'result', 'inputMode', 'bothOrientations', 'music'];
const layers: readonly Layer[] = ['hud', 'page', 'popup', 'modal', 'toast'];
const ownStatics = (cls: object): string[] => Object.getOwnPropertyNames(cls).filter(name => !['length', 'name', 'prototype'].includes(name));

/** 内部用：打开界面前检查 View 的 8 项固定信息（lgui check 会提前查出来）。 */
export function validateViewClass(cls: object & {name: string; prototype: object; component?: unknown; layer?: unknown; inputMode?: unknown; music?: unknown}): void {
  const isItemOrPart = cls.prototype instanceof ItemView || cls.prototype instanceof PartView;
  const allowed = isItemOrPart ? ['component'] : viewStatics;
  for (const name of ownStatics(cls)) {
    if (!allowed.includes(name)) throw new LgRuntimeError('LGUI-RT-061', `${cls.name} 写了清单以外的 static ${name}。`, `能写的只有：${allowed.join('、')}。`);
  }
  if (typeof cls.component !== 'string' || !/^[A-Z][A-Za-z0-9]*\/[A-Z][A-Za-z0-9]*$/.test(cls.component)) {
    throw new LgRuntimeError('LGUI-RT-060', `${cls.name} 缺少必填的 static component（「包/组件」），或者写法不对。`, "写成 static component = 'Bag/BagPanel';");
  }
  if (!isItemOrPart) {
    if (!layers.includes(cls.layer as Layer)) throw new LgRuntimeError('LGUI-RT-060', `${cls.name} 缺少必填的 static layer，或者不是 5 层之一。`, `写成 static layer = 'page' as const;（能用：${layers.join('、')}）`);
    if (cls.inputMode !== undefined && !['ui', 'game', 'all'].includes(cls.inputMode as string)) throw new LgRuntimeError('LGUI-RT-060', `${cls.name} 的 static inputMode 只能是 ui、game、all。`, '改成其中一个，或者不写。');
    if (cls.music !== undefined && (typeof cls.music !== 'string' || !/^ui:\/\/[A-Z][A-Za-z0-9]*\/[^/\s]+$/.test(cls.music))) throw new LgRuntimeError('LGUI-RT-060', `${cls.name} 的 static music 写法不对（${String(cls.music)}）。`, "写成 static music = 'ui://Common/bgm';（ui/ 包里登记的声音），或者不写。");
  }
}
