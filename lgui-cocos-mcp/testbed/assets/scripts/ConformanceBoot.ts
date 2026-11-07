// T008 一致性桥：预览页带 ?conf=<用例名> 时进入 conformance 模式（普通冒烟跳过）。
// cocos 端 = 真引擎控件 + headless 同款 simulate 语义的输入位（输入操作在 T008d 接，当前只支持无输入用例）。
// Node 侧 runner：__confCases 列用例、__confRun(name) 返回与 headless 同格式的快照。
import {director, Director} from 'cc';
import {EDITOR} from 'cc/env';
import {lgui} from '../lgui-framework/index';
import {createCocosBackend} from '../lgui-framework/backends/cocos/index';
import {capture} from '../conf-src/conformance/harness';
import layout from '../conf-src/conformance/layout';
import app from '../conf-src/src/main';
import {cases} from './conf-cases';
import {conf} from './conf-config';

if (!EDITOR && new URL(location.href).searchParams.get('conf')) {
  const backend = createCocosBackend();
  const init = backend.init.bind(backend);
  backend.init = async options => {
    await init({...options, uiBase: 'conf-ui', i18nBase: 'i18n', defaultFont: conf.defaultFont});
    return backend;
  };
  const noInput = (): never => { throw new Error('cocos 一致性测试的输入操作在 T008d 接（当前只支持无输入用例）。'); };
  (globalThis as unknown as {__lguiTest: unknown}).__lguiTest = {
    createBackend: () => backend,
    sim: new Proxy({}, {get: () => noInput}),
    deps: conf.deps,
    config: conf,
    texts: conf.texts,
    current: null
  };
  (globalThis as unknown as {__confCases: string[]}).__confCases = Object.keys(cases);
  (globalThis as unknown as {__confRun: (name: string) => Promise<unknown>}).__confRun = async name => {
    // 场景 launch 完才允许跑（init 要挂 Canvas）；Node 侧可能在场景起来前就调进来。
    if (!director.getScene()?.launched) await new Promise<void>(r => director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => r()));
    const c = cases[name];
    if (!c) throw new Error(`没有用例 ${name}（有：${Object.keys(cases).join('、')}）`);
    const t = await lgui.testing.start(app, {});
    const result = capture(t, layout, await c.run(t));
    t.end();
    return result;
  };
  console.log('[lgui-conf] 就绪，用例：', Object.keys(cases).join('、'));
}
