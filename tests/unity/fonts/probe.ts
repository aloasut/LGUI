// Unity 项目字体（TMP）的原生验收：在真 Unity 里跑适配层、FairyGUI 的 TMPFont 和 TMP。不是画面验收，截图另看。
// 由 prepare.mjs 打包成 Assets/LGUI/Resources/Game/game.js.txt；字体样本放在 Assets/LGUI/Resources/UI/fonts/Noto.otf（lgui unity export 写的位置）。
import {createUnityBackend} from '../../../plugin/framework/backends/unity/adapter/index';

declare const CS: {
  FairyGUI: {GTextField: new () => unknown; GRoot: {inst: {AddChild(child: unknown): void}}};
  LGUI: {
    Platform: {FallbackFontName: string; FallbackFontCandidates: string};
    Tests: {
      ConformanceBridge: {Complete(result: string): void};
      FontProbeMetrics: {RegisteredFont(name: string): string; DrawnWith(field: unknown): string; Atlas(font: string): string; Draw(field: unknown, text: string, bold: boolean): string};
    };
  };
};

// 样本里有的字（tests/fixtures/fonts/README.md）；「齉」样本里没有，要由系统回退字体出。
// 每个字只在一段里第一次出现，量的是它第一次画进图集的那次；粗体用另外的字，粗体也是冷的。
const IN_FONT = '开始游戏设置背包商店';
const NOT_IN_FONT = '齉';
const EN = 'Start';
const BOLD_ZH = '我们的家';
const BOLD_EN = 'BOLD';

const globals = globalThis as unknown as {__lguiStart?: () => Promise<void>};
globals.__lguiStart = async () => {
  const report: Record<string, unknown> = {probe: 'Unity TMP project fonts'};
  const metrics = CS.LGUI.Tests.FontProbeMetrics;
  try {
    // 1. 项目字体找不到：报 LGUI-RT-181（先跑：它在注册任何字体之前就停下）
    try {
      await createUnityBackend().init({projectName: 'font-probe', defaultFont: null, fonts: ['Missing'], uiBase: 'UI'});
      report.missing = {rejected: false};
    } catch (error) {
      const e = error as {code?: string; message?: string};
      report.missing = {rejected: true, code: e.code, message: e.message};
    }
    // 2. 注册成 TMP 字体，defaultFont 按名字找得到
    const backend = createUnityBackend();
    await backend.init({projectName: 'font-probe', defaultFont: 'Noto', fonts: ['Noto'], uiBase: 'UI'});
    report.registered = metrics.RegisteredFont('Noto');
    report.atlas = metrics.Atlas('Noto');
    report.fallbackName = CS.LGUI.Platform.FallbackFontName;
    report.fallbackCandidates = CS.LGUI.Platform.FallbackFontCandidates;
    // 3. 没写 font 的文字（用 defaultFont）走 FairyGUI 默认路径排版、建网格：量字宽、顶点数、顶点用的是哪个字体的图集。
    //    不另外向 TMP 查字：那会从别的路径把字加进图集，掩盖默认路径排不出字（0.4.1 及以前的探针就是这样漏掉的）。
    const field = new CS.FairyGUI.GTextField();
    CS.FairyGUI.GRoot.inst.AddChild(field);
    const draw = (text: string, bold: boolean) => {
      const [width, vertices, ms, fonts] = metrics.Draw(field, text, bold).split(',');
      return {text, bold, width: Number(width), vertices: Number(vertices), ms: Number(ms), fonts: fonts ? fonts.split('+') : []};
    };
    report.draws = {
      first: draw(IN_FONT + NOT_IN_FONT, false),   // 第一次排版：字现画进图集
      second: draw(NOT_IN_FONT + IN_FONT, false),  // 同样的字再排一次：已在图集里
      inFont: draw(IN_FONT, false),                // 4. 项目字体里有的字只用项目字体的图集
      notInFont: draw(NOT_IN_FONT, false),         //    项目字体里没有的字只用系统回退字体的图集
      en: draw(EN, false),
      boldZh: draw(BOLD_ZH + NOT_IN_FONT, true),   // 粗体（含回退字体出的字）
      boldEn: draw(BOLD_EN, true),
    };
    report.drawnWith = metrics.DrawnWith(field);
  } catch (error) { report.fatal = String((error as Error)?.stack ?? error); }
  CS.LGUI.Tests.ConformanceBridge.Complete(JSON.stringify(report));
};
