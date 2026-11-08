// example 独立工程入口（决策 004）：cocos 后端 + examples/inventory 的完整 MVC 链。
// app-src 与 config/deps/texts 都由 sync.mjs 灌入；main.ts 的 lgui.app() 只是标记，
// h5 后端是 dev bundle 建的——这里换成 cocos 后端直连 mvc/boot（同 testbed Boot 的模式）。
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
  const visible = backend.platform.screen.applyDesignSize(config.designSize.landscape);
  console.info('[lgui-example]', JSON.stringify({step: 'init', design: config.designSize.landscape, visible}));

  await boot(backend, {...app, backend: 'cocos'}, config, deps, {texts});
  // 无头验收用：页面侧句柄（lgui.debug.snapshot / lgui.ui.open 都可从验收脚本驱动）。
  (globalThis as unknown as Record<string, unknown>).__lgui = lgui;
  console.info('[lgui-example]', JSON.stringify({step: 'booted', snapshot: JSON.stringify(lgui.debug.snapshot()).slice(0, 400)}));
}

// 第一个场景加载完自动启动。只在预览/构建里跑——编辑器 Scene 进程里 bundle 与场景时序都不可靠（EDITOR 守卫跳过）。
// 失败只进控制台，不 rethrow——rethrow 会在预览里弹全屏 Error 遮罩，把页面锁死。
if (!EDITOR) director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
  void main().catch(error => console.error('[lgui-example] 失败：', error));
});
