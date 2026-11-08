// fairygui-cc 类型子集（ambient declare module 'fairygui-cc'）——本仓库工具链用；CC 工程里用 fork dist 自带声明亦可。
declare module 'fairygui-cc' {
import type {Node} from 'cc';
// fairygui.mjs（fairygui-cc，官方 ccc3.0 运行库）里 cocos 后端用到的成员的类型声明。
// 真实签名以 fork 的 sdk/source/dist/fairygui.d.ts 为准（本文件是手写子集，同 h5 vendor 的做法）。
// 事件名与 FairyGUI-dom 不同：这里是 Event 常量（fui_touch_begin / fui_click_item / fui_status_changed…）。

/** cc.Color 的形状（只声明用到的部分；真实类型在引擎里）。 */
export interface FguiColor {
  r: number;
  g: number;
  b: number;
}

export class Rect {
  constructor(x?: number, y?: number, width?: number, height?: number);
  x: number;
  y: number;
  width: number;
  height: number;
}



/** FairyGUI 事件。listener 收到它；pos 是设计尺寸里的舞台坐标。 */
export class Event {
  readonly type: string;
  /** 事件附带的数据（比如 click_item 项事件在发起者上读）。 */
  data: unknown;
  /** 发起对象。 */
  readonly initiator: GObject | null;
  /** 舞台（设计尺寸）坐标。 */
  readonly pos: {x: number; y: number};
  /** 触摸指针编号；鼠标是 -1。 */
  readonly touchId: number;
  /** 滚轮量（纵向；横向量运行库没透出）。 */
  readonly mouseWheelDelta: number;
  static TOUCH_BEGIN: string;
  static TOUCH_MOVE: string;
  static TOUCH_END: string;
  static CLICK: string;
  static ROLL_OVER: string;
  static MOUSE_WHEEL: string;
  static TEXT_CHANGE: string;
  static STATUS_CHANGED: string;
  static XY_CHANGED: string;
  static CLICK_ITEM: string;
  static SCROLL: string;
  static DROP: string;
}

export class EventDispatcher {
  on(type: string, listener: (event: FguiEvent) => void, target?: unknown): void;
  once(type: string, listener: (event: FguiEvent) => void, target?: unknown): void;
  off(type: string, listener?: (event: FguiEvent) => void, target?: unknown): void;
  dispatchEvent(event: FguiEvent): void;
}

export interface PackageItem {
  readonly owner: UIPackage;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** 资源类型（'image' | 'sound' | …，以运行库为准）。 */
  readonly type: string;
}

export class GObject extends EventDispatcher {
  name: string;
  visible: boolean;
  touchable: boolean;
  grayed: boolean;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  data: unknown;
  readonly parent: GComponent | null;
  readonly group: GGroup | null;
  /** 自己 + 所在组是否显示（齿轮藏起来的不算）。 */
  readonly internalVisible3: boolean;
  /** 同 internalVisible3 再叠加祖先组（内部字段，运行库公开成 getter；h5 的 internalVisible2 对应物）。 */
  readonly _finalVisible: boolean;
  readonly packageItem: PackageItem | null;
  readonly node: Node;
  readonly resourceURL: string | null;
  setPosition(x: number, y: number): void;
  setSize(width: number, height: number, ignorePivot?: boolean): void;
  setScale(sx: number, sy: number, sz?: number): void;
  /** 命中测试；globalPt 是引擎世界坐标（不是设计坐标）。 */
  hitTest(globalPt: {x: number; y: number}, forTouch?: boolean): GObject | null;
  globalToLocal(x: number, y: number, result?: {x: number; y: number}): {x: number; y: number};
  localToGlobal(x: number, y: number, result?: {x: number; y: number}): {x: number; y: number};
  dispose(): void;
  removeFromParent(): void;
}

export class GGroup extends GObject {}

export class GComponent extends GObject {
  readonly numChildren: number;
  /** 有滚动内容时才有；没有是 null（运行库如此，类型上别当必有）。 */
  readonly scrollPane: ScrollPane | null;
  /** 组件自己的全部动效（上游没有公开读法，读内部字段，同 h5）。 */
  readonly _transitions: Transition[];
  getChild(name: string): GObject | null;
  getChildAt(index: number): GObject;
  getChildIndex(child: GObject): number;
  getController(name: string): Controller | null;
  getTransition(name: string): Transition | null;
  addChild(child: GObject): GObject;
  addChildAt(child: GObject, index: number): GObject;
  removeChild(child: GObject, dispose?: boolean): GObject;
  ensureBoundsCorrect(): void;
}

export class GRoot extends GComponent {
  static readonly inst: GRoot;
  static create(): GRoot;
  /** 按当前窗口重排根节点尺寸/缩放（手动挂载流程里替代 create 调它）。 */
  onWinResize(): void;
  readonly inputProcessor: {owner: GRoot};
  getTouchPosition(touchId?: number): {x: number; y: number};
}

export class GTextField extends GObject {
  text: string;
  color: FguiColor;
}

export class GTextInput extends GTextField {
  promptText: string | null;
}

export class GImage extends GObject {
  fillMethod: number;
  fillOrigin: number;
  fillClockwise: boolean;
  fillAmount: number;
}

export class GLoader extends GObject {
  url: string;
}

export class GButton extends GComponent {
  title: string | null;
  icon: string | null;
  selected: boolean;
  /** ButtonMode：0 Common、1 Check、2 Radio。 */
  readonly mode: number;
  sound: string | null;
  soundVolumeScale: number;
}

export class GLabel extends GComponent {
  title: string | null;
  icon: string | null;
}

export class GSlider extends GComponent {
  value: number;
  min: number;
  max: number;
}

export class GProgressBar extends GComponent {
  value: number;
  max: number;
}

export class GComboBox extends GComponent {
  items: string[];
  selectedIndex: number;
  readonly text: string | null;
}

export class GMovieClip extends GObject {
  playing: boolean;
  frame: number;
}

export class GGraph extends GObject {
  color: FguiColor;
}

export type ListItemRenderer = (index: number, item: GComponent) => void;

export class GList extends GComponent {
  numItems: number;
  itemRenderer: ListItemRenderer | null;
  selectedIndex: number;
  setVirtual(): void;
  scrollToView(index: number, ani?: boolean, setFirst?: boolean): void;
  childIndexToItemIndex(index: number): number;
  itemIndexToChildIndex(index: number): number;
}

export class GTreeNode {
  constructor(hasChild?: boolean, resURL?: string);
  expanded: boolean;
  readonly isFolder: boolean;
  readonly cell: GComponent;
  readonly parent: GTreeNode | null;
  addChild(child: GTreeNode): GTreeNode;
  removeChildren(beginIndex?: number, endIndex?: number): void;
}

export class GTree extends GComponent {
  rootNode: GTreeNode;
  treeNodeRender: (node: GTreeNode, cell: GComponent) => void;
  clearSelection(): void;
  selectNode(node: GTreeNode, scrollItToView?: boolean): void;
  ensureBoundsCorrect(): void;
}

export class ScrollPane {
  posX: number;
  posY: number;
  setPosX(value: number, ani?: boolean): void;
  setPosY(value: number, ani?: boolean): void;
  scrollToView(rect: Rect, ani?: boolean, setFirst?: boolean): void;
}

/** Controller 继承 cc 的 EventTarget；本后端只用 on/off 订阅 status_changed，回调不读事件内容。 */
export class Controller extends EventDispatcher {
  readonly name: string;
  selectedPage: string;
  readonly pageCount: number;
  getPageName(index: number): string;
}

export class Transition {
  readonly name: string;
  readonly playing: boolean;
  /** 上游没有公开读法，读内部字段（同 h5）。 */
  readonly _autoPlay: boolean | undefined;
  readonly _autoPlayTimes: number | undefined;
  /** 秒。 */
  readonly _autoPlayDelay: number | undefined;
  play(onComplete?: (() => void) | null, times?: number, delay?: number, startTime?: number, endTime?: number): void;
  stop(setToComplete?: boolean, processCallback?: boolean): void;
  setPaused(paused: boolean): void;
}

export class UIPackage {
  static getByName(name: string): UIPackage | undefined;
  static loadPackage(bundle: {load(url: string, type?: unknown, onComplete?: (error: Error | null, asset: unknown) => void): void}, path: string, onComplete?: (error: Error | null, pkg: UIPackage) => void): void;
  static removePackage(packageIdOrName: string): void;
  static createObject(pkgName: string, resName: string, userClass?: new () => GObject): GObject | null;
  static createObjectFromURL(url: string, userClass?: new () => GObject): GObject | null;
  static getById(id: string): UIPackage | undefined;
  readonly name: string;
  readonly id: string;
  createObject(resName: string, userClass?: new () => GObject): GObject | null;
  getItemByName(resName: string): PackageItem | undefined;
  getItemAsset(item: PackageItem): {playOneShot?: (volumeScale: number) => number} | null;
}

/** UIConfig 只声明用到的键。 */
export const UIConfig: {defaultFont: string};

export const TranslationHelper: {loadFromXML(source: string): void};

}
