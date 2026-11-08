// 由 lgui cocos export 生成，不要手改。启动配置在同目录 lgui-config.ts，界面源码在 assets/app-src/。
// 第一个场景加载完自动启动（不依赖场景挂组件）。只在预览/构建里跑——编辑器 Scene 进程里
// bundle 与场景时序都不可靠（EDITOR 守卫跳过）；失败只进控制台，不 rethrow（避免预览弹全屏错误遮罩）。
import {director, Director} from 'cc';
import {EDITOR} from 'cc/env';
import {lgui} from '../lgui-framework/index';
import {boot} from '../lgui-framework/mvc/boot';
import {createCocosBackend} from '../lgui-framework/backends/cocos/index';
import {config, deps, texts} from './lgui-config';
import app from '../app-src/main';

async function main(): Promise<void> {
  const backend = createCocosBackend();
  await backend.init({projectName: config.name, defaultFont: config.defaultFont, uiBase: 'lgui-ui', i18nBase: 'i18n'});
  // 设计适配：按当前窗口横竖取设计尺寸，并跟 resize 重贴（引擎设计分辨率跟窗口的约定见 backends/cocos/platform）。
  const pick = (): {width: number; height: number} => (window.innerHeight > window.innerWidth ? config.designSize.portrait : config.designSize.landscape);
  const fit = (): void => backend.platform.screen.applyDesignSize(pick());
  fit();
  backend.platform.screen.onResize(fit);

  await boot(backend, {...app, backend: 'cocos'}, config, deps, {texts});
  // 无头验收/调试用：页面侧句柄（lgui.debug.snapshot、lgui.ui.open 都可从控制台驱动）。
  (globalThis as unknown as Record<string, unknown>).__lgui = lgui;
}

if (!EDITOR) director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
  void main().catch(error => console.error('[lgui] 启动失败：', error));
});
