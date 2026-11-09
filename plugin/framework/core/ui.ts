// 接口层的 UI 对象：各后端的 FairyGUI 运行时统一成这一套写法。
// 只在框架内部用；游戏代码通过绑定表和钩子里的 this.ui 用到这些类型。
import type {WheelInput} from './platform';

/** 取消订阅。所有事件订阅都返回它。 */
export type Unsubscribe = () => void;

/** 一个矩形，单位是设计尺寸里的像素。 */
export interface Rect {
  /** 左上角 x。 */
  x: number;
  /** 左上角 y。 */
  y: number;
  /** 宽。 */
  width: number;
  /** 高。 */
  height: number;
}

/** 一次原始指针事件（鼠标和触摸统一），坐标是设计尺寸里的坐标。 */
export interface PointerInput {
  /** 按下、移动、抬起、取消。 */
  type: 'down' | 'move' | 'up' | 'cancel';
  /** 指针编号，多点触摸时区分手指。 */
  pointerId: number;
  /** 指针类型。 */
  pointerType: 'mouse' | 'touch' | 'pen';
  /** x 坐标。 */
  x: number;
  /** y 坐标。 */
  y: number;
  /** 事件时间（毫秒，和 Platform.time.now 同一个时钟）。 */
  time: number;
}

/** 内部用：代码补间（mvc/tween）直接读写的属性。位置、尺寸是设计尺寸的像素；颜色是 0xrrggbb 的数字；progress 是进度条的 0–100。 */
export type TweenProp = 'x' | 'y' | 'width' | 'height' | 'scaleX' | 'scaleY' | 'rotation' | 'alpha' | 'color' | 'fontSize' | 'fillAmount' | 'progress';

/** 内部用：ui/ 动效的一项改控件的哪一类属性（XY、Size、Scale、Alpha、Rotation、Color、Shake、Text 项）。 */
export type TransitionTouch = 'xy' | 'size' | 'scale' | 'alpha' | 'rotation' | 'color' | 'shake' | 'text';

/** 所有 UI 对象的公共部分。 */
export interface UIObject {
  /** 在 ui/ 里的控件名。 */
  readonly name: string;
  /** 是否显示。 */
  visible: boolean;
  /** 是否可用；false 时变灰并且不可点。 */
  enabled: boolean;
  /** 是否接收指针输入。 */
  touchable: boolean;
  /** 内部用：位置和尺寸（设计尺寸）。游戏代码不写坐标和尺寸。 */
  rect: Rect;
  /** 在 ui/ 里写的自定义数据（customData），比如 ArtText 的配置。 */
  readonly customData: string;
  /** 订阅落在这个对象上的原始指针事件，手势由框架识别。 */
  onPointer(handler: (event: PointerInput) => void): Unsubscribe;
  /** 内部用：设计尺寸里 (x, y) 这一点上最上面那个接收输入的控件在自己里面第几层（0 是自己），不在自己里面是 -1。拖放找落点用。 */
  hitDepth(x: number, y: number): number;
  /** 订阅落在这个对象（或它里面的控件）上的滚轮事件，坐标是设计尺寸里的坐标。 */
  onWheel(handler: (event: WheelInput) => void): Unsubscribe;
  /** 内部用：是不是真的显示着：自己和各级父组件都显示，也没有被齿轮（gearDisplay）或组藏起来。 */
  readonly shown: boolean;
  /** 内部用：所在的组件（列表子项的是列表），不在任何组件里是 null。 */
  readonly parent: UIObject | null;
  /** 内部用：已经销毁了。 */
  readonly disposed: boolean;
  /** 内部用：轴心（0–1，相对自己的宽高），ui/ 里没写是 (0, 0)。 */
  readonly pivot: {x: number; y: number};
  /** 内部用：这个控件有没有这个属性（代码补间用）。 */
  supports(prop: TweenProp): boolean;
  /** 内部用：读一个属性（代码补间用）。 */
  getProp(prop: TweenProp): number;
  /** 内部用：只改这一个属性（代码补间用）。 */
  setProp(prop: TweenProp, value: number): void;
  /** 内部用：这个属性（text 是文字，给 roll 查）还归谁管（改它的齿轮），返回说明文字（比如「齿轮 gearSize（控制器 c1）」）；没有是 null。按钮的按下效果、动效、绑定由框架另外查。 */
  ownerOf(prop: TweenProp | 'text'): string | null;
}

/** 组件：可以按路径找子控件、控制器和动效。Name 是组件在 ui/ 里的「包/组件」名。 */
export interface UIComponent<Name extends string = string> extends UIObject {
  /** 组件的「包/组件」名。 */
  readonly componentName: Name;
  /** 内部用：按「.」连起来的路径找子控件，找不到返回 null。 */
  child(path: string): UIObject | null;
  /** 内部用：按名字找控制器，找不到返回 null。 */
  controller(name: string): UIController | null;
  /** 内部用：按名字找动效，找不到返回 null。 */
  transition(name: string): UITransition | null;
  /** 内部用：组件自己的全部动效（不含子组件的）。 */
  allTransitions(): readonly UITransition[];
  /** 内部用：直接子控件的名字，按显示顺序。 */
  childNames(): readonly string[];
  /** 内部用：把一个对象加到最上面（UIManager 往层里放界面时用）。已经是它的子对象时只移到最上面，不离开舞台（FairyGUI 的 addChild 就是这样）。 */
  addChild(child: UIObject): void;
  /** 内部用：移除一个子对象（不销毁）。 */
  removeChild(child: UIObject): void;
  /** 内部用：销毁组件和它的全部子对象。 */
  dispose(): void;
}

/** 文字。 */
export interface UIText extends UIObject {
  /** 显示的文字。 */
  text: string;
  /** 文字颜色，#rrggbb。 */
  color: string;
}

/** 富文本（UBB 语法）。 */
export interface UIRichText extends UIText {}

/** 输入框。 */
export interface UIInput extends UIText {
  /** 没有输入时显示的提示文字。 */
  promptText: string;
  /** 用户改了文字时调用，参数是新文字；输入法还在选字时不调用，选完调用一次。 */
  onChange(handler: (text: string) => void): Unsubscribe;
}

/** 按钮。 */
export interface UIButton extends UIComponent {
  /** 标题文字。 */
  title: string;
  /** 图标地址（ui:// 或网络地址）。 */
  icon: string;
  /** 是否选中（单选、多选按钮）。 */
  selected: boolean;
  /** ui/ 里按钮组件的模式：'Common'（普通按钮，不保持选中）、'Check'（开关）、'Radio'（单选），和 FairyGUI 的名字一样。 */
  readonly mode: string;
  /** ui/ 里给这个按钮设的点击音效（实例上写的优先，其次是按钮组件的），没设是空字符串。 */
  readonly sound: string;
  /** ui/ 里设的点击音效音量（0–1，没设是 1；0 表示这个按钮不出声）。 */
  readonly soundVolume: number;
  /** 内部用：ui/ 里按钮组件的按下效果（downEffect）和 downEffectValue。type 是 scale 时由框架接管（FairyGUI 原来的一下子缩小已经关掉），按下、松开的缩放写进 pressScale。 */
  readonly downEffect: {type: 'none' | 'dark' | 'scale'; value: number};
  /** 内部用：按下效果的缩放，1 是原样。只是视觉效果，不改位置、尺寸、scale，按按钮中心缩放。 */
  pressScale: number;
}

/** 图片。fill 用于进度显示（比如长按进度、冷却）。 */
export interface UIImage extends UIObject {
  /** 填充方式。 */
  fillMethod: 'none' | 'horizontal' | 'vertical' | 'radial90' | 'radial180' | 'radial360';
  /** 填充起点（含义随 fillMethod 变化，和 FairyGUI 一致）。 */
  fillOrigin: number;
  /** 径向填充是否顺时针。 */
  fillClockwise: boolean;
  /** 填充比例 0–1。 */
  fillAmount: number;
}

/** 加载器：显示动态图片。 */
export interface UILoader extends UIObject {
  /** 图片地址；空字符串表示不显示。 */
  url: string;
  /** 图片加载完成时调用。 */
  onLoad(handler: () => void): Unsubscribe;
  /** 图片加载失败时调用，参数是失败的地址。 */
  onError(handler: (url: string) => void): Unsubscribe;
}

/** 列表。 */
export interface UIList extends UIObject {
  /** 子项数量；改了就重新渲染。 */
  numItems: number;
  /** 渲染第 index 项时调用；item 是从对象池取出的子项组件。 */
  itemRenderer: ((index: number, item: UIComponent) => void) | null;
  /** 能不能滚动：ui/ 里列表的 overflow 是 scroll（FairyGUI 给它建了滚动面板）。只有能滚动的列表才能设成虚拟列表。 */
  readonly scrollable: boolean;
  /** 是否虚拟列表（只创建看得见的子项）。列表要能滚动（scrollable）。 */
  virtual: boolean;
  /** 滚动位置（像素，设计尺寸）。 */
  scrollPosition: { x: number; y: number };
  /** 选中项的序号，没有选中时是 -1。 */
  selectedIndex: number;
  /** 用户点了第 index 项时调用。 */
  onClickItem(handler: (index: number) => void): Unsubscribe;
  /** 内部用：第 index 项当前对应的子项组件，没创建（虚拟列表里看不见）时返回 null。 */
  itemAt(index: number): UIComponent | null;
  /** 滚动到让第 index 项可见。 */
  scrollToView(index: number): void;
}

/** 控制器。Page 是页名的联合类型。 */
export interface UIController<Page extends string = string> {
  /** 控制器名。 */
  readonly name: string;
  /** 当前页名。 */
  selectedPage: Page;
  /** 全部页名，按顺序。 */
  readonly pages: readonly Page[];
  /** 当前页变了时调用（用户操作和代码设置都会触发），参数是新页名。 */
  onChange(handler: (page: Page) => void): Unsubscribe;
}

/** 动效。 */
export interface UITransition {
  /** 动效名。 */
  readonly name: string;
  /** ui/ 里写的设置：是否自动播放、播放次数（-1 一直循环）、自动播放前等多久（毫秒）。 */
  readonly settings: {autoPlay: boolean; times: number; delay: number};
  /** 是否正在播放（暂停着、还在等 delay 也算）。 */
  readonly playing: boolean;
  /** 从头播放 times 次（-1 一直循环），先等 delay 毫秒；正常放完时调用 onComplete，被 stop、重播或销毁打断时不调用。 */
  play(options?: {times?: number; delay?: number}, onComplete?: () => void): void;
  /** 停止，停在最后一帧。 */
  stop(): void;
  /** 暂停或恢复（界面被盖住时由框架调用）；没在播放时不起作用。 */
  setPaused(paused: boolean): void;
  /** 内部用：每一项改哪个控件的哪一类属性（查代码补间和动效有没有抢同一个属性）。 */
  touches(): readonly {target: UIObject; what: TransitionTouch}[];
}

/** 进度条。 */
export interface UIProgress extends UIComponent {
  /** 当前值。 */
  value: number;
  /** 最大值。 */
  max: number;
}

/** 标签（扩展类型 Label）：标题文字加图标，不能点选。 */
export interface UILabel extends UIComponent {
  /** 标题文字（子控件 title）。 */
  title: string;
  /** 图标地址（子控件 icon）。 */
  icon: string;
}

/** 滑动条（扩展类型 Slider）。 */
export interface UISlider extends UIComponent {
  /** 当前值（滑动条自己的单位，在 min 和 max 之间）。 */
  value: number;
  /** 最小值。 */
  min: number;
  /** 最大值。 */
  max: number;
  /** 用户拖动或点击改了值时调用（代码设置不调用），参数是新值。 */
  onChange(handler: (value: number) => void): Unsubscribe;
}

/** 下拉框（扩展类型 ComboBox）：点开以后从弹出的列表里选一项。 */
export interface UIComboBox extends UIComponent {
  /** 每一项显示的文字。换了以后选中项还在范围内就保留，否则变成 -1。 */
  items: readonly string[];
  /** 选中项的序号，没有选中时是 -1。 */
  selectedIndex: number;
  /** 现在显示的文字（选中项的文字，没有选中时是空字符串）。 */
  readonly text: string;
  /** 用户选了一项时调用（代码设置不调用），参数是序号。 */
  onChange(handler: (index: number) => void): Unsubscribe;
}

/** 序列帧动画（movieclip）。 */
export interface UIMovieClip extends UIObject {
  /** 是否在播放。 */
  playing: boolean;
  /** 当前帧。 */
  frame: number;
}

/** 树的一个节点。 */
export interface UITreeNode {
  /** 认出同一个节点（整棵树里唯一）。 */
  key: string | number;
  /** 子节点；空数组表示叶子。 */
  children: readonly UITreeNode[];
}

/** 树（列表写了 treeView="true"）：一层层的节点，每个节点用列表的子项组件显示。 */
export interface UITree extends UIObject {
  /** 换一整棵树。同一个 key 的节点保留展开状态，新节点是展开的。 */
  setNodes(nodes: readonly UITreeNode[]): void;
  /** 显示一个节点时调用：节点的 key 和它的子项组件（子项组件会复用）。 */
  nodeRenderer: ((key: string | number, item: UIComponent) => void) | null;
  /** 选中节点的 key，没有选中时是 null；设置时先展开它的各级父节点。 */
  selectedKey: string | number | null;
  /** 用户点了一个节点时调用，参数是 key。 */
  onClickNode(handler: (key: string | number) => void): Unsubscribe;
  /** 现在显示着的节点数（收起的节点下面的不算）。 */
  readonly numItems: number;
  /** 内部用：显示着的第 index 个节点的子项组件，没有时返回 null。 */
  itemAt(index: number): UIComponent | null;
}

/** 图形（矩形、圆等）。 */
export interface UIGraph extends UIObject {
  /** 填充颜色，#rrggbb 或 #aarrggbb。 */
  color: string;
}

/** 控件类型名到接口类型的对应，生成的控件类型和 headless 描述都用这套名字。 */
export interface UIKinds {
  /** 组件。 */
  component: UIComponent;
  /** 文字。 */
  text: UIText;
  /** 富文本。 */
  richtext: UIRichText;
  /** 输入框。 */
  input: UIInput;
  /** 按钮。 */
  button: UIButton;
  /** 图片。 */
  image: UIImage;
  /** 加载器。 */
  loader: UILoader;
  /** 列表。 */
  list: UIList;
  /** 进度条。 */
  progress: UIProgress;
  /** 图形。 */
  graph: UIGraph;
  /** 标签。 */
  label: UILabel;
  /** 滑动条。 */
  slider: UISlider;
  /** 下拉框。 */
  combobox: UIComboBox;
  /** 序列帧动画。 */
  movieclip: UIMovieClip;
  /** 树。 */
  tree: UITree;
}

/** 控件类型名。 */
export type UIKind = keyof UIKinds;
