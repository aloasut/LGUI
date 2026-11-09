// Unity 后端：用 PuerTS 调用 FairyGUI-unity；游戏代码只通过 core/MVC 接口使用它。
import type {Backend, BackendConfig, Platform, UIComponent} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';
import {createObjectAdapter} from './objects';
import {createUnityPlatform} from './platform';
import type {NativeBridge, UnityGlobals} from './native-backend';

/** 由 Unity 导出的启动代码选择，游戏源码不直接 import Unity 后端。 */
export function createUnityBackend(bridge?: NativeBridge): Backend {
  const globals = globalThis as UnityGlobals;
  let api: NativeBridge | null = null;
  let nativePlatform: ReturnType<typeof createUnityPlatform> | null = null;
  let objects: ReturnType<typeof createObjectAdapter> | null = null;
  let root: UIComponent | null = null;
  let config: BackendConfig | null = null;
  const loaded = new Set<string>();
  const containers = new Set<UIComponent>();
  const scale = {value: 1};
  let frameHook: ((deltaMs: number) => void) | null = null;
  let visibilityHook: ((visible: boolean) => void) | null = null;
  let disposeHook: (() => void) | null = null;

  const ready = (): NativeBridge => {
    if (!api || !nativePlatform || !objects || !root || !config) {
      throw new LgRuntimeError('LGUI-RT-027', 'Unity 后端还没有启动。', '先调用 backend.init(config)。');
    }
    return api;
  };

  const dispose = (): void => {
    for (const container of containers) container.dispose();
    containers.clear();
    objects?.dispose();
    nativePlatform?.dispose();
    if (api) for (const name of loaded) if (api.FairyGUI.UIPackage.GetByName(name)) api.FairyGUI.UIPackage.RemovePackage(name);
    loaded.clear();
    if (globals.__lguiFrame === frameHook) delete globals.__lguiFrame;
    if (globals.__lguiVisibility === visibilityHook) delete globals.__lguiVisibility;
    if (globals.__lguiDispose === disposeHook) delete globals.__lguiDispose;
    nativePlatform = null;
    objects = null;
    root = null;
    config = null;
    api = null;
  };

  return {
    name: 'unity',
    async init(options) {
      const found = bridge ?? globals.CS;
      if (!found?.FairyGUI || !found.UnityEngine?.Rect || !found.LGUI?.Platform || !found.LGUI.LGUIResourceLoader) {
        throw new LgRuntimeError('LGUI-RT-001', '当前运行环境没有 Unity、FairyGUI 和 LGUI 的 PuerTS 类型。', '在 Unity 6000.6 中安装 LGUI 与 PuerTS 3.0.3 本地包，用 LGUIBoot 场景启动。');
      }
      globals.__lguiDispose?.();
      api = found;
      config = options;
      const fgui = found.FairyGUI;
      if (options.defaultFont) fgui.UIConfig.defaultFont = options.defaultFont;
      // 项目字体在创建任何界面之前注册成 TMP 字体（FontManager 找不到字体时会静默换成系统字体或 Arial，所以注册不上就报错）。
      // 每个项目字体后面挂同一个系统回退字体，显示子集外的字（聊天、玩家名）；一个系统字体都没找到时只记一次 LGUI-RT-182，不抛错。
      const host = found.LGUI.Platform;
      if ((options.fonts ?? []).length) {
        if (typeof host.RegisterFont !== 'function' || typeof host.TmpSettingsFound !== 'boolean') throw new LgRuntimeError('LGUI-RT-181', `Unity 工程里的 LGUI 包是旧版（没有 LGUI.Platform.RegisterFont / TmpSettingsFound），注册不了项目字体 ${options.fonts?.join('、')}。`, '运行 lgui upgrade 把新版 Unity 包复制进工程，再 lgui unity export。');
        if (!host.TmpSettingsFound) throw new LgRuntimeError('LGUI-RT-181', `注册不了项目字体 ${options.fonts?.join('、')}：Unity 工程里没有 TextMesh Pro 的设置资源（TMP Settings），项目字体在 Unity 上是 TMP 字体，TMP 建字体要用它。`, '重新运行 lgui unity export（它会从 com.unity.ugui 自带的资源包导入 TMP Essential Resources）；或者在 Unity 里点 Window → TextMeshPro → Import TMP Essential Resources。');
      }
      for (const name of options.fonts ?? []) {
        const resource = `${options.uiBase}/fonts/${name}`;
        if (!host.RegisterFont(name, resource)) throw new LgRuntimeError('LGUI-RT-181', `项目字体 ${name} 在 Unity 的 Resources 里找不到（Resources/${resource}.ttf 或 .otf），没有导入成字体，或者 TMP 建不成字体。`, '重新运行 lgui unity export（它把 ui/fonts/ 的子集写到 Assets/LGUI/Resources/UI/fonts/），回到 Unity 等导入完成再点 Play；字体的导入设置要勾「Include Font Data」（默认就勾着）。');
      }
      const noFallback = (options.fonts ?? []).length > 0 && host.FallbackFontName === '';
      // FairyGUI-unity 的按钮、动效会自己放声音（网页版的 FairyGUI 不放）。LGUI 的声音都由框架经 platform.audio 放，所以关掉 FairyGUI 自己的。
      fgui.Stage.inst.soundVolume = 0;
      objects = createObjectAdapter(fgui, () => host.Now, (x, y) => ({x: x / scale.value, y: y / scale.value}),
        (x, y, width, height) => new found.UnityEngine.Rect(x, y, width, height), {
          wheelDeltaX: () => host.WheelDeltaX,
          hitTest(x, y) {
            // 舞台坐标 = 设计坐标 × 缩放比；没有命中控件时 FairyGUI 返回舞台自己（它不属于任何 GObject）。
            let display = fgui.Stage.inst.HitTest(new found.UnityEngine.Vector2(x * scale.value, y * scale.value), true);
            while (display && !display.gOwner) display = display.parent;
            return display?.gOwner ?? null;
          },
          buttonSound: button => host.ButtonSoundUrl(button),
          transitionSettings: transition => ({autoPlay: host.TransitionAutoPlay(transition), times: host.TransitionAutoPlayTimes(transition), delay: Math.round(host.TransitionAutoPlayDelay(transition) * 1000)}),
          gearController: (object, index) => host.GearController(object, index),
          downEffect: button => ({type: host.ButtonDownEffect(button), value: host.ButtonDownEffectValue(button)}),
          disableDownEffect: button => host.DisableButtonDownEffect(button),
          transitionItems: transition => Array.from({length: host.TransitionItemCount(transition)}, (_, i) => ({target: host.TransitionItemTarget(transition, i), type: host.TransitionItemType(transition, i)}))
        }, component => { containers.delete(component); });
      nativePlatform = createUnityPlatform({
        projectName: options.projectName, uiBase: options.uiBase, host: found.LGUI.Platform,
        fgui, objects, createLoader: () => new found.LGUI.LGUIResourceLoader(), scale
      });
      if (noFallback) {
        nativePlatform.platform.log.error('lgui_rt_182', new LgRuntimeError('LGUI-RT-182', `这台设备上没找到可以当回退的系统字体（试过：${host.FallbackFontCandidates}），项目字体里没有的字（聊天、玩家名）会显示成方框。游戏照常运行。`,
          '在 iOS、Android、电脑原生包上一般都有其中一个；微信小游戏、WebGL 读不到系统字体，要在 ui/fonts/ 里带一个常用字字体。'), {candidates: host.FallbackFontCandidates});
      }
      objects.setComponentName(fgui.GRoot.inst, 'root');
      root = objects.wrapComponent(fgui.GRoot.inst);
      frameHook = deltaMs => { objects?.clearPointerCache(); nativePlatform?.tick(deltaMs); };
      visibilityHook = visible => nativePlatform?.visibility(visible);
      disposeHook = dispose;
      globals.__lguiFrame = frameHook;
      globals.__lguiVisibility = visibilityHook;
      globals.__lguiDispose = disposeHook;
    },
    get root(): UIComponent { ready(); return root!; },
    get platform(): Platform { ready(); return nativePlatform!.platform; },
    async loadPackage(name) {
      ready();
      await nativePlatform!.platform.resource.loadPackage(name);
      loaded.add(name);
    },
    releasePackage(name) {
      ready();
      loaded.delete(name);
      nativePlatform!.platform.resource.releasePackage(name);
    },
    create<Name extends string>(packageName: string, componentName: string): UIComponent<Name> {
      const fgui = ready().FairyGUI;
      if (!fgui.UIPackage.GetByName(packageName)) throw new LgRuntimeError('LGUI-RT-002', `界面包 ${packageName} 还没加载。`, '先加载这个包（UIManager 打开界面时会自动加载）。');
      const native = fgui.UIPackage.CreateObject(packageName, componentName);
      if (!native) throw new LgRuntimeError('LGUI-RT-003', `界面包 ${packageName} 里没有组件 ${componentName}。`, '用 lgui ui list 查看组件名，并重新导出。');
      objects!.setComponentName(native, `${packageName}/${componentName}`);
      return objects!.wrapComponent(native) as UIComponent<Name>;
    },
    async setLanguage(language) {
      const cs = ready();
      if (!config!.i18nBase) return;
      const resourcePath = `${config!.i18nBase}/${language}`;
      try {
        cs.FairyGUI.UIPackage.SetStringsSource(new cs.FairyGUI.Utils.XML(cs.LGUI.Platform.LoadText(resourcePath)));
      } catch (error) {
        throw new LgRuntimeError('LGUI-RT-141', `读不了 Unity 翻译资源 ${resourcePath}：${String(error)}`, '重新导出工程，确认 Assets/LGUI/Resources/UI/i18n/ 下有这种语言的 XML。');
      }
      // 翻译写进包的组件数据，切语言必须重新读取原始包，不能重复翻译同一份已修改的数据。
      const names = [...loaded];
      for (const name of names) nativePlatform!.platform.resource.releasePackage(name);
      for (const name of names) await nativePlatform!.platform.resource.loadPackage(name);
    },
    has(packageName, componentName) {
      const pkg = ready().FairyGUI.UIPackage.GetByName(packageName);
      return pkg !== null && pkg.GetItemByName(componentName) !== null;
    },
    imageSize(url) {
      const item = ready().FairyGUI.UIPackage.GetItemByURL(url);
      return item ? {width: item.width, height: item.height} : null;
    },
    createImage(url) {
      const cs = ready();
      const loader = new cs.LGUI.LGUIResourceLoader();
      loader.url = url;
      const size = this.imageSize(url);
      if (size) loader.SetSize(size.width, size.height);
      return objects!.wrap(loader);
    },
    createContainer(name) {
      const native = new (ready().FairyGUI.GComponent)();
      native.name = name;
      objects!.setComponentName(native, '');
      const container = objects!.wrapComponent(native);
      containers.add(container);
      return container;
    }
  };
}
