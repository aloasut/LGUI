// headless 后端：在 Node 里跑，只模拟控件树和属性，不算布局、不渲染。lgui test 用它。
import type {Backend, BackendConfig, Insets, KeyInput, LogLevel, Logger, Platform, PointerInput, UIComponent, WheelInput} from '../../core/index';
import {LgRuntimeError, notImplemented} from '../../core/index';
import type {ComponentDescriptor, PackageDescriptor} from './descriptor';
import {Handlers, HeadlessComponent, HeadlessLoader, HeadlessObject, HeadlessTransition, buildComponent, buildImage} from './objects';

/** headless 记下的一条日志。 */
export interface HeadlessLogRecord {
  /** 级别。 */
  level: LogLevel;
  /** 分类：默认是 game，child 往后接。 */
  category: string;
  /** 事件名。 */
  event: string;
  /** 数据（写成函数的已经算出来）。 */
  data?: unknown;
  /** 错误。 */
  error?: unknown;
  /** child 带上的上下文。 */
  context?: object;
  /** 记录时间（假时钟，毫秒）。 */
  time: number;
}

/** headless 后端独有的状态，模拟操作和测试断言用。 */
export interface HeadlessState {
  /** 假时钟（毫秒）。 */
  now: number;
  /** 屏幕尺寸。 */
  screen: {width: number; height: number};
  /** 安全区的边距（屏幕像素），默认全是 0。 */
  safeArea: Insets;
  /** 系统语言。 */
  languages: string[];
  /** 存储。 */
  storage: Map<string, string>;
  /** 放过的音效（地址统一成 ui://包名/声音名，音量是最终音量）。 */
  sounds: {url: string; volume: number}[];
  /** 正在放的背景音乐，没有是 null。 */
  music: {url: string; volume: number} | null;
  /** 声音是不是暂停着（切到后台）。 */
  audioPaused: boolean;
  /** 全部日志。 */
  logs: HeadlessLogRecord[];
  /** 剪贴板里的文字（writeText 写进来，测试里可以直接读、也可以先放好）。 */
  clipboard: string;
  /** backend.init 时传进来的项目字体名（只登记，不读字体文件；文字度量照样报 LGUI-RT-260）。 */
  fonts: string[];
  /** 当前告诉游戏场景的输入模式。 */
  inputMode: 'ui' | 'game' | 'all';
  /** 已加载的包。 */
  loaded: Set<string>;
  /** 回调。 */
  handlers: {frame: Handlers<number>; visibility: Handlers<boolean>; pointer: Handlers<PointerInput>; key: Handlers<KeyInput>; wheel: Handlers<WheelInput>; resize: Handlers<{width: number; height: number}>};
}

export interface HeadlessBackend extends Backend {
  /** 模拟和断言用的状态。 */
  readonly state: HeadlessState;
}

// 默认的日志出口：全部记进 state.logs（lgui test 里有 error 级的记录，这个测试就判失败）。
function recorder(state: HeadlessState, category: string, context: object): Logger {
  const write = (level: LogLevel, event: string, data: unknown, error: unknown): void => {
    const record: HeadlessLogRecord = {level, category, event, time: state.now};
    const value = typeof data === 'function' ? (data as () => unknown)() : data;
    if (value !== undefined) record.data = value;
    if (error !== undefined) record.error = error;
    if (Object.keys(context).length) record.context = context;
    state.logs.push(record);
  };
  return {
    enabled: () => true,
    debug: (event, data) => write('debug', event, data, undefined),
    info: (event, data) => write('info', event, data, undefined),
    warn: (event, data, error) => write('warn', event, data, error),
    error: (event, error, data) => write('error', event, data, error),
    child: (extra, sub) => recorder(state, sub ? `${category}.${sub}` : category, {...context, ...extra})
  };
}

/** packages 是 lgui 生成的 headless 描述（.lgui/build/headless/*.json），由 lgui test 打包进测试。 */
/** translations：每种语言「翻译文件里的名字 → 文字」（lgui test 生成）。 */
export function createHeadlessBackend(packages: readonly PackageDescriptor[], translations: Record<string, Record<string, string>> = {}): HeadlessBackend {
  const byPackage = new Map(packages.map(p => [p.package, p]));
  const components = new Map<string, ComponentDescriptor>();
  const images = new Map<string, {width: number; height: number}>();
  for (const p of packages) for (const image of p.images ?? []) images.set(`ui://${p.package}/${image.name}`, image);
  const owners = new Map<string, string>();
  for (const p of packages) for (const c of p.components) { components.set(c.name, c); owners.set(c.name, p.id + c.id); }
  let translation: Record<string, string> = {};
  const lookup = (name: string): ComponentDescriptor => {
    const found = components.get(name);
    if (!found) throw new LgRuntimeError('LGUI-RT-003', `没有组件 ${name}。`, '用 lgui ui list 查看有哪些组件。');
    return found;
  };
  // 登记过的声音：ui://包名/声音名 和 ui://包ID资源ID 都认，统一成 ui://包名/声音名。
  const sounds = new Map<string, string>();
  for (const p of packages) for (const sound of p.sounds ?? []) { const url = `ui://${p.package}/${sound.name}`; sounds.set(url, url); sounds.set(`ui://${p.id}${sound.id}`, url); }
  const soundUrl = (url: string, onError: (error: unknown) => void): string | null => {
    if (!url.startsWith('ui://')) return url;
    const found = sounds.get(url);
    if (!found) onError(new LgRuntimeError('LGUI-RT-170', `声音 ${url} 没有登记在 ui/ 的包里。`, '把 mp3 放进包目录，在 package.xml 里登记成 <sound … exported="true"/>，地址写成 ui://包名/声音名。'));
    return found ?? null;
  };
  const state: HeadlessState = {
    now: 0, screen: {width: 1920, height: 1080}, safeArea: {top: 0, right: 0, bottom: 0, left: 0}, languages: ['zh-CN'], storage: new Map(), sounds: [], music: null, audioPaused: false, logs: [], clipboard: '', fonts: [], inputMode: 'ui', loaded: new Set(),
    handlers: {frame: new Handlers(), visibility: new Handlers(), pointer: new Handlers(), key: new Handlers(), wheel: new Handlers(), resize: new Handlers()}
  };
  let prefix = '';
  const root = new HeadlessComponent('root', 'root', 'container');
  const h = state.handlers;
  HeadlessTransition.frames = h.frame;
  HeadlessObject.pointerTarget = null;
  const platform: Platform = {
    time: {now: () => state.now, onFrame: f => h.frame.add(f), onVisibilityChange: f => h.visibility.add(f)},
    storage: {get: key => state.storage.get(prefix + key) ?? null, set: (key, value) => { state.storage.set(prefix + key, value); }, remove: key => { state.storage.delete(prefix + key); }},
    resource: {
      loadPackage: async name => {
        if (!byPackage.has(name)) throw new LgRuntimeError('LGUI-RT-011', `没有界面包 ${name}。`, '确认包名对，并重新生成。');
        state.loaded.add(name);
      },
      releasePackage: name => { state.loaded.delete(name); },
      hasPackage: name => state.loaded.has(name),
      loadImage: async url => {
        if (HeadlessLoader.failExternal && !url.startsWith('ui://')) throw new LgRuntimeError('LGUI-RT-025', `图片 ${url} 加载失败。`, '确认地址对、文件存在。');
      }
    },
    input: {onPointer: f => h.pointer.add(f), onKey: f => h.key.add(f), onWheel: f => h.wheel.add(f), setInputMode: mode => { state.inputMode = mode; }},
    textInput: {isComposing: () => false},
    screen: {
      size: () => ({...state.screen}),
      safeArea: () => ({...state.safeArea}),
      onResize: f => h.resize.add(f),
      applyDesignSize(design) {
        const scale = Math.min(state.screen.width / design.width, state.screen.height / design.height);
        const visible = {x: 0, y: 0, width: state.screen.width / scale, height: state.screen.height / scale};
        root.rect = visible;
        return visible;
      }
    },
    audio: {
      play(url, volume, onError) { const found = soundUrl(url, onError); if (found) state.sounds.push({url: found, volume}); },
      music(url, volume, _fadeMs, onError) {
        if (url === null) { state.music = null; return; }
        const found = soundUrl(url, onError);
        if (found) state.music = {url: found, volume};
      },
      setPaused(paused) { state.audioPaused = paused; }
    },
    locale: {systemLanguages: () => [...state.languages]},
    log: recorder(state, 'game', {}),
    net: {fetch: () => { throw notImplemented('网络（测试里用 Service 的假实现）', 'headless'); }, webSocket: () => { throw notImplemented('WebSocket（测试里用 Service 的假实现）', 'headless'); }},
    // 剪贴板存在内存里（state.clipboard）。
    clipboard: {writeText: async text => { state.clipboard = text; }, readText: async () => state.clipboard}
  };
  return {
    name: 'headless',
    state,
    root,
    platform,
    async init(config: BackendConfig) { prefix = `lgui:${config.projectName}:`; state.fonts = [...config.fonts ?? []]; },
    loadPackage: name => platform.resource.loadPackage(name),
    releasePackage: name => platform.resource.releasePackage(name),
    create<Name extends string>(packageName: string, componentName: string): UIComponent<Name> {
      if (!state.loaded.has(packageName)) throw new LgRuntimeError('LGUI-RT-002', `界面包 ${packageName} 还没加载。`, '先加载这个包（UIManager 打开界面时会自动加载）。');
      return buildComponent(lookup(`${packageName}/${componentName}`), lookup, undefined, undefined, undefined, {owners, translation}) as unknown as UIComponent<Name>;
    },
    async setLanguage(language) { translation = translations[language] ?? {}; },
    imageSize: url => { const found = images.get(url); return found && state.loaded.has(url.slice(5).split('/')[0]) ? {width: found.width, height: found.height} : null; },
    createImage(url) { return buildImage(url, this.imageSize(url)); },
    has: (packageName, componentName) => state.loaded.has(packageName) && components.has(`${packageName}/${componentName}`),
    createContainer: name => new HeadlessComponent(name, '', 'container')
  };
}
