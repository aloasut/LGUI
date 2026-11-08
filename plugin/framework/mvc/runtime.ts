// 框架运行时：当前用的后端、工程配置和日志、声音的出口。由 lgui 启动时（网页、测试、Unity）设置。
import type {AudioService, Backend, ClipboardService, Logger} from '../core/index';
import {LgRuntimeError} from '../core/index';

/** 框架用到的工程配置（来自 .lgui/project.json）。 */
export interface RuntimeConfig {
  /** 工程名。 */
  name: string;
  /** 设计尺寸。 */
  designSize: {landscape: {width: number; height: number}; portrait: {width: number; height: number}};
  /** 方向。 */
  orientation: 'both' | 'landscape' | 'portrait';
  /** 语言列表。 */
  languages: string[];
  /** 默认语言。 */
  defaultLanguage: string;
  /** 按平台的「按键 → 动作」。 */
  keyMap: Record<string, Record<string, string>>;
  /** 界面缓存。 */
  uiCache: {keepClosedViews: number};
  /** 请求失败时统一弹提示。 */
  requestErrorToast: boolean;
  /** 请求超时（毫秒）。 */
  requestTimeoutMs: number;
  /** 默认占位图。 */
  placeholder: string;
  /** 按钮的默认音效（ui/ 里按钮没写音效时用），null 表示不放。 */
  sounds: {click: string | null};
}

/** 默认配置（和 lgui init 生成的一样），测试里可以只改其中几项。 */
export const defaultConfig: RuntimeConfig = {
  name: 'lgui', designSize: {landscape: {width: 1920, height: 1080}, portrait: {width: 1080, height: 1920}}, orientation: 'both',
  languages: ['zh-CN', 'en'], defaultLanguage: 'zh-CN', keyMap: {}, uiCache: {keepClosedViews: 0}, requestErrorToast: true,
  requestTimeoutMs: 10000, placeholder: 'ui://Common/placeholder', sounds: {click: null}
};

interface Current {
  backend: Backend;
  config: RuntimeConfig;
  /** 每个界面包依赖哪些别的包（lgui 生成的 .lgui/build/deps.json）。 */
  deps: Record<string, string[]>;
  /** UIManager（启动时创建）。 */
  ui: unknown;
  /** 启动时的墙上时间和后端时钟，用来算 lgui.time.now()。 */
  wallBase: number;
  monoBase: number;
  /** 和服务器的时间差（毫秒）。 */
  serverOffset: number;
  /** 日志出口：lgui.app({ platform: { log } }) 交进来的，没交就是后端自带的。 */
  log: Logger;
  /** 声音出口：lgui.app({ platform: { audio } }) 交进来的，没交就是后端自带的。 */
  audio: AudioService;
  /** 剪贴板：lgui.app({ platform: { clipboard } }) 交进来的，没交就是后端自带的。 */
  clipboard: ClipboardService;
}

/** lgui.app({ platform }) 里能换掉的平台服务。 */
export interface PlatformOverrides {
  /** 日志出口（形状和 Lumio 引擎的 Logger 一样）。 */
  log?: Logger;
  /** 声音出口。 */
  audio?: AudioService;
  /** 剪贴板（宿主自己管剪贴板时交进来）。 */
  clipboard?: ClipboardService;
}

let current: Current | null = null;

/** 内部用：设置当前后端。platform 里给了的服务换掉后端自带的，其余用后端的。 */
export function setRuntime(backend: Backend, config: RuntimeConfig, wallBase = Date.now(), deps: Record<string, string[]> = {}, platform: PlatformOverrides = {}): void {
  // 缺的字段用默认值补齐（defaultConfig 的注释承诺「测试里可以只改其中几项」）——
  // conf 工程不配 sounds 时 clickSound 读 config.sounds.click 直接崩（T008d 输入位首次真正点击时暴露）。
  const merged = {...defaultConfig, ...config};
  current = {
    backend, config: merged, deps, ui: null, wallBase, monoBase: backend.platform.time.now(), serverOffset: 0,
    log: platform.log ?? backend.platform.log, audio: platform.audio ?? backend.platform.audio, clipboard: platform.clipboard ?? backend.platform.clipboard
  };
}

/** 框架启动了没有。 */
export function hasRuntime(): boolean { return current !== null; }

/** 内部用：清掉（测试之间用）。 */
export function clearRuntime(): void { current = null; }

/** 内部用：当前运行时；框架还没启动时报 LGUI-RT-050。 */
export function runtime(): Current {
  if (!current) throw new LgRuntimeError('LGUI-RT-050', '框架还没启动。', '用 lgui dev 预览，或者在测试里先调用 lgui.testing.start(app)。');
  return current;
}

/** 当前时间（毫秒，墙上时间，和服务器对齐过）。 */
export function wallNow(): number {
  const r = runtime();
  return r.wallBase + (r.backend.platform.time.now() - r.monoBase) + r.serverOffset;
}
