// headless 后端的 UI 对象：按 headless 描述建控件树，只模拟属性和显示齿轮，不算布局、不渲染。
// 规则（虚拟列表要能滚动、按钮和标签的文字写进 title 子控件、输入框的 maxLength……）照浏览器里的 FairyGUI 执行；
// 布局算出来的位置和尺寸（关联、列表和组的排布、文字和加载器的自动大小、gearXY / gearSize）不算，记下原因，测试读到时报 LGUI-RT-260；
// 改属性的齿轮（gearText、gearColor、gearIcon、gearLook）也不模拟，读到它们管的属性时报 LGUI-RT-260。
import type {
  PointerInput, Rect, UIObject, UIComponent, UIText, UIInput, UIButton, UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph, UIKind, Unsubscribe,
  UILabel, UISlider, UIComboBox, UIMovieClip, UITree, UITreeNode, WheelInput, TweenProp, TransitionTouch
} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import type {ChildDescriptor, ComponentDescriptor, GearsDescriptor, LayoutDescriptor, PropGear} from './descriptor';

// 一组回调。
export class Handlers<T> {
  private set = new Set<(value: T) => void>();
  add(handler: (value: T) => void): Unsubscribe { this.set.add(handler); return () => { this.set.delete(handler); }; }
  emit(value: T): void { for (const handler of [...this.set]) handler(value); }
  get size(): number { return this.set.size; }
}

/** 按「包/组件」名找组件描述；找不到报错。 */
export type Lookup = (name: string) => ComponentDescriptor;

/** 组：不在控件树里，只管组里控件的显隐（和 FairyGUI 一样，组被藏起来时组里的控件都不显示）。 */
export class HeadlessGroup {
  visible = true;
  gearVisible = true;
  group: HeadlessGroup | null = null;
  /** 组会挪动组里的控件时写着原因（自动排布、组自己的关联、gearXY），否则是 null。 */
  moves: string | null = null;
  /** 组会改组里控件的尺寸时写着原因（有自动排布的组上的 gearSize），否则是 null。 */
  resizes: string | null = null;
  constructor(readonly name: string) {}
  shown(): boolean { return this.visible && this.gearVisible && (!this.group || this.group.shown()); }
}

/** 位置、尺寸由 headless 不算的布局决定时写着原因，null 是 ui/ 里写的值或者框架自己摆的（和网页一致）。 */
export interface LayoutUnknown {
  position: string | null;
  size: string | null;
}

/**
 * 改属性的齿轮管着的属性：值跟着控制器的页变，headless 不模拟，写着是哪个齿轮。text 是文字（gearText），color 是颜色（gearColor），
 * icon 是图标、加载器的地址（gearIcon），look 是可用、能不能点（gearLook，还管透明度和旋转）。
 * 代码写过这个属性以后就知道了（FairyGUI 把写的值记成当前页的），这个控制器再换页又不知道。
 */
export type PropUnknown = Partial<Record<'text' | 'color' | 'icon' | 'look' | 'fontSize', string>>;
const PROP_OF: Record<PropGear, keyof PropUnknown> = {gearText: 'text', gearColor: 'color', gearIcon: 'icon', gearLook: 'look', gearFontSize: 'fontSize'};

/** 颜色 #rrggbb ↔ 0xrrggbb（代码补间按数字插值）。 */
const colorNumber = (value: string): number => parseInt(value.replace('#', '').slice(-6), 16) || 0;
const colorText = (value: number): string => '#' + (Math.round(value) & 0xffffff).toString(16).padStart(6, '0');

export class HeadlessObject implements UIObject {
  visible = true;
  /** 内部用：已经销毁了（所在的组件销毁时一起打上）。 */
  disposed = false;
  /** 轴心（0–1）。 */
  pivot = {x: 0, y: 0};
  /** 缩放。 */
  scaleX = 1;
  scaleY = 1;
  /** 旋转（度）。 */
  rotation = 0;
  /** 透明度。 */
  alpha = 1;
  /** 内部用：改位置、尺寸、透明度、颜色、字号的齿轮（代码补间碰它们管的属性报 LGUI-RT-282）。 */
  gearOwners: Partial<Record<TweenProp | 'text', string>> = {};
  /** 内部用：代码补间能读写哪些属性。 */
  supports(prop: TweenProp): boolean { return ['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotation', 'alpha'].includes(prop); }
  /** 内部用：读一个属性（位置、尺寸就是 rect；gearLook 管着的透明度、旋转报 LGUI-RT-260）。 */
  getProp(prop: TweenProp): number {
    switch (prop) {
      case 'x': return this.box.x;
      case 'y': return this.box.y;
      case 'width': return this.box.width;
      case 'height': return this.box.height;
      case 'scaleX': return this.scaleX;
      case 'scaleY': return this.scaleY;
      case 'rotation': this.checkProp('look', '旋转'); return this.rotation;
      case 'alpha': this.checkProp('look', '透明度'); return this.alpha;
      default: throw new LgRuntimeError('LGUI-RT-280', `${this.path()} 没有属性 ${prop}。`, '换一个有这个属性的控件。');
    }
  }
  /** 内部用：只改这一个属性。位置、尺寸直接改 rect（不当作「框架摆过」：关联、齿轮决定的位置照样不知道）。 */
  setProp(prop: TweenProp, value: number): void {
    switch (prop) {
      case 'x': this.box.x = value; break;
      case 'y': this.box.y = value; break;
      case 'width': this.box.width = value; break;
      case 'height': this.box.height = value; break;
      case 'scaleX': this.scaleX = value; break;
      case 'scaleY': this.scaleY = value; break;
      case 'rotation': this.rotation = value; break;
      case 'alpha': this.alpha = value; break;
      default: throw new LgRuntimeError('LGUI-RT-280', `${this.path()} 没有属性 ${prop}。`, '换一个有这个属性的控件。');
    }
  }
  /** 内部用：这个属性归哪个齿轮管。 */
  ownerOf(prop: TweenProp | 'text'): string | null { return this.gearOwners[prop] ?? null; }
  private isEnabled = true;
  private isTouchable = true;
  /** 内部用：改属性的齿轮管着、headless 不知道的属性（见 PropUnknown）。 */
  unknownProps: PropUnknown = {};
  get enabled(): boolean { this.checkProp('look', '可用状态'); return this.isEnabled; }
  set enabled(value: boolean) { this.isEnabled = value; this.knownProp('look'); }
  get touchable(): boolean { this.checkProp('look', '能不能点'); return this.isTouchable; }
  set touchable(value: boolean) { this.isTouchable = value; this.knownProp('look'); }
  /** 内部用：要用的属性由改属性的齿轮决定时报 LGUI-RT-260（测试、游戏代码和框架读到都算：headless 给不出网页上的值）。 */
  checkProp(prop: keyof PropUnknown, what: string): void {
    const by = this.unknownProps[prop];
    if (!by) return;
    throw new LgRuntimeError('LGUI-RT-260', `headless 不模拟改属性的齿轮，读不了 ${this.path()} 的${what}：它由${by}决定，控制器换页后网页上会变，ui/ 里写的初始值不一定是网页上的结果。`, '要测它，用 lgui test --browser 在真浏览器里跑这个测试（同一套 t.* 写法）；代码自己写过这个属性以后 headless 就知道它，直到这个控制器再换页。');
  }
  /** 内部用：代码写了这个属性，当前页的值就是它。 */
  protected knownProp(prop: keyof PropUnknown): void { delete this.unknownProps[prop]; }
  /** 内部用：报错里写的控件路径（从界面的组件名开始，列表子项写成 list[序号]）。 */
  path(): string {
    const parts: string[] = [];
    for (let o: HeadlessObject | null = this; o && o.kind !== 'container'; o = o.parent) {
      if (o.parent instanceof HeadlessList) { parts.unshift(`${o.parent.name}[${o.name}]`); o = o.parent; }
      else parts.unshift(o.name);
    }
    return parts.join('.');
  }
  private box: Rect = {x: 0, y: 0, width: 0, height: 0};
  /** 内部用：哪些位置、尺寸 headless 不知道（见 LayoutUnknown）。框架写 rect 时清掉：框架自己算的位置和网页一致。 */
  unknownLayout: LayoutUnknown = {position: null, size: null};
  /** 位置和尺寸：ui/ 里写的初始值或框架摆的值。受布局影响的值在网页上会不一样，测试读它们走 Harness（LGUI-RT-260）。 */
  get rect(): Rect { return {...this.box}; }
  set rect(value: Rect) { this.box = {x: value.x, y: value.y, width: value.width, height: value.height}; this.unknownLayout = {position: null, size: null}; }
  customData = '';
  parent: HeadlessComponent | null = null;
  /** 内部用：被显示齿轮藏起来时是 false（FairyGUI 的 internalVisible）。 */
  gearVisible = true;
  /** 内部用：所在的组。 */
  group: HeadlessGroup | null = null;
  readonly pointer = new Handlers<PointerInput>();
  readonly wheels = new Handlers<WheelInput>();
  constructor(readonly name: string, readonly kind: UIKind | 'container') {}
  onPointer(handler: (event: PointerInput) => void): Unsubscribe { return this.pointer.add(handler); }
  /** 模拟操作最后一次把指针事件发给了哪个控件（headless 不算布局，「指针下面是谁」就是它）。 */
  static pointerTarget: HeadlessObject | null = null;
  hitDepth(): number {
    let depth = 0;
    for (let o = HeadlessObject.pointerTarget; o; o = o.parent, depth++) if (o === this) return depth;
    return -1;
  }
  onWheel(handler: (event: WheelInput) => void): Unsubscribe { return this.wheels.add(handler); }
  /** 自己和各级父组件都显示，也没有被齿轮或组藏起来。 */
  get shown(): boolean {
    for (let o: HeadlessObject | null = this; o; o = o.parent) if (!o.visible || !o.gearVisible || (o.group && !o.group.shown())) return false;
    return true;
  }
  /** 内部用：设计尺寸下在屏幕上的位置（各级父组件的位置相加）。 */
  globalRect(): Rect {
    let {x, y} = this.box;
    for (let p = this.parent; p; p = p.parent) { x += p.box.x; y += p.box.y; }
    return {x, y, width: this.box.width, height: this.box.height};
  }
  /** 内部用：真的显示着，自己和各级父组件也都可用、接收输入时才能点到。 */
  reachable(): boolean {
    if (!this.shown) return false;
    for (let o: HeadlessObject | null = this; o; o = o.parent) if (!o.enabled || !o.touchable) return false;
    return true;
  }
}

export class HeadlessComponent extends HeadlessObject implements UIComponent {
  readonly children: HeadlessObject[] = [];
  readonly controllers = new Map<string, HeadlessController>();
  readonly transitions = new Map<string, HeadlessTransition>();
  constructor(name: string, readonly componentName: string, kind: UIKind | 'container' = 'component') { super(name, kind); }
  child(path: string): UIObject | null {
    let current: HeadlessObject | null = this;
    for (const part of path.split('.')) {
      if (!(current instanceof HeadlessComponent)) return null;
      current = current.children.find(c => c.name === part) ?? null;
      if (!current) return null;
    }
    return current;
  }
  controller(name: string): UIController | null { return this.controllers.get(name) ?? null; }
  transition(name: string): UITransition | null { return this.transitions.get(name) ?? null; }
  allTransitions(): readonly UITransition[] { return [...this.transitions.values()]; }
  childNames(): readonly string[] { return this.children.map(c => c.name); }
  addChild(child: UIObject): void {
    const object = asHeadless(child);
    object.parent?.removeChild(object);
    this.children.push(object);
    object.parent = this;
  }
  removeChild(child: UIObject): void {
    const object = asHeadless(child);
    const index = this.children.indexOf(object);
    if (index >= 0) this.children.splice(index, 1);
    object.parent = null;
  }
  dispose(): void {
    this.disposed = true;
    for (const t of this.transitions.values()) t.stop();
    this.parent?.removeChild(this);
    for (const c of [...this.children]) { if (c instanceof HeadlessComponent) c.dispose(); else c.disposed = true; }
    this.children.length = 0;
  }
}

class HeadlessText extends HeadlessObject implements UIText {
  private value = '';
  private tint = '#ffffff';
  private size = 12;
  get text(): string { this.checkProp('text', '文字'); return this.value; }
  set text(value: string) { this.value = value; this.knownProp('text'); }
  get color(): string { this.checkProp('color', '颜色'); return this.tint; }
  set color(value: string) { this.tint = value; this.knownProp('color'); }
  /** 字号（像素）。 */
  get fontSize(): number { this.checkProp('fontSize', '字号'); return this.size; }
  set fontSize(value: number) { this.size = value; this.knownProp('fontSize'); }
  supports(prop: TweenProp): boolean { return prop === 'color' || prop === 'fontSize' || super.supports(prop); }
  getProp(prop: TweenProp): number { return prop === 'color' ? colorNumber(this.color) : prop === 'fontSize' ? this.fontSize : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (prop === 'color') this.color = colorText(value); else if (prop === 'fontSize') this.fontSize = value; else super.setProp(prop, value); }
}

// 按钮、标签的标题颜色、字号：和 FairyGUI 一样就是 title 子控件（文字）的颜色、字号；没有这个子控件就没有这两项。
function titleSupports(component: HeadlessComponent, prop: TweenProp): boolean {
  const t = titleChild(component);
  return (prop === 'color' || prop === 'fontSize') && t instanceof HeadlessText;
}

class HeadlessInput extends HeadlessText implements UIInput {
  promptText = '';
  /** 最多能输入几个字（UTF-16 长度，和浏览器的 maxlength 一样），0 是不限。只限制打字，代码写 text 不截断（和浏览器一样）。 */
  maxLength = 0;
  readonly changes = new Handlers<string>();
  onChange(handler: (text: string) => void): Unsubscribe { return this.changes.add(handler); }
}

// 和 FairyGUI 一样：按钮、标签、下拉框的文字显示在名为 title 的子控件里（文字控件写 text，标签、按钮写 title）；没有这个子控件就不显示。
export function titleChild(component: HeadlessComponent): HeadlessObject | null { return component.children.find(c => c.name === 'title') ?? null; }
function displayText(o: HeadlessObject): string {
  if (o instanceof HeadlessText) return o.text;
  if (o instanceof HeadlessLabel || o instanceof HeadlessButton) return o.title;
  return '';
}
function setDisplayText(o: HeadlessObject, value: string): void {
  if (o instanceof HeadlessText) o.text = value;
  else if (o instanceof HeadlessLabel || o instanceof HeadlessButton) o.title = value;
}

// 标签：和 FairyGUI 一样，title 就是 title 子控件的文字；没有 title 子控件时读到空字符串，写了也不显示。
// 标签自己的 gearText 改的也是 title 子控件的文字；title 子控件自己有 gearText 时，读它的文字报不支持。
class HeadlessLabel extends HeadlessComponent implements UILabel {
  private image = '';
  supports(prop: TweenProp): boolean { return titleSupports(this, prop) || super.supports(prop); }
  getProp(prop: TweenProp): number { return titleSupports(this, prop) ? (titleChild(this) as HeadlessText).getProp(prop) : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (titleSupports(this, prop)) (titleChild(this) as HeadlessText).setProp(prop, value); else super.setProp(prop, value); }
  ownerOf(prop: TweenProp | 'text'): string | null { return super.ownerOf(prop) ?? (prop === 'text' || titleSupports(this, prop) ? (titleChild(this) as HeadlessObject | null)?.ownerOf(prop) ?? null : null); }
  get icon(): string { this.checkProp('icon', '图标'); return this.image; }
  set icon(value: string) { this.image = value; this.knownProp('icon'); }
  get title(): string { this.checkProp('text', '文字'); const t = titleChild(this); return t ? displayText(t) : ''; }
  set title(value: string) { this.knownProp('text'); const t = titleChild(this); if (t) setDisplayText(t, value); }
}

export class HeadlessSlider extends HeadlessComponent implements UISlider {
  value = 50;
  min = 0;
  max = 100;
  wholeNumbers = false;
  readonly changes = new Handlers<number>();
  onChange(handler: (value: number) => void): Unsubscribe { return this.changes.add(handler); }
  /** 内部用：用户把滑块移到 value。和 FairyGUI 一样夹在 min、max 之间，wholeNumbers 时取整；值变了才通知。 */
  move(value: number): void {
    let next = Math.min(this.max, Math.max(this.min, value));
    if (this.wholeNumbers) next = Math.round(next);
    if (next === this.value) return;
    this.value = next;
    this.changes.emit(next);
  }
}

export class HeadlessComboBox extends HeadlessComponent implements UIComboBox {
  private list: readonly string[] = [];
  private index = -1;
  readonly changes = new Handlers<number>();
  get items(): readonly string[] { return this.list; }
  set items(value: readonly string[]) { this.list = [...value]; this.selectedIndex = this.index; }
  get selectedIndex(): number { return this.index; }
  set selectedIndex(value: number) {
    this.index = value >= 0 && value < this.list.length ? value : -1;
    this.knownProp('text');
    // 和 FairyGUI 一样：选中项的文字写进 title 子控件。
    const title = this.children.find(c => c.name === 'title');
    if (title instanceof HeadlessText) title.text = this.text;
  }
  get text(): string { this.checkProp('text', '文字'); return this.list[this.index] ?? ''; }
  onChange(handler: (index: number) => void): Unsubscribe { return this.changes.add(handler); }
  /** 内部用：用户从弹出的列表里选了第 index 项。和 FairyGUI 一样，选的是原来那一项也通知。 */
  choose(index: number): void { this.selectedIndex = index; this.changes.emit(index); }
}

class HeadlessMovieClip extends HeadlessObject implements UIMovieClip {
  playing = true;
  frame = 0;
  /** 着色（白色是原色）。 */
  tint = '#ffffff';
  supports(prop: TweenProp): boolean { return prop === 'color' || super.supports(prop); }
  getProp(prop: TweenProp): number { return prop === 'color' ? colorNumber(this.tint) : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (prop === 'color') this.tint = colorText(value); else super.setProp(prop, value); }
}

// 按钮：和 FairyGUI 一样，title 自己记一份，同时写进 title 子控件（没有这个子控件就不显示）；一开始是 title 子控件自己的文字。
class HeadlessButton extends HeadlessComponent implements UIButton {
  private label = '';
  private image = '';
  sound = '';
  soundVolume = 1;
  mode = 'Common';
  /** ui/ 里按钮组件的按下效果。 */
  downEffect: UIButton['downEffect'] = {type: 'none', value: 0.8};
  /** 按下效果的缩放（框架接管 downEffect="scale" 后写）；t.look 读到的缩放乘上它。 */
  pressScale = 1;
  supports(prop: TweenProp): boolean { return titleSupports(this, prop) || super.supports(prop); }
  getProp(prop: TweenProp): number { return titleSupports(this, prop) ? (titleChild(this) as HeadlessText).getProp(prop) : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (titleSupports(this, prop)) (titleChild(this) as HeadlessText).setProp(prop, value); else super.setProp(prop, value); }
  ownerOf(prop: TweenProp | 'text'): string | null { return super.ownerOf(prop) ?? (prop === 'text' || titleSupports(this, prop) ? (titleChild(this) as HeadlessObject | null)?.ownerOf(prop) ?? null : null); }
  get icon(): string { this.checkProp('icon', '图标'); return this.image; }
  set icon(value: string) { this.image = value; this.knownProp('icon'); }
  get title(): string { this.checkProp('text', '文字'); return this.label; }
  set title(value: string) { this.label = value; this.knownProp('text'); const t = titleChild(this); if (t) setDisplayText(t, value); }
  /** 内部用：实例没写 title 时，和 FairyGUI 一样记下 title 子控件自己的文字（不写回去）；那段文字由齿轮决定时，按钮的 title 也不知道。 */
  adoptTitle(): void {
    const t = titleChild(this);
    if (!t) return;
    if (t.unknownProps.text) this.unknownProps.text = `title 子控件上的${t.unknownProps.text}`;
    else this.label = displayText(t);
  }
  private isSelected = false;
  // 和 FairyGUI 一样：Common 模式不保持选中；Check、Radio 选中时 button 控制器到 down 页，取消时回到 up 页。
  get selected(): boolean { return this.isSelected; }
  set selected(value: boolean) {
    if (this.mode === 'Common') return;
    this.isSelected = value;
    const controller = this.controllers.get('button');
    if (controller && controller.pages.includes('down') && controller.pages.includes('up')) controller.selectedPage = value ? 'down' : 'up';
  }
  /** 内部用：用户点了这个按钮。和 FairyGUI 一样：Check 模式切换选中，Radio 模式没选中时选中（列表、树的子项由列表管，不走这里）。 */
  clicked(): void {
    if (this.mode === 'Check') this.selected = !this.selected;
    else if (this.mode === 'Radio' && !this.selected) this.selected = true;
  }
}

// 图片、加载器共用：着色（白色是原色）和填充（ui/ 里设了填充方式才能补 fillAmount）。
function tintSupports(o: {fillMethod: UIImage['fillMethod']}, prop: TweenProp): boolean {
  return prop === 'color' || (prop === 'fillAmount' && o.fillMethod !== 'none');
}

class HeadlessImage extends HeadlessObject implements UIImage {
  fillMethod: UIImage['fillMethod'] = 'none';
  fillOrigin = 0;
  fillClockwise = true;
  fillAmount = 1;
  tint = '#ffffff';
  supports(prop: TweenProp): boolean { return tintSupports(this, prop) || super.supports(prop); }
  getProp(prop: TweenProp): number { return prop === 'color' ? colorNumber(this.tint) : prop === 'fillAmount' ? this.fillAmount : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (prop === 'color') this.tint = colorText(value); else if (prop === 'fillAmount') this.fillAmount = value; else super.setProp(prop, value); }
}

class HeadlessLoader extends HeadlessObject implements UILoader {
  private current = '';
  fillMethod: UIImage['fillMethod'] = 'none';
  fillAmount = 1;
  tint = '#ffffff';
  supports(prop: TweenProp): boolean { return tintSupports(this, prop) || super.supports(prop); }
  getProp(prop: TweenProp): number { return prop === 'color' ? colorNumber(this.tint) : prop === 'fillAmount' ? this.fillAmount : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (prop === 'color') this.tint = colorText(value); else if (prop === 'fillAmount') this.fillAmount = value; else super.setProp(prop, value); }
  readonly loads = new Handlers<void>();
  readonly errors = new Handlers<string>();
  /** 测试里设为 true 时，网络图片一律加载失败。 */
  static failExternal = false;
  // gearIcon 改的就是加载器的地址。
  get url(): string { this.checkProp('icon', '地址（图标）'); return this.current; }
  set url(value: string) {
    this.current = value;
    this.knownProp('icon');
    if (!value) return;
    // 图片在下一个微任务里「加载完成」，和真实后端一样是异步的。
    void Promise.resolve().then(() => {
      if (this.current !== value) return;
      if (HeadlessLoader.failExternal && !value.startsWith('ui://')) this.errors.emit(value);
      else this.loads.emit();
    });
  }
  onLoad(handler: () => void): Unsubscribe { return this.loads.add(() => handler()); }
  onError(handler: (url: string) => void): Unsubscribe { return this.errors.add(handler); }
}

export class HeadlessList extends HeadlessComponent implements UIList {
  itemRenderer: ((index: number, item: UIComponent) => void) | null = null;
  private isVirtual = false;
  private position = {x: 0, y: 0};
  // 和浏览器一样：只有能滚动的列表能设成虚拟列表，设了就不能改回去。
  get virtual(): boolean { return this.isVirtual; }
  set virtual(value: boolean) {
    if (value === this.isVirtual) return;
    if (!value) throw new LgRuntimeError('LGUI-RT-021', '列表一旦设成虚拟列表就不能改回去。', '在第一次给数据之前决定要不要虚拟列表。');
    if (!this.scrollable) throw new LgRuntimeError('LGUI-RT-261', `列表 ${this.name} 不能滚动（ui/ 里没写 overflow="scroll"），不能设成虚拟列表（浏览器里 FairyGUI 报 Virtual list must be scrollable!）。`, '要虚拟列表就在 ui/ 里给列表写 overflow="scroll"（不想显示滚动条再加 scrollBar="hidden"）；项数固定的短列表不用虚拟列表。');
    this.isVirtual = true;
  }
  // 和浏览器一样：不能滚动的列表滚动位置总是 0，设了也不动。
  get scrollPosition(): {x: number; y: number} { return {...this.position}; }
  set scrollPosition(value: {x: number; y: number}) { if (this.scrollable) this.position = {x: value.x, y: value.y}; }
  private selected = -1;
  /** 选中项：和 FairyGUI 一样同步到子项按钮（Check、Radio 模式的按钮才显示选中）。 */
  get selectedIndex(): number { return this.selected; }
  set selectedIndex(value: number) {
    this.selected = value;
    this.children.forEach((item, i) => { if (item instanceof HeadlessButton) item.selected = i === value; });
  }
  readonly clicks = new Handlers<number>();
  private count = 0;
  constructor(name: string, private readonly itemName: string | null, private readonly lookup: Lookup, private readonly tr: Translate | undefined, private readonly canScroll: boolean) { super(name, '', 'list'); }
  /** 能不能滚动：ui/ 里列表的 overflow 是 scroll（描述里的 scrollable）。 */
  get scrollable(): boolean { return this.canScroll; }
  get numItems(): number { return this.count; }
  set numItems(value: number) {
    // 不模拟虚拟列表的回收：按数量生成全部子项，结果和真实后端一致即可。
    if (value > 0 && !this.itemName) throw new LgRuntimeError('LGUI-RT-030', `列表 ${this.name} 没有设置子项组件（defaultItem）。`, '在 ui/ 里给列表设置 defaultItem。');
    while (this.children.length > value) (this.children[this.children.length - 1] as HeadlessComponent).dispose();
    while (this.children.length < value) {
      const item = buildComponent(this.lookup(this.itemName as string), this.lookup, String(this.children.length), undefined, undefined, this.tr);
      item.unknownLayout.position = '列表的排布';
      this.addChild(item);
    }
    this.count = value;
    if (this.selectedIndex >= value) this.selectedIndex = -1;
    if (this.itemRenderer) this.children.forEach((item, i) => this.itemRenderer?.(i, item as HeadlessComponent));
  }
  onClickItem(handler: (index: number) => void): Unsubscribe { return this.clicks.add(handler); }
  itemAt(index: number): UIComponent | null { return (this.children[index] as HeadlessComponent | undefined) ?? null; }
  scrollToView(index: number): void { void index; }
}

type Key = string | number;

/** 树：显示着的节点按顺序放在 children 里；收起的节点下面的子项组件留着，展开时放回来。 */
export class HeadlessTree extends HeadlessComponent implements UITree {
  nodeRenderer: ((key: Key, item: UIComponent) => void) | null = null;
  /** 0 点了不展开，1 单击展开或收起，2 双击（和 FairyGUI 的 clickToExpand 一样）。 */
  clickToExpand = 0;
  private roots: readonly UITreeNode[] = [];
  private selected: Key | null = null;
  private readonly expanded = new Map<Key, boolean>();
  private readonly cells = new Map<Key, HeadlessComponent>();
  private readonly keys = new Map<HeadlessObject, Key>();
  private lastClick: {cell: HeadlessObject | null; time: number} = {cell: null, time: -Infinity};
  readonly clicks = new Handlers<Key>();
  constructor(name: string, private readonly itemName: string | null, private readonly lookup: Lookup, private readonly tr?: Translate) { super(name, '', 'tree'); }
  setNodes(nodes: readonly UITreeNode[]): void {
    if (nodes.length && !this.itemName) throw new LgRuntimeError('LGUI-RT-030', `树 ${this.name} 没有设置子项组件（defaultItem）。`, '在 ui/ 里给树设置 defaultItem。');
    this.roots = nodes;
    const live = new Set<Key>();
    const walk = (list: readonly UITreeNode[]): void => { for (const node of list) { live.add(node.key); walk(node.children); } };
    walk(nodes);
    for (const [key, cell] of [...this.cells]) {
      if (live.has(key)) continue;
      this.cells.delete(key); this.keys.delete(cell); this.expanded.delete(key); cell.dispose();
    }
    if (this.selected !== null && !live.has(this.selected)) this.selected = null;
    this.layout();
  }
  get selectedKey(): Key | null { return this.selected; }
  set selectedKey(key: Key | null) {
    this.selected = key;
    // 和 FairyGUI 的 selectNode 一样：先展开各级父节点。
    const path = key === null ? null : this.pathTo(key, this.roots);
    for (const node of path?.slice(0, -1) ?? []) this.expanded.set(node.key, true);
    this.layout();
  }
  get numItems(): number { return this.children.length; }
  itemAt(index: number): UIComponent | null { return (this.children[index] as HeadlessComponent | undefined) ?? null; }
  onClickNode(handler: (key: Key) => void): Unsubscribe { return this.clicks.add(handler); }
  /** 内部用：用户点了一个节点。和 FairyGUI 一样：先选中，clickToExpand 是 1 时单击、2 时双击展开或收起，再通知。 */
  clickCell(cell: HeadlessObject, now: number): void {
    const key = this.keys.get(cell);
    if (key === undefined) return;
    const double = this.lastClick.cell === cell && now - this.lastClick.time < 350;
    this.lastClick = double ? {cell: null, time: -Infinity} : {cell, time: now};
    this.selected = key;
    const path = this.pathTo(key, this.roots);
    const node = path ? path[path.length - 1] : null;
    if (node?.children.length && (this.clickToExpand === 1 || (this.clickToExpand === 2 && double))) this.expanded.set(key, !(this.expanded.get(key) ?? true));
    this.layout();
    this.clicks.emit(key);
  }
  private pathTo(key: Key, list: readonly UITreeNode[]): UITreeNode[] | null {
    for (const node of list) {
      if (node.key === key) return [node];
      const rest = this.pathTo(key, node.children);
      if (rest) return [node, ...rest];
    }
    return null;
  }
  // 按展开状态排出显示着的节点，逐个渲染，再把选中状态同步到子项按钮。
  private layout(): void {
    const shown: HeadlessComponent[] = [];
    const walk = (list: readonly UITreeNode[]): void => {
      for (const node of list) {
        let cell = this.cells.get(node.key);
        if (!cell) {
          cell = buildComponent(this.lookup(this.itemName as string), this.lookup, String(node.key), undefined, undefined, this.tr);
          cell.unknownLayout.position = '树的排布';
          this.cells.set(node.key, cell);
          this.keys.set(cell, node.key);
        }
        shown.push(cell);
        if (node.children.length && (this.expanded.get(node.key) ?? true)) walk(node.children);
      }
    };
    walk(this.roots);
    for (const c of [...this.children]) if (!shown.includes(c as HeadlessComponent)) this.removeChild(c);
    for (const c of shown) this.addChild(c);
    for (const c of shown) {
      if (c instanceof HeadlessButton) c.selected = this.keys.get(c) === this.selected;
      this.nodeRenderer?.(this.keys.get(c) as Key, c);
    }
  }
}

class HeadlessProgress extends HeadlessComponent implements UIProgress {
  value = 0;
  max = 100;
  supports(prop: TweenProp): boolean { return prop === 'progress' || super.supports(prop); }
  getProp(prop: TweenProp): number { return prop === 'progress' ? (this.max ? this.value / this.max * 100 : 0) : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (prop === 'progress') this.value = value / 100 * this.max; else super.setProp(prop, value); }
}

class HeadlessGraph extends HeadlessObject implements UIGraph {
  private tint = '#ffffff';
  get color(): string { this.checkProp('color', '颜色'); return this.tint; }
  set color(value: string) { this.tint = value; this.knownProp('color'); }
  supports(prop: TweenProp): boolean { return prop === 'color' || super.supports(prop); }
  getProp(prop: TweenProp): number { return prop === 'color' ? colorNumber(this.color) : super.getProp(prop); }
  setProp(prop: TweenProp, value: number): void { if (prop === 'color') this.color = colorText(value); else super.setProp(prop, value); }
}

export class HeadlessController implements UIController {
  readonly changes = new Handlers<string>();
  private page: string;
  constructor(readonly name: string, readonly pages: readonly string[], selected: string | null) { this.page = selected ?? pages[0] ?? ''; }
  get selectedPage(): string { return this.page; }
  set selectedPage(value: string) {
    if (!this.pages.includes(value)) throw new LgRuntimeError('LGUI-RT-022', `控制器 ${this.name} 没有页 ${value}。`, `能用的页：${this.pages.join('、')}。`);
    if (value === this.page) return;
    this.page = value;
    this.changes.emit(value);
  }
  onChange(handler: (page: string) => void): Unsubscribe { return this.changes.add(handler); }
}

// 动效：按 headless 描述里的时长走假时钟（每帧回调），暂停时不走；放完才调用 onComplete，和网页一致。
export class HeadlessTransition implements UITransition {
  /** 每帧回调的来源（headless 后端创建时设置）。 */
  static frames: Handlers<number> | null = null;
  playing = false;
  paused = false;
  /** 播放过几次（测试断言用）。 */
  plays = 0;
  private stopFrames: Unsubscribe | null = null;
  /** 内部用：动效所在的组件和每一项（控件名，组件自己是 null）。 */
  owner: HeadlessComponent | null = null;
  items: readonly {target: string | null; what: TransitionTouch}[] = [];
  constructor(readonly name: string, private readonly ms: number, readonly settings: UITransition['settings']) {}
  touches(): readonly {target: UIObject; what: TransitionTouch}[] {
    const owner = this.owner;
    if (!owner) return [];
    return this.items.flatMap(item => { const target = item.target === null ? owner : owner.child(item.target); return target ? [{target, what: item.what}] : []; });
  }
  play(options: {times?: number; delay?: number} = {}, onComplete?: () => void): void {
    this.halt();
    this.plays++;
    this.playing = true;
    const times = options.times ?? 1;
    // 和 FairyGUI 一样：时长是 0 的动效当场放完；一直循环或有一项一直重复的永远放不完。
    const total = times < 0 || this.ms < 0 ? Infinity : (options.delay ?? 0) + this.ms * times;
    if (total <= 0) { this.halt(); onComplete?.(); return; }
    const frames = HeadlessTransition.frames;
    if (!frames) throw new LgRuntimeError('LGUI-RT-027', 'headless 后端还没有创建，动效没有时钟。', '先调用 createHeadlessBackend。');
    let elapsed = 0;
    this.stopFrames = frames.add(dt => {
      if (this.paused) return;
      elapsed += dt;
      if (elapsed < total) return;
      this.halt();
      onComplete?.();
    });
  }
  stop(): void { this.halt(); }
  setPaused(paused: boolean): void { if (this.playing) this.paused = paused; }
  private halt(): void {
    this.stopFrames?.();
    this.stopFrames = null;
    this.playing = false;
    this.paused = false;
  }
}

export function asHeadless(object: UIObject): HeadlessObject {
  if (!(object instanceof HeadlessObject)) throw new LgRuntimeError('LGUI-RT-024', `${object.name} 不是 headless 后端创建的对象。`, '不要混用不同后端的对象。');
  return object;
}

/** 翻译：组件的「包ID+组件ID」和当前语言的翻译表。 */
export interface Translate {
  owners: Map<string, string>;
  translation: Record<string, string>;
}

function buildChild(child: ChildDescriptor, lookup: Lookup, owner: string | undefined, tr: Translate | undefined): HeadlessObject {
  // 按当前语言的翻译改写固定文字（FairyGUI 在创建组件时做同样的事）。
  const key = owner && child.elementId ? `${owner}-${child.elementId}` : null;
  const translated = key && tr ? tr.translation[key] : undefined;
  const prompt = key && tr ? tr.translation[`${key}-prompt`] : undefined;
  const p = {...child.props};
  if (translated !== undefined) { if (child.kind === 'button' || child.kind === 'label') p.title = translated; else p.text = translated; }
  if (prompt !== undefined) p.promptText = prompt;
  // 下拉框的固定选项：第 j 项的翻译名是 <元素ID>-<j>（和 FairyGUI 一样）。
  if (key && tr && child.kind === 'combobox' && p.items) p.items = p.items.map((item, j) => tr.translation[`${key}-${j}`] ?? item);
  let object: HeadlessObject;
  switch (child.kind) {
    case 'text': case 'richtext': { const t = new HeadlessText(child.name, child.kind); t.text = p.text ?? ''; object = t; break; }
    case 'input': { const t = new HeadlessInput(child.name, 'input'); t.text = p.text ?? ''; t.promptText = p.promptText ?? ''; t.maxLength = p.maxLength ?? 0; object = t; break; }
    case 'image': object = new HeadlessImage(child.name, 'image'); break;
    case 'loader': { const l = new HeadlessLoader(child.name, 'loader'); if (p.url) l.url = p.url; object = l; break; }
    case 'graph': { const g = new HeadlessGraph(child.name, 'graph'); g.color = p.color ?? '#ffffff'; object = g; break; }
    case 'list': object = new HeadlessList(child.name, child.defaultItem, lookup, tr, p.scrollable === true); break;
    case 'tree': { const t = new HeadlessTree(child.name, child.defaultItem, lookup, tr); t.clickToExpand = p.clickToExpand ?? 0; object = t; break; }
    case 'movieclip': { const m = new HeadlessMovieClip(child.name, 'movieclip'); m.playing = p.playing ?? true; m.frame = p.frame ?? 0; object = m; break; }
    default: {
      if (!child.ref) throw new LgRuntimeError('LGUI-RT-031', `子组件 ${child.name} 引用的组件不存在。`, '在 ui/ 里修好这个子组件的引用，再重新生成。');
      object = buildComponent(lookup(child.ref), lookup, child.name, child.kind, p, tr);
    }
  }
  object.visible = p.visible;
  if (p.pivot) object.pivot = {x: p.pivot[0], y: p.pivot[1]};
  if (p.scale) [object.scaleX, object.scaleY] = p.scale;
  if (p.rotation !== undefined) object.rotation = p.rotation;
  if (p.alpha !== undefined) object.alpha = p.alpha;
  if (object instanceof HeadlessText) { if (p.color) object.color = p.color; if (p.fontSize !== undefined) object.fontSize = p.fontSize; }
  if ((object instanceof HeadlessImage || object instanceof HeadlessLoader || object instanceof HeadlessMovieClip) && p.color) object.tint = p.color;
  if ((object instanceof HeadlessImage || object instanceof HeadlessLoader) && p.fillMethod) { object.fillMethod = p.fillMethod; object.fillAmount = p.fillAmount ?? 1; }
  object.customData = p.customData ?? '';
  object.enabled = p.enabled;
  object.touchable = p.touchable;
  const [x, y, width, height] = child.rect;
  object.rect = {x, y, width, height};
  markLayout(object, child.layout, p.autoSize);
  return object;
}

// 关联的 sidePair 改的是位置还是尺寸（结尾的 % 是按比例，一样算）：leftext、topext 挪边，位置和尺寸都改。
const MOVES = /^(left|right|center|top|middle|bottom|leftext|topext)-/;
const RESIZES = /^(width|height|leftext|rightext|topext|bottomext)-/;

// 记下这个控件哪些位置、尺寸 headless 不算：关联、gearXY / gearSize、文字自动大小（both、height）、加载器的自动大小。
function markLayout(object: HeadlessObject, layout: LayoutDescriptor | undefined, autoSize: string | undefined): void {
  const unknown = object.unknownLayout;
  for (const pair of layout?.relations ?? []) {
    const moves = MOVES.test(pair), resizes = RESIZES.test(pair);
    const reason = `关联（relation ${pair}）`;
    if ((moves || !resizes) && !unknown.position) unknown.position = reason;
    if ((resizes || !moves) && !unknown.size) unknown.size = reason;
  }
  if (layout?.gearXY && !unknown.position) unknown.position = '改位置的齿轮（gearXY）';
  if (layout?.gearSize && !unknown.size) unknown.size = '改尺寸的齿轮（gearSize）';
  if (layout?.gearXY) object.gearOwners.x = object.gearOwners.y = '齿轮 gearXY';
  // gearSize 也管缩放（FairyGUI 的 GearSize 记的是宽、高和 scaleX、scaleY）。
  if (layout?.gearSize) object.gearOwners.width = object.gearOwners.height = object.gearOwners.scaleX = object.gearOwners.scaleY = '齿轮 gearSize';
  if (object.kind === 'loader') { if (autoSize === 'true' && !unknown.size) unknown.size = '加载器的自动大小（autoSize="true"，尺寸跟着图片）'; }
  else if ((autoSize === 'both' || autoSize === 'height') && !unknown.size) unknown.size = `文字的自动大小（autoSize="${autoSize}"）`;
}

// 改属性的齿轮：headless 不模拟，记下它管的属性不知道；这个控制器每次换页又不知道（FairyGUI 换页时按页改属性）。
function markPropGears(object: HeadlessObject, gears: GearsDescriptor | undefined, component: HeadlessComponent): void {
  for (const g of gears?.props ?? []) {
    const controller = component.controllers.get(g.controller);
    if (!controller) continue;
    const owner = `齿轮 ${g.gear}（控制器 ${g.controller}）`;
    const props: (TweenProp | 'text')[] = g.gear === 'gearText' ? ['text'] : g.gear === 'gearLook' ? ['alpha', 'rotation'] : g.gear === 'gearColor' ? ['color'] : g.gear === 'gearFontSize' ? ['fontSize'] : [];
    for (const prop of props) object.gearOwners[prop] = owner;
    const mark = (): void => { object.unknownProps[PROP_OF[g.gear]] = `改属性的齿轮 ${g.gear}（控制器 ${g.controller}）`; };
    mark();
    controller.changes.add(mark);
  }
}

// 显示齿轮：和 FairyGUI 一样，gearDisplay 定下显不显示，gearDisplay2 再按条件（0 并且、1 或者）合进去；控制器换页时重算。
function applyGears(target: {gearVisible: boolean}, gears: GearsDescriptor | undefined, component: HeadlessComponent): void {
  if (!gears) return;
  const on = (gear: {controller: string; pages: string[]} | undefined): boolean | null => {
    if (!gear) return null;
    const controller = component.controllers.get(gear.controller);
    return !controller || !gear.pages.length || gear.pages.includes(controller.selectedPage);
  };
  const update = (): void => {
    const first = on(gears.display) ?? true;
    const second = on(gears.display2);
    target.gearVisible = second === null ? first : gears.display2?.condition === 1 ? second || first : second && first;
  };
  update();
  for (const gear of [gears.display, gears.display2]) if (gear) component.controllers.get(gear.controller)?.changes.add(update);
}

/** 按描述建一个组件（连同全部子控件和子组件）。 */
export function buildComponent(descriptor: ComponentDescriptor, lookup: Lookup, name = descriptor.name, kind: UIKind = 'component', props?: ChildDescriptor['props'], tr?: Translate): HeadlessComponent {
  let component: HeadlessComponent;
  const extension = descriptor.extension;
  if (kind === 'button' || extension === 'Button') {
    const button = new HeadlessButton(name, descriptor.name, 'button');
    button.icon = props?.icon ?? '';
    button.mode = descriptor.buttonMode ?? 'Common';
    if (descriptor.downEffect) button.downEffect = {...descriptor.downEffect};
    // 和 FairyGUI 一样：实例上写的音效、音量各自优先，其次是按钮组件的。
    button.sound = props?.sound ?? descriptor.sound ?? '';
    button.soundVolume = props?.soundVolume ?? descriptor.soundVolume ?? 1;
    component = button;
  } else if (kind === 'progress' || descriptor.extension === 'ProgressBar') {
    const bar = new HeadlessProgress(name, descriptor.name, 'progress');
    bar.value = props?.value ?? 0;
    bar.max = props?.max ?? 100;
    component = bar;
  } else if (kind === 'label' || extension === 'Label') {
    const label = new HeadlessLabel(name, descriptor.name, 'label');
    label.icon = props?.icon ?? '';
    component = label;
  } else if (kind === 'slider' || extension === 'Slider') {
    const slider = new HeadlessSlider(name, descriptor.name, 'slider');
    slider.value = props?.value ?? 50;
    slider.max = props?.max ?? 100;
    slider.min = props?.min ?? 0;
    slider.wholeNumbers = descriptor.wholeNumbers ?? false;
    component = slider;
  } else if (kind === 'combobox' || extension === 'ComboBox') {
    component = new HeadlessComboBox(name, descriptor.name, 'combobox');
  } else {
    component = new HeadlessComponent(name, descriptor.name);
  }
  component.rect = {x: 0, y: 0, width: descriptor.size[0], height: descriptor.size[1]};
  if (descriptor.pivot) component.pivot = {x: descriptor.pivot[0], y: descriptor.pivot[1]};
  for (const c of descriptor.controllers) component.controllers.set(c.name, new HeadlessController(c.name, c.pages, c.selected));
  if (component instanceof HeadlessButton && props?.selected) component.selected = true;
  for (const t of descriptor.transitions) {
    const transition = new HeadlessTransition(t.name, t.ms, {autoPlay: t.autoPlay, times: t.times, delay: t.delay});
    transition.owner = component;
    transition.items = t.items ?? [];
    component.transitions.set(t.name, transition);
    // 自动播放：网页上组件放进界面时开始放，这里在创建时开始（UIManager 创建完马上就放进界面）。
    if (t.autoPlay) transition.play({times: t.times, delay: t.delay});
  }
  const owner = tr?.owners.get(descriptor.name);
  const groups = new Map<string, HeadlessGroup>();
  for (const g of descriptor.groups ?? []) {
    const group = new HeadlessGroup(g.name);
    group.visible = g.visible;
    if (g.layout) group.moves = `组 ${g.name} 的排布（layout="${g.layout}"）`;
    else if (g.relations?.length) group.moves = `组 ${g.name} 的关联（relation ${g.relations.join(',')}）`;
    else if (g.gearXY) group.moves = `组 ${g.name} 上改位置的齿轮（gearXY）`;
    // 和 FairyGUI 一样：组改尺寸时只有自动排布的组会改组里控件的尺寸
    if (g.layout && g.gearSize) group.resizes = `组 ${g.name} 上改尺寸的齿轮（gearSize，组的排布 layout="${g.layout}"）`;
    groups.set(g.id, group);
    applyGears(group, g.gears, component);
  }
  for (const g of descriptor.groups ?? []) if (g.group) (groups.get(g.id) as HeadlessGroup).group = groups.get(g.group) ?? null;
  for (const child of descriptor.children) {
    const object = buildChild(child, lookup, owner, tr);
    object.group = child.group ? groups.get(child.group) ?? null : null;
    for (let g = object.group; g && !object.unknownLayout.position; g = g.group) if (g.moves) object.unknownLayout.position = g.moves;
    if (object.group?.resizes && !object.unknownLayout.size) object.unknownLayout.size = object.group.resizes;
    applyGears(object, child.gears, component);
    markPropGears(object, child.gears, component);
    component.addChild(object);
  }
  // 按钮、标签没写 title 时显示 title 子控件自己的文字（和 FairyGUI 一样，子控件建好以后再写）；下拉框的项也在子控件建好以后再给（选中项的文字要写进 title）。
  if (component instanceof HeadlessButton) {
    if (props?.title !== undefined) component.title = props.title;
    else component.adoptTitle();
  }
  if (component instanceof HeadlessLabel && props?.title !== undefined) component.title = props.title;
  if (component instanceof HeadlessComboBox) { component.items = props?.items ?? []; component.selectedIndex = props?.selectedIndex ?? -1; }
  return component;
}

export {HeadlessLoader, HeadlessInput, HeadlessText, HeadlessButton, HeadlessLabel};

/** 按地址建一张图片（ArtText 用）。 */
export function buildImage(url: string, size: {width: number; height: number} | null): HeadlessObject {
  const loader = new HeadlessLoader('', 'loader');
  loader.url = url;
  if (size) loader.rect = {x: 0, y: 0, width: size.width, height: size.height};
  return loader;
}
