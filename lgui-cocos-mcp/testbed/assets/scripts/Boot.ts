// M1 冒烟：桥接（init/加载包/创建控件/设计尺寸）+ 真 View 五层栈（boot/lgui.ui）+ 换语言。
// 换版 swap 由预览视口 resize 触发（smoke.mjs 里 setViewportSize）。config/deps/components 由 sync.mjs 生成。
import {Component, _decorator, director, Director} from 'cc';
import {EDITOR} from 'cc/env';
import {lgui} from '../lgui-framework/index';
import {boot} from '../lgui-framework/mvc/boot';
import {createCocosBackend} from '../lgui-framework/backends/cocos/index';
import {config, deps, components, texts} from './lgui-config';
import {MainView, ConfirmView} from './TestbedViews';

const {ccclass} = _decorator;

export async function smoke(): Promise<void> {
  const backend = createCocosBackend();
  await backend.init({projectName: config.name, defaultFont: config.defaultFont, uiBase: 'lgui-ui', i18nBase: 'i18n'});
  const log = backend.platform.log;
  const visible = backend.platform.screen.applyDesignSize(config.designSize.landscape);
  log.info('lgui_smoke', () => ({step: 'init', design: config.designSize.landscape, visible}));

  await backend.loadPackage('Common');
  const name = (components.Common ?? []).find(item => !item.endsWith('@portrait'));
  if (!name) throw new Error('Common 包里没有横版组件：先跑 sync.mjs');
  const layer = backend.createContainer('page');
  backend.root.addChild(layer);
  const component = backend.create('Common', name);
  layer.addChild(component);
  log.info('lgui_smoke', () => ({step: 'create', component: `Common/${name}`, deps: Object.keys(deps)}));

  // 真 View：五层栈 + 换版 + 换语言（换版由预览视口 resize 触发，见 smoke.mjs）
  await boot(backend, {backend: 'cocos', async start() {}}, config, deps, {views: {MainView, ConfirmView}, texts});
  await lgui.ui.open(MainView);
  log.info('lgui_smoke', () => ({step: 'view-open', view: 'MainView'}));
  await lgui.ui.open(ConfirmView);
  log.info('lgui_smoke', () => ({step: 'modal-open', view: 'ConfirmView'}));
  const other = config.languages.find(language => language !== config.defaultLanguage) ?? 'en';
  await lgui.setLanguage(other);
  log.info('lgui_smoke', () => ({step: 'language', language: other}));
  log.info('lgui_smoke', () => ({step: 'done', snapshot: JSON.stringify(lgui.debug.snapshot()).slice(0, 160)}));

  // 换版实测：预览视口 resize（smoke.mjs 切竖屏/横屏）触发 versionOf/swap，快照里看组件版本与 View 保留。
  backend.platform.screen.onResize(size => log.info('lgui_smoke_resize', () => ({size, snapshot: JSON.stringify(lgui.debug.snapshot()).slice(0, 240)})));
}

// 不依赖场景挂件：第一个场景加载完自动跑冒烟。只在预览/构建里跑——
// 编辑器 Scene 进程里 bundle 与场景时序都不可靠（用户重开工程时的报错即此），EDITOR 守卫跳过。
if (!EDITOR && !new URL(location.href).searchParams.get('conf')) director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
  // 失败只进控制台，不 rethrow——rethrow 会在预览里弹全屏 Error 遮罩，把页面锁死。
  void smoke().catch(error => console.error('[lgui-smoke] 失败：', error));
});

@ccclass('LGUIBoot')
export class LGUIBoot extends Component {
  override start(): void { void smoke().catch(error => console.error('[lgui-smoke] 失败：', error)); }
}
