// cocos 后端：fairygui-cc 加 Cocos Creator 引擎 API。从 h5 后端移植（它是基准实现）；差异点都在注释里。
// 只能在 Cocos Creator 工程里运行（fairygui.mjs import 'cc'）；M1 目标是 Web。
import {assetManager, Camera, Canvas, director, Layers, Node, TextAsset} from 'cc';
import * as fgui from 'fairygui-cc';
import type {Backend, BackendConfig, Platform, UIComponent, UIObject} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {createCocosPlatform, bundleReady} from './platform/index';
import {setComponentName, wrap, wrapComponent} from './objects/index';
import {installFindParentGuard} from './patches';

const parseUrl = (url: string): [string, string] | null => { const m = /^ui:\/\/([^/]+)\/(.+)$/.exec(url); return m ? [m[1], m[2]] : null; };

export function createCocosBackend(): Backend {
  let platform: Platform | null = null;
  let root: UIComponent | null = null;
  let uiBase: string | undefined;
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
      installFindParentGuard();
      if (config.defaultFont) fgui.UIConfig.defaultFont = config.defaultFont;
      uiBase = config.uiBase;
      i18nBase = config.i18nBase;
      // 挂载：复刻运行库 GRoot.create() 的三步（_inst 赋值 + 挂到 Canvas + onWinResize），但不认名字——
      // 优先用场景里现成的 Canvas（直接子节点名为 Canvas → 任何挂了 cc.Canvas 的节点），都没有就自动建一套（Canvas + 正交相机）。
      const scene = director.getScene();
      if (!scene) throw new LgRuntimeError('LGUI-RT-028', '界面根节点挂不上去：场景还没就绪。', '在场景加载完成后再调用 lgui.app()。');
      let canvas = scene.getChildByName('Canvas') ?? scene.getComponentsInChildren(Canvas)[0]?.node ?? null;
      if (canvas) {
        // 复用现成 Canvas：其 UI 相机（visibility 含 UI_2D、DEPTH_ONLY 清屏）必须最后画——
        // priority 抬到 1073741824（example 场景的配置值），否则场景相机同 priority 时顺序不定，
        // 清屏的 3D 相机后画会把 LGUI 界面盖成黑屏（T011 Creator 预览实测）。
        for (const child of canvas.children) {
          const camera = child.getComponent(Camera);
          if (camera) camera.priority = 1073741824;
        }
      }
      if (!canvas) {
        canvas = new Node('Canvas');
        scene.addChild(canvas);
        canvas.addComponent(Canvas);
        const camNode = new Node('Camera');
        canvas.addChild(camNode);
        const cam = camNode.addComponent(Camera);
        // 枚举从运行时构造器取并兜底（ORTHO=0、SOLID_COLOR=7，cc 3.8 引擎源码确认）：预览编译链（SystemJS）下
        // `Camera.Projection` 静态命名空间可能是 undefined、构建链正常——类的静态嵌套枚举跨编译链不稳定（T011 Creator 预览实测）。
        const camCtor = cam.constructor as unknown as {Projection?: {ORTHO: number}; ClearFlag?: {SOLID_COLOR: number}};
        cam.projection = camCtor.Projection?.ORTHO ?? 0;
        cam.clearFlags = camCtor.ClearFlag?.SOLID_COLOR ?? 7;
        // Layers.Enum.UI_2D 同类静态链兜底（1 << 25 = 33554432，cc 引擎 Layers 定义）。
        const layersEnum = (Layers as unknown as {Enum?: {UI_2D?: number}}).Enum;
        cam.visibility = layersEnum?.UI_2D ?? 33554432;
        cam.orthoHeight = 540; // 半屏高默认值；对齐由 onWinResize/Canvas 组件接管
      }
      const nativeRoot = new fgui.GRoot();
      (fgui.GRoot as unknown as {_inst: fgui.GRoot})._inst = nativeRoot;
      canvas.addChild(nativeRoot.node);
      // vanilla 挂载：GRoot 本体保持世界尺寸、scale 1（onWinResize 按 rootSize 设置）。运行库的坐标换算
      // （updateInfo 按 rootSize 翻 y、GRoot.hitTest→globalToLocal 按 GRoot.height 翻回）都按这个约定——
      // 本体若被缩放（设计尺寸 + setScale），命中测试的两次翻转单位不一致，全部点击都会打偏（T008 校准发现）。
      nativeRoot.onWinResize();
      if (!nativeRoot.node.parent) {
        const scene = director.getScene();
        if (!scene) throw new LgRuntimeError('LGUI-RT-028', '界面根节点挂不上去：场景还没就绪。', '在场景加载完成后再调用 lgui.app()。');
        scene.addChild(nativeRoot.node);
      }
      // 设计缩放由内层 stage 容器承担（setScale + 设计尺寸的 setSize），视图都挂它里面；backend.root 就是它。
      const stageRoot = new fgui.GComponent();
      nativeRoot.addChild(stageRoot);
      platform = createCocosPlatform(config.projectName, config.uiBase, stageRoot);
      setComponentName(stageRoot, 'root');
      root = wrapComponent(stageRoot);
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
      // 翻译文件在界面包 bundle 里（assets/<uiBase>/i18n/<语言>.xml）；CC 的 bundle 资源 fetch 不到，用 bundle.load 读 TextAsset。
      // i18nBase 是 bundle 里的目录名（init 传 i18nBase: 'i18n'），不是 bundle 名——bundle 名跟包加载走同一个 uiBase。
      const uiBundle = await bundleReady(uiBase || 'lgui-ui');
      const xml = await new Promise<string>((resolve, reject) => uiBundle.load(`${i18nBase}/${language}`, TextAsset, (error, asset) => {
        if (error || !asset) reject(new LgRuntimeError('LGUI-RT-141', `读不到翻译文件 ${i18nBase}/${language}（bundle 里没有）。`, '确认工程配置 languages 里有这种语言，并重新运行包同步生成翻译文件。'));
        else resolve((asset as TextAsset).text);
      }));
      // 官方运行库的 loadFromXML 直接收 XML 字符串（内部 DOMParser），不像 dom 版要 new XML。
      fgui.TranslationHelper.loadFromXML(xml);
      // FairyGUI 的翻译只在组件第一次创建时写进包数据，所以已经加载的包要卸载、重新加载（同 h5）。
      // CC 的 babel loose 模式把 [...set] 编译成 [set]（整个 Set 成为一个元素）——框架里可迭代展开一律用 Array.from（T007 校准结论）。
      const loaded = Array.from(loadedPackages);
      // 卸载换翻译：CC 的 assetManager.releaseAsset 是**强制释放**（ReleaseManager.tryRelease(asset, force=true)
      // 跳过引用检查、无条件 destroy），UIPackage.dispose 会把打开中的组件还引用着的纹理当场销毁——
      // 而调用方的 rebuild 在 swap 之后才跑，这中间的渲染帧拿到已释放的帧直接崩
      // （gpuDescriptors null / MovieClip frame released，example 独立工程 2026-11-08 实测；引用计数挡不住 force）。
      // 所以卸载前把包的 _items 偷走（dispose 空转、一个资源都不放），资源暂扣到 rebuild 完成——
      // rebuild 在 swap 返回后的同一微任务链里同步执行，两帧后旧组件已全部释放，再统一强制释放。
      const stale: {asset: unknown}[] = [];
      for (const name of loaded) {
        const pkg = fgui.UIPackage.getByName(name) as unknown as {_items: {asset: unknown}[] | null} | undefined;
        if (!pkg?._items) continue;
        for (const item of pkg._items) if (item.asset) stale.push(item);
        pkg._items = [];
      }
      for (const name of loaded) if (fgui.UIPackage.getByName(name)) fgui.UIPackage.removePackage(name);
      for (const name of loaded) await ready().resource.loadPackage(name);
      if (stale.length) {
        let frames = 0;
        const off = platform!.time.onFrame(() => {
          if (++frames < 2) return;
          off();
          for (const item of stale) {
            const asset = item.asset as Parameters<typeof assetManager.releaseAsset>[0];
            item.asset = null;
            assetManager.releaseAsset(asset);
          }
        });
      }
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
