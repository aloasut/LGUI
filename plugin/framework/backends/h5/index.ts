// h5 后端：FairyGUI-dom 加浏览器 API，是其他后端的基准实现。
import * as fgui from './vendor/fairygui.module.js';
import type {Backend, BackendConfig, Platform, UIComponent} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {createH5Platform} from './platform/index';
import {loadFonts} from './fonts';
import {installFairyGuiPatches} from './fairygui-patches/index';
import {setNineSliceOverlap} from './fairygui-patches/nine-slice';
import {stage} from './scale';
import {setComponentName, wrap, wrapComponent} from './objects/index';

const parseUrl = (url: string): [string, string] | null => { const m = /^ui:\/\/([^/]+)\/(.+)$/.exec(url); return m ? [m[1], m[2]] : null; };

export function createH5Backend(): Backend {
  let platform: Platform | null = null;
  let root: UIComponent | null = null;
  let i18nBase: string | undefined;
  let uiBaseUrl = '';
  const loadedPackages = new Set<string>();
  const ready = (): Platform => {
    if (!platform) throw new LgRuntimeError('LGUI-RT-027', 'h5 后端还没有启动。', '先调用 backend.init(config)。');
    return platform;
  };
  return {
    name: 'h5',
    async init(config: BackendConfig) {
      installFairyGuiPatches(); // 在创建任何 FairyGUI 对象之前
      if (config.defaultFont) fgui.UIConfig.defaultFont = config.defaultFont;
      i18nBase = config.i18nBase;
      uiBaseUrl = config.uiBase;
      await Promise.all([fgui.UIPackage.loadImageManifest(`${config.uiBase}/manifest.json`), loadFonts(config.uiBase, config.fonts ?? [])]);
      platform = createH5Platform(config.projectName, config.uiBase);
      // 九宫格的块要互相重叠 1 个设备像素（补丁 12）：根节点缩放变了就更新重叠宽度
      const screen = platform.screen;
      const applyDesignSize = screen.applyDesignSize.bind(screen);
      screen.applyDesignSize = design => { const visible = applyDesignSize(design); setNineSliceOverlap(stage.scale * devicePixelRatio); return visible; };
      setComponentName(fgui.GRoot.inst, 'root');
      root = wrapComponent(fgui.GRoot.inst);
    },
    get root(): UIComponent {
      if (!root) throw new LgRuntimeError('LGUI-RT-027', 'h5 后端还没有启动。', '先调用 backend.init(config)。');
      return root;
    },
    loadPackage: async name => { await ready().resource.loadPackage(name); loadedPackages.add(name); },
    releasePackage: name => { loadedPackages.delete(name); ready().resource.releasePackage(name); },
    create<Name extends string>(packageName: string, componentName: string): UIComponent<Name> {
      ready();
      if (!fgui.UIPackage.getByName(packageName)) throw new LgRuntimeError('LGUI-RT-002', `界面包 ${packageName} 还没加载。`, '先加载这个包（UIManager 打开界面时会自动加载）。');
      const native = fgui.UIPackage.createObject(packageName, componentName);
      if (!native) throw new LgRuntimeError('LGUI-RT-003', `界面包 ${packageName} 里没有组件 ${componentName}。`, '用 lgui ui list 查看有哪些组件。');
      setComponentName(native, `${packageName}/${componentName}`);
      return wrapComponent(native) as UIComponent<Name>;
    },
    async setLanguage(language: string): Promise<void> {
      if (!i18nBase) throw new LgRuntimeError('LGUI-RT-173', `没配 i18nBase，换不了界面上固定文字的语言（${language}）。`, 'backend.init 时传 i18nBase（lgui dev 生成的启动入口传的是 ./i18n）。');
      const url = `${i18nBase}/${language}.xml`;
      const response = await fetch(url);
      if (!response.ok) throw new LgRuntimeError('LGUI-RT-141', `读不到翻译文件 ${url}（HTTP ${response.status}）。`, '确认工程配置 languages 里有这种语言，并重新运行 lgui dev 生成翻译文件。');
      fgui.TranslationHelper.loadFromXML(new fgui.XML(await response.text()));
      // FairyGUI 的翻译只在组件第一次创建时写进包数据，所以已经加载的包要卸载、重新加载。
      const loaded = [...loadedPackages];
      for (const name of loaded) if (fgui.UIPackage.getByName(name)) fgui.UIPackage.removePackage(name);
      for (const name of loaded) await fgui.UIPackage.loadPackage(`${uiBaseUrl}/${name}`);
    },
    has(packageName: string, componentName: string): boolean {
      const pkg = fgui.UIPackage.getByName(packageName);
      return pkg !== undefined && pkg.getItemByName(componentName) !== undefined;
    },
    imageSize(url: string) {
      const parts = parseUrl(url);
      const item = parts ? fgui.UIPackage.getByName(parts[0])?.getItemByName(parts[1]) : undefined;
      return item ? {width: item.width, height: item.height} : null;
    },
    createImage(url: string) {
      const loader = new fgui.GLoader();
      loader.url = url;
      const size = this.imageSize(url);
      if (size) loader.setSize(size.width, size.height);
      return wrap(loader);
    },
    createContainer(name: string): UIComponent {
      const native = new fgui.GComponent();
      native.name = name;
      setComponentName(native, '');
      return wrapComponent(native);
    },
    get platform(): Platform { return ready(); }
  };
}
