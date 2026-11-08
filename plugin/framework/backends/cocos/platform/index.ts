// cocos 后端的平台服务：引擎 API（Web 目标优先；差异点都在注释里标了）。
import {game, sys, view, assetManager, Component, Game, type AssetManagerBundle} from 'cc';
import * as fgui from 'fairygui-cc';
import type {
  Platform, KeyInput, WheelInput, NetResponse, NetSocket, Insets, PointerInput, Rect, Unsubscribe
} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';
import {fitDesign, stage} from '../screen';
import {toPointerInput} from '../pointer';
import type {FguiEventOf} from '../pointer';
import {installImeTracking, isComposing} from '../ime';
import {createCocosAudio} from './audio';
import {consoleLogger} from './log';
import {createCocosClipboard} from './clipboard';

// 一组回调，返回取消函数。传了 onError 时，一个回调出错交给 onError，其余回调照常调用（同 h5）。
class Handlers<T> {
  private set = new Set<(value: T) => void>();
  add(handler: (value: T) => void): Unsubscribe { this.set.add(handler); return () => { this.set.delete(handler); }; }
  emit(value: T, onError?: (error: unknown) => void): void {
    for (const handler of Array.from(this.set)) {
      // 注册了非函数是缺陷：报出值本身，别只留一句 TypeError（T007 校准诊断）。
      if (typeof handler !== 'function') { console.error(`[lgui] Handlers 注册了非函数（${typeof handler}）：`, handler); continue; }
      if (!onError) { handler(value); continue; }
      try { handler(value); } catch (error) { onError(error); }
    }
  }
}

// 统一按键名：浏览器返回键当 Back（Web 目标用 document 键盘事件；原生目标 T012 换引擎输入）。
function keyName(event: KeyboardEvent): string {
  if (event.key === 'GoBack' || event.key === 'BrowserBack') return 'Back';
  if (event.key === 'Esc') return 'Escape';
  return event.key;
}

// 每帧驱动：挂一个空组件在根节点上，update(dt) 就是引擎的帧回调（运行库的 GObjectPartner 同款做法）。
class FrameDriver extends Component {
  private onFrame: ((dtMs: number) => void) | null = null;
  set(handler: (dtMs: number) => void): void { this.onFrame = handler; }
  override update(dt: number): void { this.onFrame?.(dt * 1000); }
}

// 包加载走的 bundle 名与目录（decisions/003）：uiBase 即 bundle 名（默认 lgui-ui），目录 assets/<bundle>/<包名>/。
let bundle: AssetManagerBundle | null = null;
export const bundleReady = (bundleName: string): Promise<AssetManagerBundle> => new Promise((resolve, reject) => {
  const existing = assetManager.bundles?.get?.(bundleName);
  if (bundle && bundle.name === bundleName) { resolve(bundle); return; }
  if (existing) { bundle = existing; resolve(existing); return; }
  assetManager.loadBundle(bundleName, (error, loaded) => {
    if (error) { reject(new LgRuntimeError('LGUI-RT-011', `读不到界面包 bundle ${bundleName}（${error.message}）。`, '确认该目录已设为 bundle，且先运行包同步生成产物。')); return; }
    bundle = loaded;
    resolve(loaded);
  });
});

export function createCocosPlatform(projectName: string, uiBase: string): Platform {
  const bundleName = uiBase || 'lgui-ui';
  const frame = new Handlers<number>();
  const visibility = new Handlers<boolean>();
  const pointer = new Handlers<PointerInput>();
  const keys = new Handlers<KeyInput>();
  const wheels = new Handlers<WheelInput>();
  const resizes = new Handlers<{width: number; height: number}>();
  const audio = createCocosAudio();
  const unlockAudio = (): void => audio.unlock(); // 第一次点击或按键时解锁声音
  installImeTracking();
  const root = fgui.GRoot.inst;
  // 这个后端自己加载过的界面包。FairyGUI 按包名全局注册（UIPackage.getByName），页面上别的来源
  // （比如另一份 UI 产物的引导/冒烟代码）先加载了同名包的话，create 会拿到别家的组件——绑定层
  // 就会报「组件里没有这个控件」（T008 的 LGUI-RT-062 就是这么来的）。所以加载时校验归属，报错不混用。
  const ownPackages = new Set<string>();

  // 每帧：一个回调出错不影响别的回调，也不会让以后的帧停掉（定时器、lgui.time.wait、请求超时、旋转换版都靠它）。
  const driver = root.node.addComponent(FrameDriver);
  driver.set(dt => { frame.emit(dt, reportError); audio.tickMusic(dt); });
  // 切后台/回前台。
  game.on(Game.EVENT_HIDE, () => visibility.emit(false));
  game.on(Game.EVENT_SHOW, () => visibility.emit(true));

  function reportError(error: unknown): void {
    if (error instanceof LgRuntimeError) console.error(`[lgui] ${error.code}  ${error.message}  → ${error.next}`);
    else console.error('[lgui] 帧回调出错（未捕获）：', error);
  }

  const size = (): {width: number; height: number} => {
    const visible = view.getVisibleSize();
    return {width: visible.width, height: visible.height};
  };

  // 原始输入（舞台上的全部指针，支持多点）：根节点收冒泡上来的运行库事件，坐标已是设计尺寸。
  for (const type of [fgui.Event.TOUCH_BEGIN, fgui.Event.TOUCH_MOVE, fgui.Event.TOUCH_END]) {
    root.on(type, event => {
      pointer.emit(toPointerInput(event as unknown as FguiEventOf));
      unlockAudio();
    });
  }
  // 滚轮：引擎只有纵向量（mouseWheelDelta），横向滚动量运行库没透出，记 0。
  root.on(fgui.Event.MOUSE_WHEEL, event => {
    const wheel = event as unknown as FguiEventOf;
    wheels.emit({x: wheel.pos.x, y: wheel.pos.y, deltaX: 0, deltaY: wheel.mouseWheelDelta});
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', e => { if (!isComposing()) keys.emit({type: 'down', key: keyName(e), repeat: e.repeat}); unlockAudio(); });
    document.addEventListener('keyup', e => { if (!isComposing()) keys.emit({type: 'up', key: keyName(e), repeat: false}); });
    const onResize = (): void => resizes.emit(size());
    window.addEventListener('resize', onResize); // Web 目标：画布跟窗口走（原生目标 T012）
  }

  const prefix = `lgui:${projectName}:`;

  const platform: Platform = {
    time: {now: () => performance.now(), onFrame: h => frame.add(h), onVisibilityChange: h => visibility.add(h)},
    storage: {
      get: key => sys.localStorage.getItem(prefix + key),
      set: (key, value) => sys.localStorage.setItem(prefix + key, value),
      remove: key => sys.localStorage.removeItem(prefix + key)
    },
    resource: {
      loadPackage: async name => {
        if (fgui.UIPackage.getByName(name)) {
          // 同名包已经在页面里，但不是这个后端加载的：多半是别的 UI 产物先加载了它。报出来，别静默当成「已加载」。
          if (!ownPackages.has(name)) throw new LgRuntimeError('LGUI-RT-264', `界面包 ${name} 已经在页面里加载过了，但不是这个后端加载的（同名包来自别的 bundle 或来源，FairyGUI 按包名全局注册）。`, '一个页面只放一套 LGUI 的界面包：找出谁先加载了同名包（比如别的工程的引导或冒烟代码），别让两份 UI 产物进同一个页面。');
          return;
        }
        const loaded = await bundleReady(bundleName);
        // 路径约定：<包名>/<包名>.bin（decisions/003）。运行库拿 path 直接 bundle.load；
        // Raw Asset（.bytes）按 CC 文档要带扩展名，老版本资源库不带——两种都试，全失败才报错（错误里带上两种路径）。
        const withExt = `${name}/${name}.bin`;
        const withoutExt = `${name}/${name}`;
        let lastError: Error | null = null;
        for (const candidate of [withExt, withoutExt]) {
          try {
            await new Promise<void>((resolve, reject) => fgui.UIPackage.loadPackage(loaded, candidate, error => {
              if (error) reject(error instanceof Error ? error : new Error(String(error)));
              else resolve();
            }));
            lastError = null;
            break;
          } catch (error) { lastError = error instanceof Error ? error : new Error(String(error)); }
        }
        if (lastError) throw new LgRuntimeError('LGUI-RT-012', `界面包 ${name} 加载失败（${lastError.message}；试过 ${withExt} 和 ${withoutExt}）。`, '重新运行包同步，确认 assets/lgui-ui/ 里有这个包（.bin），并把 lgui-ui 目录设为 bundle。');
        ownPackages.add(name);
      },
      releasePackage: name => {
        ownPackages.delete(name);
        if (fgui.UIPackage.getByName(name)) fgui.UIPackage.removePackage(name);
      },
      hasPackage: name => fgui.UIPackage.getByName(name) !== undefined,
      loadImage: url => new Promise((resolve, reject) => {
        if (url.startsWith('ui://')) { resolve(); return; } // 包里的图，包加载后同步就绪
        if (typeof Image === 'undefined') { reject(new LgRuntimeError('LGUI-RT-025', `图片 ${url} 加载失败（原生目标的网络图还没接）。`, 'M1 只支持 Web 目标的网络图片。')); return; }
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new LgRuntimeError('LGUI-RT-025', `图片 ${url} 加载失败。`, '确认地址对、文件存在。'));
        image.src = url;
      })
    },
    input: {onPointer: h => pointer.add(h), onKey: h => keys.add(h), onWheel: h => wheels.add(h), setInputMode: () => {}},
    textInput: {isComposing},
    screen: {
      size,
      safeArea(): Insets {
        // 引擎的安全区是 UI 像素、原点左下 y 向上；换算成设计尺寸里距四边的内边距。
        const rect = sys.getSafeAreaRect();
        const scale = stage.scale || 1;
        return {
          top: Math.max(0, size().height - rect.y - rect.height) / scale,
          right: Math.max(0, size().width - rect.x - rect.width) / scale,
          bottom: Math.max(0, rect.y) / scale,
          left: Math.max(0, rect.x) / scale
        };
      },
      onResize: h => resizes.add(h),
      applyDesignSize(design): Rect {
        const {scale, visible} = fitDesign(size(), design);
        stage.scale = scale;
        root.setScale(scale, scale, 1);
        root.setSize(visible.width, visible.height);
        return visible;
      }
    },
    audio: audio.service,
    locale: {systemLanguages: () => [sys.language]},
    log: consoleLogger(),
    clipboard: createCocosClipboard(),
    net: {
      async fetch(url, init = {}): Promise<NetResponse> {
        const response = await fetch(url, init);
        return {status: response.status, ok: response.ok, text: () => response.text(), json: () => response.json() as Promise<unknown>};
      },
      webSocket(url): NetSocket {
        const socket = new WebSocket(url);
        const on = <K extends keyof WebSocketEventMap>(type: K, handler: (event: WebSocketEventMap[K]) => void): Unsubscribe => {
          socket.addEventListener(type, handler);
          return () => socket.removeEventListener(type, handler);
        };
        return {
          send: data => socket.send(data),
          close: () => socket.close(),
          onMessage: h => on('message', e => h(String(e.data))),
          onClose: h => on('close', e => h(e.code)),
          onOpen: h => on('open', () => h())
        };
      }
    }
  };
  return platform;
}
