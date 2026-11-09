// 一个最小的假后端：证明接口层能被完整实现，并用来测事件订阅和取消。
import type {Backend, Logger, Platform, UIComponent, UIObject, UIController, PointerInput, WheelInput, Unsubscribe, Rect} from '../../../plugin/framework/core/index';
import {LgRuntimeError, notImplemented} from '../../../plugin/framework/core/index';

// 简单的事件源：订阅返回取消函数。
export class Emitter<T> {
  private handlers = new Set<(value: T) => void>();
  on(handler: (value: T) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }
  emit(value: T): void { for (const handler of [...this.handlers]) handler(value); }
  get size(): number { return this.handlers.size; }
}

class FakeObject implements UIObject {
  visible = true;
  enabled = true;
  touchable = true;
  rect: Rect = {x: 0, y: 0, width: 100, height: 100};
  customData = '';
  readonly pointer = new Emitter<PointerInput>();
  readonly wheels = new Emitter<WheelInput>();
  constructor(readonly name: string) {}
  get shown(): boolean { return this.visible; }
  onPointer(handler: (event: PointerInput) => void): Unsubscribe { return this.pointer.on(handler); }
  hitDepth(): number { return -1; }
  onWheel(handler: (event: WheelInput) => void): Unsubscribe { return this.wheels.on(handler); }
  parent: UIObject | null = null;
  disposed = false;
  pivot = {x: 0, y: 0};
  supports(): boolean { return false; }
  getProp(): number { return 0; }
  setProp(): void {}
  ownerOf(): string | null { return null; }
}

export class FakeController implements UIController<'a' | 'b'> {
  readonly pages = ['a', 'b'] as const;
  readonly changes = new Emitter<'a' | 'b'>();
  private page: 'a' | 'b' = 'a';
  constructor(readonly name: string) {}
  get selectedPage(): 'a' | 'b' { return this.page; }
  set selectedPage(page: 'a' | 'b') { if (page !== this.page) { this.page = page; this.changes.emit(page); } }
  onChange(handler: (page: 'a' | 'b') => void): Unsubscribe { return this.changes.on(handler); }
}

export class FakeComponent extends FakeObject implements UIComponent {
  readonly children: UIObject[] = [];
  readonly tabs = new FakeController('tabs');
  constructor(name: string, readonly componentName: string) { super(name); }
  child(path: string): UIObject | null { return this.children.find(c => c.name === path) ?? null; }
  controller(name: string): UIController | null { return name === 'tabs' ? this.tabs : null; }
  transition(): null { return null; }
  allTransitions(): readonly [] { return []; }
  childNames(): readonly string[] { return this.children.map(c => c.name); }
  addChild(child: UIObject): void { this.children.push(child); }
  removeChild(child: UIObject): void { this.children.splice(this.children.indexOf(child), 1); }
  dispose(): void { this.children.length = 0; }
}

const unsupported = (feature: string): never => { throw notImplemented(feature, 'fake'); };

// 什么都不记的日志出口。
const silentLog: Logger = {enabled: () => false, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silentLog};

export function createFakeBackend(): Backend {
  const frame = new Emitter<number>();
  const platform: Platform = {
    time: {now: () => 0, onFrame: h => frame.on(h), onVisibilityChange: () => () => {}},
    storage: {get: () => null, set: () => {}, remove: () => {}},
    resource: {loadPackage: async () => {}, releasePackage: () => {}, hasPackage: () => false, loadImage: async () => {}},
    input: {onPointer: () => () => {}, onKey: () => () => {}, onWheel: () => () => {}, setInputMode: () => {}},
    textInput: {isComposing: () => false},
    screen: {size: () => ({width: 1920, height: 1080}), safeArea: () => ({top: 0, right: 0, bottom: 0, left: 0}), onResize: () => () => {}, applyDesignSize: () => ({x: 0, y: 0, width: 1920, height: 1080})},
    audio: {play: () => {}, music: () => {}, setPaused: () => {}},
    locale: {systemLanguages: () => ['zh-CN']},
    log: silentLog,
    net: {fetch: () => unsupported('网络'), webSocket: () => unsupported('WebSocket')},
    clipboard: {writeText: async () => unsupported('剪贴板'), readText: async () => unsupported('剪贴板')}
  };
  return {
    name: 'headless',
    root: new FakeComponent('root', 'root'),
    init: async () => {},
    loadPackage: async () => {},
    releasePackage: () => {},
    create: <Name extends string>(pkg: string, comp: string) => {
      if (pkg !== 'Main') throw new LgRuntimeError('LGUI-RT-002', `没有界面包 ${pkg}。`, '先加载这个包。');
      return new FakeComponent(comp, `${pkg}/${comp}`) as unknown as UIComponent<Name>;
    },
    has: () => false,
    setLanguage: async () => {},
    imageSize: () => null,
    createImage: url => new FakeObject(url),
    createContainer: name => new FakeComponent(name, ''),
    platform
  };
}
