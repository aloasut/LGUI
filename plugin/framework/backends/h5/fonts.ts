// 项目字体（ui/fonts/<名字>.ttf|.otf，生成时做成子集 <uiBase>/fonts/<名字>.woff2）：启动时、创建任何界面之前用 FontFace 加载好。
// FairyGUI 把 font 原样写成 CSS 的 font-family，字体名就是 FontFace 的 family。必须先加载完：
// autoSize="shrink" 的文字（补丁 8）按字体量宽并缓存，字体没到就量会量成回退字体的宽度。
// 子集外的字（运行时才知道的玩家名、服务器数据）由浏览器按字回退到系统字体。
import {LgRuntimeError} from '../../core/index';

const loadError = (name: string, url: string, reason: string) => new LgRuntimeError('LGUI-RT-180', `项目字体 ${name} 加载失败（${url}）：${reason}`,
  '确认 ui/fonts/ 里有这个字体，重新运行生成它的命令（lgui dev、verify、test --browser）；部署网页时 ui/fonts/ 要和 ui/ 的界面包一起发布。');

async function loadFont(uiBase: string, name: string): Promise<void> {
  const url = `${uiBase}/fonts/${name}.woff2`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw loadError(name, url, `请求失败：${(error as Error).message}`);
  }
  if (!response.ok) throw loadError(name, url, `HTTP ${response.status}`);
  const face = new FontFace(name, await response.arrayBuffer());
  try {
    await face.load();
  } catch (error) {
    throw loadError(name, url, `浏览器解不开这个字体文件：${(error as Error).message}`);
  }
  document.fonts.add(face);
}

/** 并行加载全部项目字体；有一个失败就报 LGUI-RT-180。 */
export async function loadFonts(uiBase: string, names: readonly string[]): Promise<void> {
  if (!names.length) return;
  if (typeof FontFace === 'undefined' || !document.fonts) throw loadError(names.join('、'), `${uiBase}/fonts/`, '这个浏览器没有 FontFace');
  await Promise.all(names.map(name => loadFont(uiBase, name)));
}
