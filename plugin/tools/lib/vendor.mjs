// 加载随插件带的工具（plugin/tools/vendor/）。esbuild 和 sharp 会按当前平台自己挑对应的原生包。
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {LgCliError} from './errors.mjs';

const require = createRequire(new URL('../vendor/package.json', import.meta.url));

// 带了原生文件的 4 个平台。
export const supportedPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

// 当前平台的名字，Linux 上区分 glibc 和 musl。
export function currentPlatform() {
  const name = `${process.platform}-${process.arch}`;
  if (process.platform !== 'linux') return name;
  const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
  return glibc ? name : `${name}-musl`;
}

// 当前平台不在支持范围内时报 LGUI-CLI-005。
export function assertSupportedPlatform(platform = currentPlatform()) {
  if (!supportedPlatforms.includes(platform)) {
    throw new LgCliError('LGUI-CLI-005', `当前平台 ${platform} 不受支持：随插件带的 esbuild 和 sharp 只有 ${supportedPlatforms.join('、')} 这 4 个平台的版本。`, {
      fix: '换到 macOS（arm64 或 x64）、Linux x64（glibc）或 Windows x64 上运行。'
    });
  }
}

function load(name) {
  assertSupportedPlatform();
  return require(name);
}

export const typescript = () => load('typescript');
export const esbuild = () => load('esbuild');
export const sharp = () => load('sharp');
export const playwright = () => load('playwright-core');
// OpenFairyGUI：core 读写工程，functions/node 校验和生成界面包。
export const openFairyGUI = () => ({core: load('@openfairygui/core'), coreNode: load('@openfairygui/core/node'), functions: load('@openfairygui/functions/node')});
// 字体子集：harfbuzz-subset.wasm（随 harfbuzzjs 带）做子集；wawoff2 压 WOFF2。都是 WASM，不分平台。
// harfbuzzjs 本身（ESM，带顶层 await，只能 import）只给测试和 scripts/ 读回字体用：它的对象靠垃圾回收释放，命令里不用。
export const harfbuzz = () => import(pathToFileURL(require.resolve('harfbuzzjs')).href);
export const harfbuzzSubsetWasm = () => require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
export const woff2 = () => require('wawoff2/compress.js');
