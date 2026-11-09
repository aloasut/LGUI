// 测试用：把框架、headless 后端和模拟操作打包成一个模块；用 fixture 界面建好 headless 后端并设置运行时。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importTs} from './ts.mjs';
import {writeFixture} from './fixture.mjs';
import {generateProjectTypes} from '../../plugin/tools/lib/generate/index.mjs';

const framework = fileURLToPath(new URL('../../plugin/framework', import.meta.url));
const cached = {};

// production：按正式构建打包（LGUI_DEV 定义成 false）；默认和 lgui dev、lgui test 一样是开发模式。
export async function loadFramework({production = false} = {}) {
  const mode = production ? 'production' : 'development';
  if (cached[mode]) return cached[mode];
  const entry = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lgui-fw-')), 'entry.ts');
  const f = rel => JSON.stringify(path.join(framework, rel));
  fs.writeFileSync(entry, [
    `export * from ${f('index.ts')};`,
    `export {createHeadlessBackend} from ${f('backends/headless/index.ts')};`,
    `export * as sim from ${f('backends/headless/simulate.ts')};`,
    `export {setRuntime, clearRuntime, defaultConfig} from ${f('mvc/runtime.ts')};`,
    `export {bus} from ${f('mvc/events.ts')};`,
    `export {recognize, thresholds} from ${f('mvc/input/gestures.ts')};`,
    `export {actionForKey, keysForAction} from ${f('mvc/input/keys.ts')};`,
    `export {validateViewClass} from ${f('mvc/view.ts')};`,
    `export {inputType} from ${f('mvc/input/input-type.ts')};`,
    `export {listenerCount} from ${f('mvc/model.ts')};`,
    `export {HeadlessLoader} from ${f('backends/headless/objects.ts')};`,
    `export {boot} from ${f('mvc/boot.ts')};`,
    `export {setTexts, pickLanguage} from ${f('mvc/i18n.ts')};`,
    `export {clearRedDots} from ${f('mvc/red-dot.ts')};`,
    `export {devMode} from ${f('mvc/log.ts')};`,
    `export {MUSIC_FADE_MS} from ${f('mvc/sound.ts')};`
  ].join('\n'));
  cached[mode] = await importTs(entry, {define: production ? {LGUI_DEV: 'false'} : {}});
  return cached[mode];
}

/** 框架自己用到的文本键（lgui init 的文本表里都有）。 */
export const frameworkTexts = {'lgui.back': '返回', 'lgui.requestFailed': '请求失败（{code}）', 'lgui.time.day': '{n}天', 'lgui.time.hour': '{n}小时', 'lgui.time.minute': '{n}分', 'lgui.time.second': '{n}秒'};

// 用 fixture（或给定工程根目录）的 headless 描述建一个后端，并设成当前运行时。
export async function headless({root = writeFixture(), config = {}, production = false} = {}) {
  const fw = await loadFramework({production});
  await generateProjectTypes(root);
  const dir = path.join(root, '.lgui/build/headless');
  const packages = fs.readdirSync(dir).map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  const backend = fw.createHeadlessBackend(packages);
  await backend.init({projectName: 'test', defaultFont: null, uiBase: ''});
  const deps = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/deps.json'), 'utf8'));
  fw.setRuntime(backend, {...fw.defaultConfig, ...config}, 1_700_000_000_000, deps);
  return {fw, backend, root, deps};
}

// 再加上 UIManager（不调用 app.start）。文本表默认只有框架自己的键；app 可以带 platform（换日志、声音）。
export async function started(options = {}) {
  const ctx = await headless(options);
  const texts = options.texts ?? {'zh-CN': {...frameworkTexts}};
  const app = {backend: 'headless', start() {}, ...(options.app ?? {})};
  const ui = await ctx.fw.boot(ctx.backend, app, {...ctx.fw.defaultConfig, ...(options.config ?? {})}, ctx.deps, {wallBase: 1_700_000_000_000, texts, language: options.language});
  return {...ctx, ui, sim: ctx.fw.sim};
}
