// MVC 框架对外的类型：绑定表、按键表、View 的固定信息。写法以 references/mvc-spec.md 为准。
import type {
  UIComponent, UIText, UIRichText, UIInput, UIButton, UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph,
  UILabel, UISlider, UIComboBox, UIMovieClip, UITree
} from '../core/index';

/** 5 层，从下到上。 */
export type Layer = 'hud' | 'page' | 'popup' | 'modal' | 'toast';
/** 游戏场景要不要同时接收输入。 */
export type InputMode = 'ui' | 'game' | 'all';
/** 当前的输入设备类型。 */
export type InputType = 'keyboardMouse' | 'touch';
/** 屏幕方向。 */
export type Orientation = 'landscape' | 'portrait';

/** 能被 pick 读的数据源：Model、请求对象，或者任何有 get 和 subscribe 的东西。 */
export interface Readable<T> {
  /** 当前值。 */
  get(): T;
  /** 值变了时调用，返回取消函数。 */
  subscribe(listener: () => void): () => void;
}

/** pick 的结果：告诉框架监听哪个数据源、取哪个字段。 */
export interface Picked<T> extends Readable<T> {
  /** 内部标记。 */
  readonly __picked: true;
}

/** 显示类的值：固定值或 pick。 */
export type Value<T> = T | Picked<T>;

/** 动作：调用一个 Controller 方法，可以返回 Promise（配合 lockWhilePending）。 */
export type Action<Args extends unknown[] = []> = (...args: Args) => unknown;

/** 拖拽手势。坐标和位移都是设计尺寸。 */
export interface DragGesture {
  /** 开始、移动、结束。 */
  phase: 'start' | 'move' | 'end';
  /** 当前 x。 */
  x: number;
  /** 当前 y。 */
  y: number;
  /** 从开始到现在的横向位移。 */
  dx: number;
  /** 从开始到现在的纵向位移。 */
  dy: number;
  /** 结束时：是不是被取消的（比如来电、指针被系统收走），不是用户松手。 */
  cancelled?: boolean;
}

/** 滑动手势（抬起时速度够快）。 */
export interface SwipeGesture {
  /** 横向位移。 */
  dx: number;
  /** 纵向位移。 */
  dy: number;
  /** 抬起时的横向速度（像素/毫秒）。 */
  vx: number;
  /** 抬起时的纵向速度（像素/毫秒）。 */
  vy: number;
}

/** 双指缩放手势。 */
export interface PinchGesture {
  /** 开始、移动、结束。 */
  phase: 'start' | 'move' | 'end';
  /** 相对开始时两指距离的比例。 */
  scale: number;
}

/** 滚轮。 */
export interface WheelGesture {
  /** 横向滚动量。 */
  dx: number;
  /** 纵向滚动量。 */
  dy: number;
}

/** 缓动名：和 ui/ 的 XML 一样（ease="Quad.Out"），对应 FairyGUI 的 31 个 EaseType（不含 Custom）。 */
export type Ease =
  | 'Linear'
  | 'Sine.In' | 'Sine.Out' | 'Sine.InOut' | 'Quad.In' | 'Quad.Out' | 'Quad.InOut'
  | 'Cubic.In' | 'Cubic.Out' | 'Cubic.InOut' | 'Quart.In' | 'Quart.Out' | 'Quart.InOut'
  | 'Quint.In' | 'Quint.Out' | 'Quint.InOut' | 'Expo.In' | 'Expo.Out' | 'Expo.InOut'
  | 'Circ.In' | 'Circ.Out' | 'Circ.InOut' | 'Elastic.In' | 'Elastic.Out' | 'Elastic.InOut'
  | 'Back.In' | 'Back.Out' | 'Back.InOut' | 'Bounce.In' | 'Bounce.Out' | 'Bounce.InOut';

/** 代码补间的属性（this.tween 的终值、选项里的 from）。只有 dx、dy 是相对 ui/ 里位置的偏移，其余都是绝对值。 */
export interface TweenProps {
  /** 横向偏移（设计尺寸的像素），0 是 ui/ 里的位置。 */
  dx?: number;
  /** 纵向偏移（设计尺寸的像素），0 是 ui/ 里的位置。 */
  dy?: number;
  /** 缩放倍数，等于同时写 scaleX 和 scaleY（不能和它们写在一起）。 */
  scale?: number;
  /** 横向缩放倍数。 */
  scaleX?: number;
  /** 纵向缩放倍数。 */
  scaleY?: number;
  /** 旋转（度）。 */
  rotation?: number;
  /** 透明度 0–1（中间值夹在 0–1）。 */
  alpha?: number;
  /** 宽（设计尺寸的像素），会重新排版。 */
  width?: number;
  /** 高（设计尺寸的像素），会重新排版。 */
  height?: number;
  /** 颜色 #rrggbb：文字的字色；按钮、标签的标题颜色；图片、加载器、序列帧的着色（白色是原色）；图形的填充色。 */
  color?: string;
  /** 字号（像素，每帧取整）：文字；按钮、标签的标题。会重新排版。 */
  fontSize?: number;
  /** 填充比例 0–1：图片、加载器（ui/ 里要先设了填充方式）。 */
  fillAmount?: number;
  /** 进度条的值 0–100。 */
  progress?: number;
  /** 显示到第几个字（打字机，每帧向下取整）：文字；按钮、标签的标题。 */
  chars?: number;
}

/** 代码补间的选项。 */
export interface TweenOptions {
  /** 毫秒，必填；有重复时是一轮的时长。 */
  duration: number;
  /** 缓动，默认 'Quad.Out'。 */
  ease?: Ease;
  /** 毫秒，只在开头等一次；目标是数组时可以按序号算。 */
  delay?: number | ((index: number) => number);
  /** 起点：调用时马上生效，在 delay 之前。 */
  from?: TweenProps;
  /** 再重复几次，-1 一直循环。 */
  repeat?: number;
  /** 重复时来回走（第 2、4、6… 轮倒着走）。 */
  yoyo?: boolean;
}

/** 绑定的 roll：数值从旧值平滑滚到新值。 */
export interface RollOptions {
  /** 毫秒。 */
  duration: number;
  /** 缓动，默认 'Quad.Out'。 */
  ease?: Ease;
}

/** 所有控件都能用的词。 */
export interface CommonBinding {
  /** 每隔这么多毫秒重新算一遍这一项的显示值（倒计时），结果变了才写；被盖住时不算，露出来马上算一次。 */
  tick?: number;
  /** 是否显示。 */
  visible?: Value<boolean>;
  /** 是否可用；false 时变灰、不可点。 */
  enabled?: Value<boolean>;
  /** 只在这些输入类型下显示。 */
  visibleOn?: readonly InputType[];
  /** 红点路径（控件里要有 redDot 子控件）。ItemView 里可以写成函数，按这一项返回路径。 */
  redDot?: string;
  /** 点击。 */
  click?: Action;
  /** 双击。 */
  doubleClick?: Action;
  /** 长按满 ms 毫秒才执行。 */
  hold?: {ms: number; action: Action};
  /** 拖拽。 */
  drag?: Action<[DragGesture]>;
  /** 滑动。 */
  swipe?: Action<[SwipeGesture]>;
  /** 双指缩放。 */
  pinch?: Action<[PinchGesture]>;
  /** 滚轮。 */
  wheel?: Action<[WheelGesture]>;
  /** 鼠标移入（true）或移出（false），触屏没有。 */
  hover?: Action<[boolean]>;
  /** 动作返回的 Promise 结束前保持锁住。 */
  lockWhilePending?: boolean;
  /** 拖放：能拖起来，值是松手时交给 drop 的数据；null 表示这时拖不起来（比如空格子）。 */
  dragData?: Value<unknown>;
  /** 拖起时跟手的图标（图片地址），不写时用加载器自己的图片或按钮的图标。 */
  dragIcon?: Value<string>;
  /** 拖放：别的控件拖到这里松手时调用，参数是那边的 dragData；写在 ItemView 里时第二个参数是这一项的数据。 */
  drop?: (data: never, item: never) => unknown;
}

/** 文字、富文本、输入框、ArtText。 */
export interface TextBinding extends CommonBinding {
  /** 显示的文字。 */
  text?: Value<string>;
  /** 数字平滑滚动：text 的 pick 取出数字，格式化函数每帧对滚动中的数字调用一次。不能写在 ItemView 里。 */
  roll?: RollOptions;
}

/** 输入框。 */
export interface InputBinding extends TextBinding {
  /** 用户改了文字时调用（输入法还在选字时不调用），参数是新文字。 */
  input?: Action<[string]>;
}

/** 标签（扩展类型 Label）。 */
export interface LabelBinding extends CommonBinding {
  /** 标题。 */
  text?: Value<string>;
  /** 数字平滑滚动：text 的 pick 取出数字。不能写在 ItemView 里。 */
  roll?: RollOptions;
  /** 图标地址。 */
  icon?: Value<string>;
  /** 交给一个部件 View（按钮、标签做成的部件，比如货币栏、弹窗边框）。 */
  view?: PartViewClass;
}

/** 按钮。 */
export interface ButtonBinding extends LabelBinding {
  /** 是否选中：只用于 Check（开关）、Radio（单选）按钮，显示 Model 的值；用户点击时 click 交给 Controller 改。 */
  selected?: Value<boolean>;
}

/** 加载器。 */
export interface LoaderBinding extends CommonBinding {
  /** 图片地址。 */
  icon?: Value<string>;
  /** 加载中和失败时显示的占位图，不写用工程配置的默认占位图。 */
  placeholder?: string;
}

/** 进度条。 */
export interface ProgressBinding extends CommonBinding {
  /** 0–100。 */
  progress?: Value<number>;
  /** 进度平滑滚动。不能写在 ItemView 里。 */
  roll?: RollOptions;
}

/** 滑动条。 */
export interface SliderBinding extends CommonBinding {
  /** 当前值（滑动条自己的单位，在 ui/ 里写的 min 和 max 之间）。 */
  value?: Value<number>;
  /** 用户拖动或点击改了值时调用，参数是新值。 */
  change?: Action<[number]>;
}

/** 下拉框。 */
export interface ComboBoxBinding extends CommonBinding {
  /** 每一项显示的文字。 */
  items?: Value<readonly string[]>;
  /** 选中项的序号，-1 表示没有选中。 */
  selected?: Value<number>;
  /** 用户选了一项时调用，参数是序号。 */
  select?: Action<[number]>;
}

/** 序列帧动画。 */
export interface MovieClipBinding extends CommonBinding {
  /** 是否播放。 */
  playing?: Value<boolean>;
}

/** 列表子项的 key。 */
export type ItemKey = string | number;

/** 列表。 */
export interface ListBinding extends CommonBinding {
  /** 数据。 */
  items?: Value<readonly unknown[]>;
  /** 子项用的 ItemView。 */
  item?: ItemViewClass;
  /** 认出同一项。 */
  key?: (item: never) => ItemKey;
  /** 选中项的 key。 */
  selected?: Value<ItemKey | null>;
  /** 用户点选时调用，参数是 key。 */
  select?: Action<[never]>;
}

/** 动效（键是动效名）。 */
export interface TransitionBinding {
  /** 为真就播（按 ui/ 里的播放次数，-1 一直循环），为假就停。 */
  playing?: Value<boolean>;
  /** 值每变一次就播一次（打开时的值不播），比如一个递增的计数。不能和 playing 一起写，不能写在 ItemView 里。 */
  play?: Value<unknown>;
  /** 一次播放正常放完时调用（被停掉、重播、界面关闭时不调用）。 */
  done?: Action;
}

/** 树：和列表同样的词；items 里每个节点的子节点放在 children 字段里，key 必须写。 */
export type TreeBinding = ListBinding;

/** 控制器。 */
export interface ControllerBinding<Page extends string> {
  /** 当前页。 */
  page?: Value<Page>;
  /** 用户切页时调用。 */
  change?: Action<[Page]>;
}

/** 子组件。 */
export interface ComponentBinding extends CommonBinding {
  /** 交给一个部件 View。 */
  view?: PartViewClass;
  /** ArtText 的文字。 */
  text?: Value<string>;
}

/** 按控件类型选绑定表里能用的词。 */
export type BindingFor<X> =
  X extends UIController<infer Page> ? ControllerBinding<Page> :
  X extends UITransition ? TransitionBinding :
  X extends UITree ? TreeBinding :
  X extends UIList ? ListBinding :
  X extends UIComboBox ? ComboBoxBinding :
  X extends UIButton ? ButtonBinding :
  X extends UILabel ? LabelBinding :
  X extends UISlider ? SliderBinding :
  X extends UIProgress ? ProgressBinding :
  X extends UILoader ? LoaderBinding :
  X extends UIImage ? CommonBinding :
  X extends UIMovieClip ? MovieClipBinding :
  X extends UIInput ? InputBinding :
  X extends UIRichText | UIText ? TextBinding :
  X extends UIGraph ? CommonBinding :
  X extends UIComponent ? ComponentBinding :
  never;

/** View 的绑定表：键是 ui/ 里真实存在的名字。 */
export type Bind<UI> = {[K in Exclude<keyof UI, '__component'>]?: BindingFor<UI[K]>};

/** ItemView 里的值：传入这一项的数据，返回要显示的内容。 */
export type ItemValue<Data, T> = T | ((item: Data) => T);

/** ItemView 里原样写的词（不是显示类的值）。 */
type ItemKeep = 'visibleOn' | 'placeholder' | 'lockWhilePending' | 'drop' | 'drag' | 'swipe' | 'pinch' | 'wheel' | 'hover' | 'input' | 'change' | 'select' | 'view' | 'item' | 'key' | 'done' | 'tick';

/** 把一种绑定里的 Value 换成 ItemValue；点击、双击、长按的动作参数是这一项的数据；红点路径可以按这一项算；roll 不能写（子项会被重复使用，认不出旧值）。 */
type ForItem<B, Data> = {[K in keyof B as K extends 'roll' ? never : K]:
  K extends 'click' | 'doubleClick' ? Action<[Data]> :
  K extends 'hold' ? {ms: number; action: Action<[Data]>} :
  K extends 'redDot' ? ItemValue<Data, string> :
  K extends ItemKeep ? B[K] :
  B[K] extends Value<infer T> | undefined ? ItemValue<Data, T> | undefined : B[K]};

/** ItemView 的绑定表。 */
export type ItemBind<UI, Data> = {[K in Exclude<keyof UI, '__component'>]?: ForItem<BindingFor<UI[K]>, Data>};

/** 按键动作。 */
export interface KeyAction {
  /** 要做的事。 */
  do: Action;
  /** 操作提示栏里的提示文字（文本键）。 */
  hint?: string;
}

/** 按键表。 */
export interface Keys {
  /** 返回键：'close' 关闭自己（默认）、'none' 不让返回，或者一个函数。 */
  back?: 'close' | 'none' | Action;
  /** 其他动作，比如 confirm。 */
  [action: string]: KeyAction | 'close' | 'none' | Action | undefined;
}

/** 生命周期钩子。 */
export interface ViewHooks<Params> {
  /** 界面打开，资源准备好、绑定完成之后。 */
  onOpen?(params: Params): void;
  /** 变成激活的界面时。 */
  onActivate?(): void;
  /** 被别的界面压住时。 */
  onDeactivate?(): void;
  /** 被全屏界面盖住时。 */
  onCovered?(): void;
  /** 重新露出来时。 */
  onRevealed?(): void;
  /** 屏幕方向变了时（平时换版由框架处理）。 */
  onOrientationChange?(orientation: Orientation): void;
  /** 界面关闭前。 */
  onClose?(): void;
}

/** View 类（构造函数加 7 项固定信息）。 */
export interface ViewClass<Instance = object> {
  /** 构造。 */
  new (): Instance;
  /** 对应的「包/组件」。 */
  component: string;
  /** 放在哪一层。 */
  layer: Layer;
  /** 是不是全屏。 */
  fullScreen?: boolean;
  /** 打开时能传的参数。 */
  params?: object;
  /** 关闭时可以交回的东西（只写类型）。 */
  result?: unknown;
  /** 游戏场景要不要同时接收输入。 */
  inputMode?: InputMode;
  /** 全屏又没有竖版时写 true。 */
  bothOrientations?: boolean;
}

/** ItemView 类。 */
export interface ItemViewClass {
  /** 构造。 */
  new (): object;
  /** 对应的「包/组件」。 */
  component: string;
}

/** PartView 类。 */
export interface PartViewClass {
  /** 构造。 */
  new (): object;
  /** 对应的「包/组件」。 */
  component: string;
}

/** 打开某个 View 时能传的参数类型。 */
export type ParamsOf<V> = V extends {params: infer P} ? P : undefined;
/** 关闭某个 View 时能交回的东西的类型。 */
export type ResultOf<V> = V extends {result: infer R} ? R : undefined;
