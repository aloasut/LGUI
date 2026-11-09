// lgui 对象：游戏代码用到的全部框架功能。写法见 references/mvc-spec.md。
import type {ClipboardService, Logger, NetService, Rect, StorageService} from '../core/index';
import {LgRuntimeError} from '../core/index';
import type {InputMode, InputType, Layer, Orientation, ParamsOf, Readable, ResultOf, ViewClass} from './types';
import {todo} from './todo';
import {createModel} from './model';
import {bus, builtinEvents, defineEvent} from './events';
import {UIManager} from './ui/manager';
import {currentLanguage, setCurrentLanguage, t} from './i18n';
import {createRequest} from './request';
import {service} from './service';
import {snapshot} from './snapshot';
import * as common from './common-views';
import {getRedDot, setRedDot} from './red-dot';
import type {Entry} from './ui/manager';
import {runtime, wallNow} from './runtime';
import type {PlatformOverrides} from './runtime';
import type {Model} from './model';
import {frameWait} from './wait';
import {log} from './log';
import * as sound from './sound';
import type {SoundChannel, SoundSettings} from './sound';
import {switchBackendLanguage} from './boot';
import {switchLanguage} from './language-switch';

/** 入口 main.ts 的定义。 */
export interface AppDefinition {
  /** 默认后端；lgui test 换成 headless，导出 Unity 时换成 unity，Cocos Creator 工程用 cocos。 */
  backend: 'h5' | 'headless' | 'unity' | 'cocos';
  /** 注册服务：名字 → 创建函数。 */
  services?: Record<string, () => object>;
  /** 换掉后端自带的平台服务，只换给出的几项：log（日志出口，形状和 Lumio 引擎的 Logger 一样）、audio（声音出口）、clipboard（剪贴板）。lgui test 里不生效。 */
  platform?: PlatformOverrides;
  /** 启动：通常是打开第一个界面。 */
  start(): void | Promise<void>;
}

export type {Model, SoundChannel, SoundSettings, PlatformOverrides};

/** 请求状态。 */
export interface RequestState<T> {
  /** 没跑过、等待中、成功、失败。 */
  status: 'idle' | 'pending' | 'succeeded' | 'failed';
  /** 成功时的结果。 */
  value: T | undefined;
  /** 失败时的错误（带 LGUI-RT 错误码）。 */
  error: LgRuntimeError | null;
}

/** 一次请求的结果。 */
export type RequestResult<T> = {ok: true; value: T; error: null} | {ok: false; value: undefined; error: LgRuntimeError};

/** lgui.request 包好的请求。 */
export interface Request<Args extends unknown[], T> extends Readable<RequestState<T>> {
  /** 发请求。 */
  run(...args: Args): Promise<RequestResult<T>>;
}

/** 广播站的一个事件。 */
export interface EventDef<Payload> {
  /** 事件名。 */
  readonly name: string;
  /** 只用于类型。 */
  readonly __payload?: Payload;
}

/** 带着是哪个界面的事件参数。 */
export interface ViewEvent {
  /** 界面的类。 */
  view: ViewClass;
}

/** t.look 的结果。 */
export interface Look {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  width: number;
  height: number;
  /** #rrggbb。 */
  color?: string;
  fontSize?: number;
  fillAmount?: number;
}

/** lgui.debug.snapshot() 的结果。 */
export interface Snapshot {
  /** 每一层的界面栈（界面名，从下到上）。 */
  layers: Record<Layer, string[]>;
  /** 激活的界面。 */
  active: string | null;
  /** 每个打开的界面的监听、定时器和正在跑的补间数量（补间含绑定的 roll 和按钮的按下效果）。 */
  views: {name: string; listeners: number; timers: number; tweens: number}[];
  /** 已加载的界面包和引用数。 */
  packages: {name: string; refs: number}[];
  /** 当前方向。 */
  orientation: Orientation;
  /** 当前语言。 */
  language: string;
  /** 当前输入类型。 */
  inputType: InputType;
}

/** lgui.testing.start 返回的测试对象。路径写成「包/组件.控件路径」，列表子项用 list[序号]。 */
export interface TestHarness {
  /** 打开界面。 */
  open<V extends ViewClass>(view: V, params?: ParamsOf<V>): Promise<InstanceType<V>>;
  /** 点击。 */
  click(path: string): Promise<void>;
  /** 长按。 */
  hold(path: string, ms: number): Promise<void>;
  /** 拖拽。 */
  drag(path: string, dx: number, dy: number): Promise<void>;
  /** 拖放：从一个控件拖到另一个控件上松手。 */
  dragTo(from: string, to: string): Promise<void>;
  /** 滑动。 */
  swipe(path: string, dx: number, dy: number): Promise<void>;
  /** 双指缩放。 */
  pinch(path: string, scale: number): Promise<void>;
  /** 滚轮。 */
  wheel(path: string, dy: number): Promise<void>;
  /** 按键。 */
  key(name: string): Promise<void>;
  /** 在输入框里打字：先点一下，再把文字换成 text，一个字一个字地输入（每个字触发一次 input）。 */
  type(path: string, text: string): Promise<void>;
  /** 把滑动条拖到 value（夹在范围内，按 ui/ 的设置取整）。 */
  setValue(path: string, value: number): Promise<void>;
  /** 点开下拉框，选第 index 项（从 0 开始）。 */
  choose(path: string, index: number): Promise<void>;
  /** 读文字。 */
  text(path: string): string;
  /** 是否真的显示着：自己和各级父组件都显示，也没被齿轮或组藏起来。 */
  visible(path: string): boolean;
  /** 是否可用。 */
  enabled(path: string): boolean;
  /** 控制器当前页。 */
  page(path: string): string;
  /** 值：滑动条、进度条的当前值，下拉框的选中序号。 */
  value(path: string): number;
  /** 序列帧动画是否在播放。 */
  playing(path: string): boolean;
  /** 列表项数；树是显示着的节点数。 */
  items(path: string): number;
  /** 控件现在的样子，每一项和 this.tween 里同一个意思（dx、dy 是相对 ui/ 里位置的偏移，其余是绝对值；缩放含按钮的按下效果），控件没有的那几项是 undefined。 */
  look(path: string): Look;
  /** 模拟屏幕尺寸（旋转）。 */
  setScreen(width: number, height: number): Promise<void>;
  /** 模拟安全区（刘海、圆角），边距用屏幕像素。 */
  setSafeArea(insets: {top: number; right: number; bottom: number; left: number}): Promise<void>;
  /** 切换语言。 */
  setLanguage(language: string): Promise<void>;
  /** 切换输入设备。 */
  setInputType(type: InputType): void;
  /** 让假时钟往前走。 */
  advance(ms: number): Promise<void>;
  /** 放过的音效（按顺序；地址是 ui://包名/声音名，音量是最终音量）。 */
  sounds(): {url: string; volume: number}[];
  /** 正在放的背景音乐，没有是 null。 */
  music(): string | null;
  /** 当前快照。 */
  snapshot(): Snapshot;
  /** 关闭所有界面，检查监听和定时器都已清理。 */
  end(): void;
}

/** 打开界面时的选项。 */
export interface OpenOptions<V> {
  /** 这个界面关闭时调用；没交回东西时参数是 undefined。 */
  onClose?: (result: ResultOf<V> | undefined) => void;
}

const manager = (): UIManager => {
  const ui = runtime().ui;
  if (!(ui instanceof UIManager)) throw new LgRuntimeError('LGUI-RT-050', '框架还没启动。', '用 lgui dev 预览，或者在测试里先调用 lgui.testing.start(app)。');
  return ui;
};
const viewOf = (entry: Entry | undefined): object | undefined => entry?.state === 'open' ? entry.view : undefined;

export const lgui = {
  /** 定义入口。 */
  app(definition: AppDefinition): AppDefinition { return definition; },

  /** 定义一个 Model：初始数据加规则。 */
  Model<State extends object, Rules extends object = Record<never, never>>(initial: State, rules?: (set: (partial: Partial<State>) => void, get: () => State) => Rules): Model<State, Rules> {
    return createModel(initial, rules);
  },

  /** 把一个请求包一层，自带状态。 */
  request<Args extends unknown[], T>(run: (...args: Args) => Promise<T>): Request<Args, T> { return createRequest(run); },

  /** 拿一个在 main.ts（或测试）里注册的服务。 */
  service<T>(name: string): T { return service<T>(name); },

  /** UIManager。 */
  ui: {
    /** 压栈打开。 */
    open<V extends ViewClass>(view: V, params?: ParamsOf<V>, options?: OpenOptions<V>): Promise<InstanceType<V>> { return manager().open(view, params as object | undefined, options as {onClose?: (result: unknown) => void}) as Promise<InstanceType<V>>; },
    /** 替换当前栈顶。 */
    replace<V extends ViewClass>(view: V, params?: ParamsOf<V>): Promise<InstanceType<V>> { return manager().replace(view, params as object | undefined) as Promise<InstanceType<V>>; },
    /** 关闭，可以顺带交回 static result 声明的东西。 */
    close<V extends ViewClass>(view: V, result?: ResultOf<V>): void { manager().close(view, result); },
    /** 和按返回键一样。 */
    back(): void { manager().back(); },
    /** 一直关到指定界面。 */
    popTo(view: ViewClass): void { manager().popTo(view); },
    /** 关闭某一层的全部界面。 */
    closeAll(layer: Layer): void { manager().closeAll(layer); },
    /** 有没有打开。 */
    isOpen(view: ViewClass): boolean { return viewOf(manager().entryOf(view)) !== undefined; },
    /** 已经打开的实例。 */
    get<V extends ViewClass>(view: V): InstanceType<V> | undefined { return viewOf(manager().entryOf(view)) as InstanceType<V> | undefined; },
    /** 最上层的界面，或某一层最上面的界面。 */
    top(layer?: Layer): object | undefined { return viewOf(manager().top(layer)); },
    /** 某一层的全部界面，按栈的顺序。 */
    list(layer: Layer): object[] { return manager().shown(layer).map(e => e.view); },
    /** 控件在设计尺寸下的位置和大小，只读。 */
    find(path: string): Rect | null { return manager().find(path); }
  },

  /** 短提示（文本键）。 */
  toast(key: string, params?: Record<string, string | number>): void { common.toast(key, params); },
  /** 确认框，参数都是文本键。 */
  confirm(options: {title: string; message: string; ok?: string; cancel?: string; params?: Record<string, string | number>}): Promise<boolean> { return common.confirm(options); },
  /** 加载中，按次数计数。 */
  loading: {
    /** 显示。 */
    show(): void { common.loading.show(); },
    /** 隐藏（最后一次才真正隐藏）。 */
    hide(): void { common.loading.hide(); }
  },
  /** 红点。 */
  redDot: {
    /** 点亮（true 或数字）或熄灭（false）。 */
    set(path: string, value: boolean | number): void { setRedDot(path, value); },
    /** 当前值（数字是合计）。 */
    get(path: string): boolean | number { return getRedDot(path); }
  },
  /** 取文本，占位符写成 {count}。 */
  t(key: string, params?: Record<string, string | number>): string { return t(key, params); },
  /** 切换语言。同时调用几次时按调用顺序一个一个切；切换期间界面先不刷新、新界面等切完再打开。 */
  async setLanguage(language: string): Promise<void> {
    const {config, backend} = runtime();
    if (!config.languages.includes(language)) throw new LgRuntimeError('LGUI-RT-140', `工程不支持语言 ${language}（languages 是 ${config.languages.join('、')}）。`, '在 .lgui/project.json 的 languages 里加上它，并新建 i18n/' + language + '.json。');
    const ui = manager();
    // 1. 后端加载新语言的翻译，卸载并重新加载界面包（空窗）；2. 换 lgui.t 的文本表；3. 重建已打开的界面（和旋转同一套机制）；4. 发出 languageChange。
    await switchLanguage(() => switchBackendLanguage(backend, language), () => {
      setCurrentLanguage(language);
      ui.rebuildAll();
      bus.emit(builtinEvents.languageChange, {language});
    });
  },
  /** 当前语言。 */
  language(): string { return currentLanguage(); },
  /** 时间。 */
  time: {
    /** 当前时间（毫秒，和服务器对齐过）。 */
    now(): number { return wallNow(); },
    /** 设置和服务器的时间差。 */
    setServerOffset(ms: number): void { runtime().serverOffset = ms; },
    /** 等 ms 毫秒（按每帧的时间累计，lgui test 的假时钟也能推进；切到后台时不走）。给 Service 模拟延迟、重试间隔用；界面上的定时器用 View 的 this.after。 */
    wait(ms: number): Promise<void> { return frameWait(ms).promise; }
  },
  /** 日志：lgui.log.info('bag_opened', { count })。事件名是固定的 snake_case，变化的内容放第二个参数。写到 main.ts 里交进来的日志出口（不交就是后端自带的）。 */
  log: log as Logger,
  /** 声音（背景音乐由 View 的 static music 决定，按钮音写在 ui/ 里）。 */
  sound: {
    /** 放一次音效（只在 Controller 里用）：ui://包名/声音名，volume 0–1，再乘上音效声道的音量。 */
    play(url: string, options?: {volume?: number}): void { sound.play(url, options); },
    /** 设一个声道（'music' 或 'sfx'）的音量 0–1，自动存进本地存储。 */
    setVolume(channel: SoundChannel, volume: number): void { sound.setVolume(channel, volume); },
    /** 设一个声道静音或不静音，自动存进本地存储。 */
    setMuted(channel: SoundChannel, muted: boolean): void { sound.setMuted(channel, muted); },
    /** 当前的声音设置 { music: { volume, muted }, sfx: { volume, muted } }，界面用 pick 读。 */
    settings: sound.soundSettings as Readable<SoundSettings>
  },
  /** 声明一个事件。 */
  defineEvent<P>(name: string): EventDef<P> { return defineEvent<P>(name); },
  /** 广播一个事件。 */
  emit<P>(definition: EventDef<P>, payload: P): void { bus.emit(definition, payload); },
  /** 框架自己的事件。 */
  events: builtinEvents,
  /** 平台服务里给游戏代码用的部分。 */
  platform: {
    /** 网络（只在 Service 里用）。 */
    get net(): NetService { return runtime().backend.platform.net; },
    /** 本地存储。 */
    get storage(): StorageService { return runtime().backend.platform.storage; },
    /** 剪贴板（只在 Controller 里用）：writeText 放进文字、readText 读出文字；读写不了时 Promise 失败（LGUI-RT-241），用 lgui.request 包一层就能拿到 { ok }。 */
    get clipboard(): ClipboardService { return runtime().clipboard; }
  },
  /** 调试。 */
  debug: {
    /** 当前的界面栈、监听、定时器、已加载的包。 */
    snapshot(): Snapshot { return snapshot(manager()); }
  },
  /** 测试（只在 lgui test 里能用）。 */
  testing: {
    /** 用 headless 后端和假时钟启动。 */
    start(app: AppDefinition, options?: {services?: Record<string, () => object>; language?: string; screen?: {width: number; height: number}}): Promise<TestHarness> {
      return import('./testing').then(m => m.startTest(app, options));
    }
  }
};
