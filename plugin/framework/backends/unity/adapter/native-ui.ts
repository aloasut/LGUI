// FairyGUI-unity 8cc8f2 的 C# 边界。仅后端引用；游戏代码不接触引擎对象。
export interface NativeColor {r: number; g: number; b: number; a: number}
export interface NativeVector2 {x: number; y: number}
export interface NativeRect {x: number; y: number; width: number; height: number}
export interface NativeInputEvent {
  x: number; y: number; touchId: number; button: number;
  keyCode: number; character: string | number; mouseWheelDelta: number;
}
export interface NativeEventContext {
  inputEvent: NativeInputEvent | null;
  data: unknown;
  CaptureTouch(): void;
}
export type NativeEventHandler = (event: NativeEventContext) => void;
export interface NativeEventListener {
  Add(handler: NativeEventHandler): void;
  Remove(handler: NativeEventHandler): void;
  AddCapture(handler: NativeEventHandler): void;
  RemoveCapture(handler: NativeEventHandler): void;
}
/** PuerTS 里的 C# List<T>。 */
export interface NativeCsList<T> {readonly Count: number; get_Item(index: number): T}
export interface NativeCsMutableList<T> extends NativeCsList<T> {Clear(): void; Add(item: T): void}
/** FairyGUI 的显示对象：只用到显示、父节点和它所属的 GObject。 */
export interface NativeDisplayObject {
  readonly visible: boolean;
  readonly parent: NativeDisplayObject | null;
  readonly gOwner: NativeObject | null;
  readonly onMouseWheel: NativeEventListener;
}
export interface NativePackageItem {
  name: string; owner: {name: string}; width: number; height: number;
  /** FairyGUI.PackageItemType。 */
  type: number;
}
export interface NativeObject {
  name: string; visible: boolean; enabled: boolean; grayed: boolean; touchable: boolean;
  x: number; y: number; width: number; height: number;
  scaleX: number; scaleY: number; rotation: number; alpha: number;
  readonly pivotX: number; readonly pivotY: number;
  readonly isDisposed: boolean;
  data: unknown;
  readonly parent: NativeComponent | null;
  readonly packageItem: NativePackageItem | null;
  readonly onTouchBegin: NativeEventListener;
  readonly onTouchMove: NativeEventListener;
  readonly onTouchEnd: NativeEventListener;
  /** 显示对象在舞台上（被齿轮或组藏起来时 FairyGUI 把它从父容器里移走）。 */
  readonly onStage: boolean;
  readonly displayObject: NativeDisplayObject | null;
  SetXY(x: number, y: number): void;
  SetSize(width: number, height: number): void;
  SetScale(scaleX: number, scaleY: number): void;
  Dispose(): void;
}
export interface NativeComponent extends NativeObject {
  readonly numChildren: number;
  GetChild(name: string): NativeObject | null;
  GetChildAt(index: number): NativeObject;
  GetChildIndex(child: NativeObject): number;
  GetController(name: string): NativeController | null;
  GetTransition(name: string): NativeTransition | null;
  readonly Transitions: NativeCsList<NativeTransition>;
  AddChild(child: NativeObject): NativeObject;
  RemoveChild(child: NativeObject): NativeObject;
}
/** FairyGUI 的 TextFormat：改了要整个写回 textFormat 才生效。 */
export interface NativeTextFormat {size: number}
export interface NativeText extends NativeObject {text: string; color: NativeColor; textFormat: NativeTextFormat}
export interface NativeTextInput extends NativeText {promptText: string; readonly onChanged: NativeEventListener}
/** sound 是 NAudioClip（地址由 LGUI.Platform.ButtonSoundUrl 反查）。 */
/** mode 是 FairyGUI.ButtonMode：PuerTS 一般给数字（0 Common、1 Check、2 Radio），也可能是枚举名或带 ToString 的枚举对象。 */
export interface NativeButton extends NativeComponent {title: string; icon: string; selected: boolean; readonly mode: unknown; sound: unknown | null; soundVolumeScale: number; titleColor: NativeColor; titleFontSize: number; GetTextField(): NativeText | null}
export interface NativeLabel extends NativeComponent {title: string | null; icon: string | null; titleColor: NativeColor; titleFontSize: number; GetTextField(): NativeText | null}
export interface NativeSlider extends NativeComponent {value: number; min: number; max: number; readonly onChanged: NativeEventListener}
/** items 是 C# 的 string[]（PuerTS 不和 JS 数组互转），所以读写都走 itemList，改完调用 ApplyListChange。 */
export interface NativeComboBox extends NativeComponent {
  readonly itemList: NativeCsMutableList<string>; selectedIndex: number; readonly text: string | null; readonly onChanged: NativeEventListener;
  ApplyListChange(): void;
}
export interface NativeMovieClip extends NativeObject {playing: boolean; frame: number; color: NativeColor}
export interface NativeImage extends NativeObject {
  fillMethod: number; fillOrigin: number; fillClockwise: boolean; fillAmount: number; color: NativeColor;
}
/** LGUIResourceLoader 继承原生 GLoader；两种完成事件由 LGUI 的 C# 衔接类提供。 */
export interface NativeLoader extends NativeObject {
  url: string;
  fillMethod: number; fillAmount: number; color: NativeColor;
  readonly texture: unknown | null;
  readonly component: NativeComponent | null;
  readonly onLoaded: NativeEventListener;
  readonly onLoadError: NativeEventListener;
}
export interface NativeScrollPane {
  readonly posX: number; readonly posY: number;
  SetPosX(value: number, animate: boolean): void;
  SetPosY(value: number, animate: boolean): void;
  ScrollToView(target: NativeRect, animate: boolean, setFirst: boolean): void;
}
export interface NativeList extends NativeComponent {
  numItems: number;
  itemRenderer: ((index: number, item: NativeObject) => void) | null;
  selectedIndex: number;
  readonly scrollPane: NativeScrollPane | null;
  readonly onClickItem: NativeEventListener;
  SetVirtual(): void;
  ChildIndexToItemIndex(index: number): number;
  ItemIndexToChildIndex(index: number): number;
  ScrollToView(index: number, animate: boolean): void;
}
export interface NativeTreeNode {
  expanded: boolean;
  readonly cell: NativeComponent | null;
  AddChild(child: NativeTreeNode): NativeTreeNode;
  RemoveChildren(beginIndex: number, endIndex: number): void;
}
export interface NativeTree extends NativeList {
  readonly rootNode: NativeTreeNode;
  treeNodeRender: ((node: NativeTreeNode, cell: NativeComponent) => void) | null;
  SelectNode(node: NativeTreeNode, scrollItToView: boolean): void;
  ClearSelection(): void;
  EnsureBoundsCorrect(): void;
}
export interface NativeProgress extends NativeComponent {value: number; max: number}
export interface NativeGraph extends NativeObject {color: NativeColor}
export interface NativeController {
  readonly name: string; selectedPage: string; readonly pageCount: number;
  readonly onChanged: NativeEventListener;
  GetPageName(index: number): string;
}
export interface NativeTransition {
  readonly name: string;
  readonly playing: boolean;
  Play(times: number, delay: number, complete: () => void): void;
  Stop(setToComplete: boolean, processCallback: boolean): void;
  SetPaused(paused: boolean): void;
}
export interface NativeFairyGUI {
  GComponent: new () => NativeComponent;
  GTextField: new () => NativeText;
  GTextInput: new () => NativeTextInput;
  GButton: new () => NativeButton;
  GImage: new () => NativeImage;
  GLoader: new () => NativeLoader;
  GList: new () => NativeList;
  GProgressBar: new () => NativeProgress;
  GGraph: new () => NativeGraph;
  GLabel: new () => NativeLabel;
  GSlider: new () => NativeSlider;
  GComboBox: new () => NativeComboBox;
  GMovieClip: new () => NativeMovieClip;
  GTree: new () => NativeTree;
  GTreeNode: new (hasChild: boolean) => NativeTreeNode;
  Utils: {ToolSet: {ConvertFromHtmlColor(value: string): NativeColor}};
  Stage: {touchScreen: boolean};
  UIPackage: {GetItemByURL(url: string): NativePackageItem | null};
}
