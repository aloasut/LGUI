// cocos 后端：fairygui-cc 加 Cocos Creator 引擎 API。从 h5 后端移植（它是基准实现）；差异点都在注释里。
// 只能在 Cocos Creator 工程里运行（fairygui.mjs import 'cc'）；M1 目标是 Web。
import {Camera, Canvas, director, Layers, Node, TextAsset} from 'cc';
import * as fgui from 'fairygui-cc';
import type {Backend, BackendConfig, Platform, UIComponent, UIObject} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {createCocosPlatform, bundleReady} from './platform/index';
import {setComponentName, wrap, wrapComponent} from './objects/index';

const parseUrl = (url: string): [string, string] | null => { const m = /^ui:\/\/([^/]+)\/(.+)$/.exec(url); return m ? [m[1], m[2]] : null; };

export function createCocosBackend(): Backend {
  let platform: Platform | null = null;
  let root: UIComponent | null = null;
  let i18nBase: string | undefined;
  const loadedPackages = new Set<string>();
  const ready = (): Platform => {
    if (!platform) throw new LgRuntimeError('LGUI-RT-027', 'cocos 后端还没有启动。', '先调用 backend.init(config)。');
    return platform;
  };
  return {
    name: 'cocos',
    async init(config: BackendConfig) {
      if (platform) return; // 幂等：编辑器/预览/一致性桥可能多次调 init，二次调用直接返回
      if (config.defaultFont) fgui.UIConfig.defaultFont = config.defaultFont;
      i18nBase = config.i18nBase;
      // 挂载：复刻运行库 GRoot.create() 的三步（_inst 赋值 + 挂到 Canvas + onWinResize），但不认名字——
      // 优先用场景里现成的 Canvas（直接子节点名为 Canvas → 任何挂了 cc.Canvas 的节点），都没有就自动建一套（Canvas + 正交相机）。
      const scene = director.getScene();
      if (!scene) throw new LgRuntimeError('LGUI-RT-028', '界面根节点挂不上去：场景还没就绪。', '在场景加载完成后再调用 lgui.app()。');
      let canvas = scene.getChildByName('Canvas') ?? scene.getComponentsInChildren(Canvas)[0]?.node ?? null;
      if (!canvas) {
        canvas = new Node('Canvas');
        scene.addChild(canvas);
        canvas.addComponent(Canvas);
        const camNode = new Node('Camera');
        canvas.addChild(camNode);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.Projection.ORTHO;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        cam.visibility = Layers.Enum.UI_2D;
        cam.orthoHeight = 540; // 半屏高默认值；对齐由 onWinResize/Canvas 组件接管
      }
      const nativeRoot = new fgui.GRoot();
      (fgui.GRoot as unknown as {_inst: fgui.GRoot})._inst = nativeRoot;
      canvas.addChild(nativeRoot.node);
      nativeRoot.onWinResize();
      if (!nativeRoot.node.parent) {
        const scene = director.getScene();
        if (!scene) throw new LgRuntimeError('LGUI-RT-028', '界面根节点挂不上去：场景还没就绪。', '在场景加载完成后再调用 lgui.app()。');
        scene.addChild(nativeRoot.node);
      }
      platform = createCocosPlatform(config.projectName, config.uiBase);
      setComponentName(nativeRoot, 'root');
      root = wrapComponent(nativeRoot);
    },
    get root(): UIComponent {
      if (!root) throw new LgRuntimeError('LGUI-RT-027', 'cocos 后端还没有启动。', '先调用 backend.init(config)。');
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
      if (!i18nBase) throw new LgRuntimeError('LGUI-RT-173', `没配 i18nBase，换不了界面上固定文字的语言（${language}）。`, 'backend.init 时传 i18nBase（包同步生成的翻译目录，比如 i18n）。');
      // 翻译文件在 lgui-ui bundle 里（assets/lgui-ui/i18n/<语言>.xml）；CC 的 bundle 资源 fetch 不到，用 bundle.load 读 TextAsset。
      const uiBundle = await bundleReady(i18nBase || 'lgui-ui');
      const xml = await new Promise<string>((resolve, reject) => uiBundle.load(`${i18nBase}/${language}`, TextAsset, (error, asset) => {
        if (error || !asset) reject(new LgRuntimeError('LGUI-RT-141', `读不到翻译文件 ${i18nBase}/${language}（bundle 里没有）。`, '确认工程配置 languages 里有这种语言，并重新运行包同步生成翻译文件。'));
        else resolve((asset as TextAsset).text);
      }));
      // 官方运行库的 loadFromXML 直接收 XML 字符串（内部 DOMParser），不像 dom 版要 new XML。
      fgui.TranslationHelper.loadFromXML(xml);
      // FairyGUI 的翻译只在组件第一次创建时写进包数据，所以已经加载的包要卸载、重新加载（同 h5）。
      // CC 的 babel loose 模式把 [...set] 编译成 [set]（整个 Set 成为一个元素）——框架里可迭代展开一律用 Array.from（T007 校准结论）。
      const loaded = Array.from(loadedPackages);
      for (const name of loaded) if (fgui.UIPackage.getByName(name)) fgui.UIPackage.removePackage(name);
      for (const name of loaded) await ready().resource.loadPackage(name);
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
