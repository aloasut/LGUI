// PuerTS 暴露的 LGUI C# 服务；这里只描述本适配器实际调用的原生 API。
import type {NativeButton, NativeComponent, NativeDisplayObject, NativeEventContext, NativeFairyGUI, NativeLoader, NativeObject, NativeTransition} from './native-ui';
import type {PointerInput} from '../../../core/index';

export interface NativePlatformHost {
  readonly Now: number;
  readonly ScreenWidth: number;
  readonly ScreenHeight: number;
  readonly SafeAreaTop: number;
  readonly SafeAreaRight: number;
  readonly SafeAreaBottom: number;
  readonly SafeAreaLeft: number;
  readonly IsComposing: boolean;
  readonly SystemLanguage: string;
  readonly InputMode: string;
  readonly WheelDeltaX: number;
  StorageGet(project: string, key: string): string | null;
  StorageSet(project: string, key: string, value: string): void;
  StorageRemove(project: string, key: string): void;
  LoadText(resourcePath: string): string;
  SetInputMode(mode: string): void;
  Log(level: string, message: string): void;
  PlayAudio(url: string, volume: number): void;
  /** 背景音乐换成 url（空字符串是停掉），新旧两首用 fadeMs 毫秒淡入淡出；和正在放的一样时只改音量。 */
  PlayMusic(url: string, volume: number, fadeMs: number): void;
  /** 暂停或恢复 LGUI 的全部声音。 */
  SetAudioPaused(paused: boolean): void;
  /** 按钮在 ui/ 里设的点击音效的 ui:// 地址；没设是空字符串。 */
  ButtonSoundUrl(button: NativeButton): string;
  /** 动效在 ui/ 里设的自动播放、播放次数和自动播放前等多久（秒）。 */
  TransitionAutoPlay(transition: NativeTransition): boolean;
  TransitionAutoPlayTimes(transition: NativeTransition): number;
  TransitionAutoPlayDelay(transition: NativeTransition): number;
  /** 代码补间要知道的事（TweenInfo.cs）：第 index 个齿轮跟的控制器名（没有是空字符串）、按钮的按下效果、动效的每一项。 */
  GearController(object: NativeObject, index: number): string;
  ButtonDownEffect(button: NativeButton): number;
  ButtonDownEffectValue(button: NativeButton): number;
  DisableButtonDownEffect(button: NativeButton): void;
  TransitionItemCount(transition: NativeTransition): number;
  TransitionItemType(transition: NativeTransition, index: number): number;
  TransitionItemTarget(transition: NativeTransition, index: number): NativeObject | null;
  Fetch(url: string, method: string, headersJson: string, body: string, complete: (responseJson: string) => void): void;
  /** 系统剪贴板里的文字（GUIUtility.systemCopyBuffer），没有文字时是空字符串。 */
  ClipboardGet(): string;
  /** 把文字放进系统剪贴板。 */
  ClipboardSet(text: string): void;
  /** 用 Resources 里的项目字体（lgui unity export 写的 UI/fonts/<名字>）建动态 TMP 字体，挂上系统回退字体，按名字注册给 FairyGUI；没有这个资源、不是字体或建不成时返回 false。 */
  RegisterFont(name: string, resourcePath: string): boolean;
  /** 工程里有没有 TextMesh Pro 的设置资源（TMP Settings，随 TMP Essential Resources 导入）；没有时 TMP 建字体会空引用。 */
  readonly TmpSettingsFound: boolean;
  /** 项目字体后面挂的系统回退字体的名字；候选的系统字体一个都没找到时是空字符串。 */
  readonly FallbackFontName: string;
  /** 按顺序试过的系统字体（逗号分隔，报 LGUI-RT-182 用）。 */
  readonly FallbackFontCandidates: string;
}

export interface NativeStage {
  readonly touchTarget: NativeDisplayObject | null;
  /** 舞台坐标（屏幕像素，y 向下）上最上面那个显示对象；forTouch 时跳过不接收输入的。没有命中时返回舞台自己。 */
  HitTest(stagePoint: unknown, forTouch: boolean): NativeDisplayObject | null;
  soundVolume: number;
  AddCapture(type: string, callback: (context: NativeEventContext) => void): void;
  RemoveCapture(type: string, callback: (context: NativeEventContext) => void): void;
}

export interface NativeRoot extends NativeComponent {
  SetContentScaleFactor(scale: number): void;
}

export interface NativePackageItem {
  readonly width: number;
  readonly height: number;
}

export interface NativePackage {
  GetItemByName(name: string): NativePackageItem | null;
}

export type NativePlatformApi = NativeFairyGUI & {
  Stage: {readonly touchScreen: boolean; readonly inst: NativeStage};
  GRoot: {readonly inst: NativeRoot};
  UIPackage: {
    GetByName(name: string): NativePackage | null;
    AddPackage(path: string): NativePackage | null;
    RemovePackage(name: string): void;
    GetItemAssetByURL(url: string): unknown | null;
  };
};

export interface UnityPlatformOptions {
  projectName: string;
  uiBase: string;
  host: NativePlatformHost;
  fgui: NativePlatformApi;
  objects: {
    toPointerInput(type: PointerInput['type'], context: NativeEventContext): PointerInput;
    dispatchHover(target: NativeObject | null, context: NativeEventContext): void;
  };
  createLoader(): NativeLoader;
  scale: {value: number};
}
