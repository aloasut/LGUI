// fairygui.module.js 里 h5 后端（含 ../fairygui-patches/ 的钩子）用到的那一部分的类型声明（上游没有附带声明文件）。

export interface FguiEvent {
  /** 事件附带的数据（比如 click_item 是被点的那一项）。 */
  data: unknown;
}

export type FguiListener = (event: FguiEvent) => void;

export class EventDispatcher {
  on(type: string, callback: FguiListener, target?: unknown, capture?: boolean): void;
  off(type: string, callback: FguiListener, target?: unknown, capture?: boolean): void;
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
  /** 没被齿轮藏起来（所在的组也没有）。 */
  readonly internalVisible: boolean;
  /** 自己显示，所在的组也显示。 */
  readonly internalVisible2: boolean;
  readonly packageItem: PackageItem | null;
  readonly element: HTMLElement;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly isDisposed: boolean;
  /** 齿轮（上游没有公开的读法，读内部字段）：0 Display、1 XY、2 Size、3 Look、4 Color、5 Animation、6 Text、7 Icon、8 Display2、9 FontSize。 */
  readonly _gears: ({controller: Controller | null} | undefined)[];
  setScale(scaleX: number, scaleY: number): void;
  /** ObjectPropID：2 Color（数字 0xrrggbb）、8 FontSize。 */
  getProp(index: number): unknown;
  setProp(index: number, value: unknown): void;
  setPosition(x: number, y: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
  removeFromParent(): void;
}

export class GComponent extends GObject {
  readonly numChildren: number;
  getChild(name: string): GObject | null;
  getChildAt(index: number): GObject;
  getController(name: string): Controller | null;
  getTransition(name: string): Transition | null;
  /** 组件自己的全部动效（上游没有公开的读法，读内部字段）。 */
  readonly _transitions: Transition[];
  addChild(child: GObject): GObject;
  removeChild(child: GObject, dispose?: boolean): GObject;
  ensureBoundsCorrect(): void;
  getChildById(id: string): GObject | null;
}

export class GRoot extends GComponent {
  static readonly inst: GRoot;
}

export class GTextField extends GObject {
  text: string;
  color: number;
}

export class GRichTextField extends GTextField {}

export class GTextInput extends GTextField {
  setPromptText(value: string): void;
}

export class GButton extends GComponent {
  title: string;
  icon: string;
  selected: boolean;
  /** ButtonMode：0 Common、1 Check、2 Radio。 */
  readonly mode: number;
  sound: string | null;
  soundVolumeScale: number;
  /** 标题文字控件，没有时是 null。 */
  getTextField(): GTextField | null;
}

export class GImage extends GObject {
  fillMethod: number;
  fillOrigin: number;
  fillClockwise: boolean;
  fillAmount: number;
  color: number;
}

export class GLoader extends GObject {
  url: string;
  fillMethod: number;
  fillOrigin: number;
  fillClockwise: boolean;
  fillAmount: number;
}

export class Rect {
  constructor(x: number, y: number, width: number, height: number);
  x: number; y: number; width: number; height: number;
}

export class ScrollPane {
  posX: number;
  posY: number;
  setPosX(value: number, ani?: boolean): void;
  setPosY(value: number, ani?: boolean): void;
  scrollToView(target: Rect, ani?: boolean, setFirst?: boolean): void;
}

export class GList extends GComponent {
  numItems: number;
  itemRenderer: ((index: number, item: GObject) => void) | null;
  selectedIndex: number;
  readonly scrollPane: ScrollPane | null;
  setVirtual(): void;
  scrollToView(index: number, ani?: boolean, setFirst?: boolean): void;
  itemIndexToChildIndex(index: number): number;
  childIndexToItemIndex(index: number): number;
  clearSelection(): void;
}

export class GLabel extends GComponent {
  title: string | null;
  icon: string | null;
  /** 标题文字控件，没有时是 null。 */
  getTextField(): GTextField | null;
}

export class GSlider extends GComponent {
  value: number;
  min: number;
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
  color: number;
}

export class GTreeNode {
  constructor(isFolder?: boolean, resURL?: string);
  expanded: boolean;
  readonly cell: GComponent | null;
  addChild(child: GTreeNode): GTreeNode;
  removeChildren(beginIndex?: number, endIndex?: number): void;
}

export class GTree extends GList {
  readonly rootNode: GTreeNode;
  treeNodeRender: ((node: GTreeNode, cell: GComponent) => void) | null;
  selectNode(node: GTreeNode, scrollItToView?: boolean): void;
}

export class GProgressBar extends GComponent {
  value: number;
  max: number;
}

export class GGraph extends GObject {
  color: number;
}

export class Controller extends EventDispatcher {
  name: string;
  selectedIndex: number;
  selectedPage: string;
  readonly pageCount: number;
  getPageName(index: number): string;
}

export class Transition {
  name: string;
  readonly playing: boolean;
  /** ui/ 里写的自动播放、播放次数、延迟（秒）（上游没有公开的读法，读内部字段）。 */
  readonly _autoPlay: boolean;
  readonly _autoPlayTimes: number;
  readonly _autoPlayDelay: number;
  play(onComplete?: () => void, times?: number, delay?: number): void;
  stop(setToComplete?: boolean, processCallback?: boolean): void;
  setPaused(paused: boolean): void;
  /** 动效所在的组件和每一项（上游没有公开的读法，读内部字段）。type 是 ActionType：0 XY、1 Size、2 Scale、4 Alpha、5 Rotation、6 Color、11 Shake、14 Text…… */
  readonly _owner: GComponent;
  readonly _items: {type: number; targetId: string | null; target: GObject | null}[];
}

export class PackageItem {
  id: string;
  name: string;
  width: number;
  height: number;
  owner: UIPackage;
  type: number;
  file: string;
}

export class UIPackage {
  readonly id: string;
  readonly name: string;
  static loadPackage(url: string): Promise<UIPackage>;
  static removePackage(packageIdOrName: string): void;
  static getByName(name: string): UIPackage | undefined;
  static createObject(pkgName: string, resName: string): GObject | null;
  static setImageManifest(manifest: unknown): void;
  static loadImageManifest(url: string): Promise<void>;
  getItemById(itemId: string): PackageItem | null;
  getItemByName(resName: string): PackageItem | undefined;
}

export class UIConfig {
  static defaultFont: string;
}

export declare const FillMethod: {readonly None: 0; readonly Horizontal: 1; readonly Vertical: 2; readonly Radial90: 3; readonly Radial180: 4; readonly Radial360: 5};
export declare const AutoSizeType: {readonly None: 0; readonly Both: 1; readonly Height: 2; readonly Shrink: 3; readonly Ellipsis: 4};
export declare const PackageItemType: {readonly Image: number; readonly Component: number};
export function convertToHtmlColor(rgb: number): string;

/** DOM 元素类（fgui-div 等），补丁在它们的原型上挂钩子。 */
export class UIElement extends HTMLElement {}
export class Image extends UIElement {}
export class MovieClip extends Image {}
export class TextField extends UIElement {}

export class XML {
  constructor(source: string);
}

export class TranslationHelper {
  static loadFromXML(source: XML): void;
}
