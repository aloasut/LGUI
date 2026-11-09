// 把 FairyGUI-dom 的对象包成接口层的 UI 对象。每个对象只包一次（WeakMap 缓存），事件一律返回取消函数。
import * as fgui from '../vendor/fairygui.module.js';
import type {
  PointerInput, Rect, UIObject, UIComponent, UIText, UIInput, UIButton, UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph, Unsubscribe,
  UILabel, UISlider, UIComboBox, UIMovieClip, UITree, UITreeNode, WheelInput, TweenProp, TransitionTouch
} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';
import {drivePress, scaleDownEffect} from '../fairygui-patches/button-press';
import {pointerEventTypes, toPointerInput} from '../pointer';
import {stage, toDesign} from '../scale';

const toHex = (value: number): string => '#' + (value & 0xffffff).toString(16).padStart(6, '0');
const fromHex = (value: string): number => {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!match) throw new LgRuntimeError('LGUI-RT-020', `颜色 ${value} 的格式不对。`, '写成 #rrggbb。');
  return parseInt(match[1].slice(-6), 16);
};

// 代码补间的属性归哪个齿轮管：FairyGUI 的 _gears 序号（1 XY、2 Size（也管 scale）、3 Look（透明度、旋转）、4 Color、9 FontSize）。
const GEAR_OF: Partial<Record<TweenProp | 'text', [number, string]>> = {
  text: [6, 'gearText'],
  x: [1, 'gearXY'], y: [1, 'gearXY'], width: [2, 'gearSize'], height: [2, 'gearSize'], scaleX: [2, 'gearSize'], scaleY: [2, 'gearSize'],
  alpha: [3, 'gearLook'], rotation: [3, 'gearLook'], color: [4, 'gearColor'], fontSize: [9, 'gearFontSize']
};
const BASE_PROPS: readonly TweenProp[] = ['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotation', 'alpha'];
// FairyGUI 的 ObjectPropID。
const PROP_COLOR = 2, PROP_FONT_SIZE = 8;
// 动效项的 ActionType → 改哪一类属性。
const TOUCHES: Record<number, TransitionTouch> = {0: 'xy', 1: 'size', 2: 'scale', 4: 'alpha', 5: 'rotation', 6: 'color', 11: 'shake', 14: 'text'};

/** 这个控件有没有颜色、字号这两项（文字；按钮、标签要有标题文字；图片、加载器、序列帧、图形只有颜色）。 */
function hasLook(native: fgui.GObject, prop: TweenProp): boolean {
  if (native instanceof fgui.GTextField) return prop === 'color' || prop === 'fontSize';
  if (native instanceof fgui.GButton || native instanceof fgui.GLabel) return (prop === 'color' || prop === 'fontSize') && native.getTextField() != null;
  if (native instanceof fgui.GImage || native instanceof fgui.GLoader || native instanceof fgui.GMovieClip || native instanceof fgui.GGraph) return prop === 'color';
  return false;
}

// 订阅 FairyGUI 事件，返回取消函数。
function listen(target: fgui.EventDispatcher, type: string, handler: (event: fgui.FguiEvent) => void): Unsubscribe {
  const callback: fgui.FguiListener = event => handler(event);
  target.on(type, callback);
  return () => target.off(type, callback);
}

class H5Object implements UIObject {
  // 可用、接收输入分开记，一起决定 FairyGUI 的 touchable：直接写 pointer-events 会在 FairyGUI 重新挂元素时（齿轮切换、换层）被改回去。
  private isEnabled: boolean;
  private isTouchable: boolean;
  constructor(readonly native: fgui.GObject) {
    this.isEnabled = !native.grayed;
    this.isTouchable = native.touchable;
    if (!this.isEnabled) native.touchable = false;
  }
  get name(): string { return this.native.name; }
  get visible(): boolean { return this.native.visible; }
  set visible(value: boolean) { this.native.visible = value; }
  // 真的显示：一路往上，每一级都没被齿轮藏起来（internalVisible）、自己和所在的组都显示（internalVisible2）。
  get shown(): boolean {
    for (let o: fgui.GObject | null = this.native; o; o = o.parent) if (!o.internalVisible || !o.internalVisible2) return false;
    return true;
  }
  get enabled(): boolean { return this.isEnabled; }
  set enabled(value: boolean) { this.isEnabled = value; this.native.grayed = !value; this.native.touchable = value && this.isTouchable; }
  get customData(): string { return this.native.data == null ? '' : String(this.native.data); }
  get touchable(): boolean { return this.isTouchable; }
  set touchable(value: boolean) { this.isTouchable = value; this.native.touchable = value && this.isEnabled; }
  get rect(): Rect { return {x: this.native.x, y: this.native.y, width: this.native.width, height: this.native.height}; }
  set rect(value: Rect) { this.native.setPosition(value.x, value.y); this.native.setSize(value.width, value.height); }
  get parent(): UIObject | null { const p = this.native.parent; return p ? wrap(p) : null; }
  get disposed(): boolean { return this.native.isDisposed; }
  get pivot(): {x: number; y: number} { return {x: this.native.pivotX, y: this.native.pivotY}; }
  supports(prop: TweenProp): boolean {
    if (BASE_PROPS.includes(prop) || hasLook(this.native, prop)) return true;
    if (prop === 'fillAmount') return (this.native instanceof fgui.GImage || this.native instanceof fgui.GLoader) && this.native.fillMethod !== 0;
    return prop === 'progress' && this.native instanceof fgui.GProgressBar;
  }
  getProp(prop: TweenProp): number {
    const n = this.native;
    switch (prop) {
      case 'x': return n.x;
      case 'y': return n.y;
      case 'width': return n.width;
      case 'height': return n.height;
      case 'scaleX': return n.scaleX;
      case 'scaleY': return n.scaleY;
      case 'rotation': return n.rotation;
      case 'alpha': return n.alpha;
      case 'color': return Number(n.getProp(PROP_COLOR)) || 0;
      case 'fontSize': return Number(n.getProp(PROP_FONT_SIZE)) || 0;
      case 'fillAmount': return (n as fgui.GImage).fillAmount;
      case 'progress': { const bar = n as fgui.GProgressBar; return bar.max ? bar.value / bar.max * 100 : 0; }
    }
  }
  // 只改这一项：位置、尺寸各改一维，缩放各改一个方向（FairyGUI 的 x、width 这些 setter 就是这样）。
  setProp(prop: TweenProp, value: number): void {
    const n = this.native;
    switch (prop) {
      case 'x': n.x = value; break;
      case 'y': n.y = value; break;
      case 'width': n.width = value; break;
      case 'height': n.height = value; break;
      case 'scaleX': n.scaleX = value; break;
      case 'scaleY': n.scaleY = value; break;
      case 'rotation': n.rotation = value; break;
      case 'alpha': n.alpha = value; break;
      case 'color': n.setProp(PROP_COLOR, value); break;
      case 'fontSize': n.setProp(PROP_FONT_SIZE, value); break;
      case 'fillAmount': (n as fgui.GImage).fillAmount = value; break;
      case 'progress': { const bar = n as fgui.GProgressBar; bar.value = value / 100 * bar.max; break; }
    }
  }
  // 按钮、标签的标题颜色、字号、文字就是标题文字控件的：它自己的齿轮也算。
  ownerOf(prop: TweenProp | 'text'): string | null {
    const gear = GEAR_OF[prop];
    if (!gear) return null;
    const n = this.native;
    const title = (prop === 'color' || prop === 'fontSize' || prop === 'text') && (n instanceof fgui.GButton || n instanceof fgui.GLabel) ? n.getTextField() : null;
    for (const o of title ? [n, title] : [n]) {
      const found = o._gears[gear[0]];
      if (found?.controller) return `齿轮 ${gear[1]}（控制器 ${found.controller.name}）`;
    }
    return null;
  }
  onPointer(handler: (event: PointerInput) => void): Unsubscribe {
    const element = this.native.element;
    const listener = (event: PointerEvent): void => handler(toPointerInput(event));
    for (const type of pointerEventTypes) element.addEventListener(type, listener as EventListener);
    return () => { for (const type of pointerEventTypes) element.removeEventListener(type, listener as EventListener); };
  }
  // 浏览器自己做命中测试：根节点贴在页面左上角，设计坐标乘缩放比就是页面坐标；不接收输入的元素（pointer-events: none）不算。
  hitDepth(x: number, y: number): number {
    let depth = 0;
    for (let el = document.elementFromPoint(x * stage.scale, y * stage.scale); el; el = el.parentElement, depth++) if (el === this.native.element) return depth;
    return -1;
  }
  onWheel(handler: (event: WheelInput) => void): Unsubscribe {
    const element = this.native.element;
    const listener = (event: WheelEvent): void => { const {x, y} = toDesign(event.clientX, event.clientY); handler({x, y, deltaX: event.deltaX, deltaY: event.deltaY}); };
    element.addEventListener('wheel', listener, {passive: true});
    return () => element.removeEventListener('wheel', listener);
  }
}

class H5Component extends H5Object implements UIComponent {
  constructor(readonly native: fgui.GComponent, readonly componentName: string) { super(native); }
  child(path: string): UIObject | null {
    let current: fgui.GObject | null = this.native;
    for (const part of path.split('.')) {
      if (!(current instanceof fgui.GComponent)) return null;
      current = current.getChild(part);
      if (!current) return null;
    }
    return current ? wrap(current) : null;
  }
  controller(name: string): UIController | null {
    const native = this.native.getController(name);
    return native ? wrapController(native) : null;
  }
  transition(name: string): UITransition | null {
    const native = this.native.getTransition(name);
    return native ? wrapTransition(native) : null;
  }
  allTransitions(): readonly UITransition[] { return this.native._transitions.map(wrapTransition); }
  childNames(): readonly string[] {
    const names: string[] = [];
    for (let i = 0; i < this.native.numChildren; i++) names.push(this.native.getChildAt(i).name);
    return names;
  }
  addChild(child: UIObject): void { this.native.addChild(nativeOf(child)); }
  removeChild(child: UIObject): void { this.native.removeChild(nativeOf(child)); }
  dispose(): void { this.native.dispose(); }
}

class H5Text extends H5Object implements UIText {
  constructor(readonly native: fgui.GTextField) { super(native); }
  get text(): string { return this.native.text; }
  set text(value: string) { this.native.text = value; }
  get color(): string { return toHex(this.native.color); }
  set color(value: string) { this.native.color = fromHex(value); }
}

class H5Input extends H5Text implements UIInput {
  private prompt = '';
  constructor(readonly native: fgui.GTextInput) { super(native); }
  get text(): string { return this.native.text; }
  // 文字没变就不写：写一次会把光标挪到最后（绑定把 Model 的值写回来时，正在打字的人会察觉）。
  set text(value: string) { if (this.native.text !== value) this.native.text = value; }
  get promptText(): string { return this.prompt; }
  set promptText(value: string) { this.prompt = value; this.native.setPromptText(value); }
  // 输入法还在选字时（isComposing）不通知，选完（compositionend）通知一次；有的浏览器选完还会再发一次 input，跳过。
  onChange(handler: (text: string) => void): Unsubscribe {
    const element = this.native.element;
    let ended: string | null = null;
    const onInput = (event: Event): void => {
      const text = this.native.text;
      const repeat = ended === text;
      ended = null;
      if (!(event as InputEvent).isComposing && !repeat) handler(text);
    };
    const onEnd = (): void => { ended = this.native.text; handler(ended); };
    element.addEventListener('input', onInput);
    element.addEventListener('compositionend', onEnd);
    return () => { element.removeEventListener('input', onInput); element.removeEventListener('compositionend', onEnd); };
  }
}

/** FairyGUI 的 ButtonMode（0、1、2）对应的名字。 */
const buttonModes = ['Common', 'Check', 'Radio'];

class H5Button extends H5Component implements UIButton {
  constructor(readonly native: fgui.GButton, componentName: string) { super(native, componentName); }
  get title(): string { return this.native.title; }
  set title(value: string) { this.native.title = value; }
  get icon(): string { return this.native.icon; }
  set icon(value: string) { this.native.icon = value; }
  get selected(): boolean { return this.native.selected; }
  set selected(value: boolean) { this.native.selected = value; }
  get mode(): string { return buttonModes[this.native.mode] ?? `ButtonMode ${this.native.mode}`; }
  get sound(): string { return this.native.sound ?? ''; }
  get soundVolume(): number { return this.native.soundVolumeScale ?? 1; }
  // downEffect="scale" 的上游效果已经由补丁 9 关掉（_downEffect 置 0），倍数记在补丁里；dark 还是上游的。
  get downEffect(): UIButton['downEffect'] {
    const scale = scaleDownEffect(this.native);
    if (scale !== undefined) return {type: 'scale', value: scale};
    const raw = this.native as unknown as {_downEffect: number; _downEffectValue: number};
    return {type: raw._downEffect === 1 ? 'dark' : 'none', value: raw._downEffectValue ?? 0.8};
  }
  private press = 1;
  get pressScale(): number { return this.press; }
  // 只设元素的 CSS scale（补丁 9）：和 FairyGUI 写的 transform 叠加，按元素中心缩放，GObject 的位置、尺寸、scale 都不变。
  set pressScale(value: number) { drivePress(this.native); this.press = value; this.native.element.style.scale = value === 1 ? '' : String(value); }
}

const fillMethods = ['none', 'horizontal', 'vertical', 'radial90', 'radial180', 'radial360'] as const;

class H5Image extends H5Object implements UIImage {
  constructor(readonly native: fgui.GImage) { super(native); }
  get fillMethod(): UIImage['fillMethod'] { return fillMethods[this.native.fillMethod] ?? 'none'; }
  set fillMethod(value: UIImage['fillMethod']) { this.native.fillMethod = fillMethods.indexOf(value); }
  get fillOrigin(): number { return this.native.fillOrigin; }
  set fillOrigin(value: number) { this.native.fillOrigin = value; }
  get fillClockwise(): boolean { return this.native.fillClockwise; }
  set fillClockwise(value: boolean) { this.native.fillClockwise = value; }
  get fillAmount(): number { return this.native.fillAmount; }
  set fillAmount(value: number) { this.native.fillAmount = value; }
}

class H5Loader extends H5Object implements UILoader {
  private loads = new Set<() => void>();
  private errors = new Set<(url: string) => void>();
  private current = '';
  constructor(readonly native: fgui.GLoader) { super(native); }
  get url(): string { return this.current; }
  set url(value: string) {
    this.current = value;
    this.native.url = value;
    if (!value) return;
    // ui:// 是包里的图片，同步就绪；网络图片用一个探测 img 判断加载成功还是失败（FairyGUI-dom 的加载器不报失败）。
    if (value.startsWith('ui://')) { for (const handler of [...this.loads]) handler(); return; }
    const probe = new Image();
    probe.onload = () => { if (this.current === value) for (const handler of [...this.loads]) handler(); };
    probe.onerror = () => { if (this.current === value) for (const handler of [...this.errors]) handler(value); };
    probe.src = value;
  }
  onLoad(handler: () => void): Unsubscribe { this.loads.add(handler); return () => { this.loads.delete(handler); }; }
  onError(handler: (url: string) => void): Unsubscribe { this.errors.add(handler); return () => { this.errors.delete(handler); }; }
}

class H5List extends H5Object implements UIList {
  private renderer: ((index: number, item: UIComponent) => void) | null = null;
  private isVirtual = false;
  constructor(readonly native: fgui.GList) { super(native); }
  get numItems(): number { return this.native.numItems; }
  set numItems(value: number) { this.native.numItems = value; if (this.selected >= value) this.selected = -1; }
  get itemRenderer(): ((index: number, item: UIComponent) => void) | null { return this.renderer; }
  set itemRenderer(value: ((index: number, item: UIComponent) => void) | null) {
    this.renderer = value;
    this.native.itemRenderer = value ? (index, item) => value(index, wrapComponent(item)) : null;
  }
  get scrollable(): boolean { return this.native.scrollPane != null; }
  get virtual(): boolean { return this.isVirtual; }
  set virtual(value: boolean) {
    if (value === this.isVirtual) return;
    if (!value) throw new LgRuntimeError('LGUI-RT-021', '列表一旦设成虚拟列表就不能改回去。', '在第一次给数据之前决定要不要虚拟列表。');
    this.isVirtual = true;
    this.native.setVirtual();
  }
  get scrollPosition(): {x: number; y: number} { const pane = this.native.scrollPane; return {x: pane?.posX ?? 0, y: pane?.posY ?? 0}; }
  set scrollPosition(value: {x: number; y: number}) { this.native.scrollPane?.scrollToView(new fgui.Rect(value.x, value.y, 0, 0), false, true); }
  // 选中项自己记一份：FairyGUI 只把按钮类型的子项当成可选中的，非按钮子项的选中会丢；这样和 headless 后端行为一致。
  private selected = -1;
  get selectedIndex(): number { return this.selected; }
  set selectedIndex(value: number) { this.selected = value; this.native.selectedIndex = value; }
  onClickItem(handler: (index: number) => void): Unsubscribe {
    return listen(this.native, 'click_item', event => {
      const item = event.data as fgui.GObject;
      const index = this.native.childIndexToItemIndex(childIndex(this.native, item));
      this.selected = index;
      handler(index);
    });
  }
  itemAt(index: number): UIComponent | null {
    const childIndex = this.native.itemIndexToChildIndex(index);
    if (childIndex < 0 || childIndex >= this.native.numChildren) return null;
    return wrapComponent(this.native.getChildAt(childIndex));
  }
  scrollToView(index: number): void { this.native.scrollToView(index, false); }
}

function childIndex(parent: fgui.GComponent, child: fgui.GObject): number {
  for (let i = 0; i < parent.numChildren; i++) if (parent.getChildAt(i) === child) return i;
  return -1;
}

class H5Progress extends H5Component implements UIProgress {
  constructor(readonly native: fgui.GProgressBar, componentName: string) { super(native, componentName); }
  get value(): number { return this.native.value; }
  set value(value: number) { this.native.value = value; }
  get max(): number { return this.native.max; }
  set max(value: number) { this.native.max = value; }
}

class H5Label extends H5Component implements UILabel {
  constructor(readonly native: fgui.GLabel, componentName: string) { super(native, componentName); }
  get title(): string { return this.native.title ?? ''; }
  set title(value: string) { this.native.title = value; }
  get icon(): string { return this.native.icon ?? ''; }
  set icon(value: string) { this.native.icon = value; }
}

class H5Slider extends H5Component implements UISlider {
  constructor(readonly native: fgui.GSlider, componentName: string) { super(native, componentName); }
  get value(): number { return this.native.value; }
  set value(value: number) { this.native.value = value; }
  get min(): number { return this.native.min; }
  set min(value: number) { this.native.min = value; }
  get max(): number { return this.native.max; }
  set max(value: number) { this.native.max = value; }
  onChange(handler: (value: number) => void): Unsubscribe { return listen(this.native, 'changed', () => handler(this.native.value)); }
}

// 下拉框：选中序号统一成「在范围内，否则 -1」。FairyGUI 给 items 时会把 -1 改成 0、把超出的改成最后一项，这里改回来，和 headless 一致。
class H5ComboBox extends H5Component implements UIComboBox {
  constructor(readonly native: fgui.GComboBox, componentName: string) { super(native, componentName); }
  get items(): readonly string[] { return this.native.items; }
  set items(value: readonly string[]) { const keep = this.selectedIndex; this.native.items = [...value]; this.selectedIndex = keep; }
  get selectedIndex(): number { const index = this.native.selectedIndex; return index >= 0 && index < this.native.items.length ? index : -1; }
  set selectedIndex(value: number) { this.native.selectedIndex = value >= 0 && value < this.native.items.length ? value : -1; }
  get text(): string { return this.native.text ?? ''; }
  onChange(handler: (index: number) => void): Unsubscribe { return listen(this.native, 'status_changed', () => handler(this.selectedIndex)); }
}

class H5MovieClip extends H5Object implements UIMovieClip {
  constructor(readonly native: fgui.GMovieClip) { super(native); }
  get playing(): boolean { return this.native.playing; }
  set playing(value: boolean) { this.native.playing = value; }
  get frame(): number { return this.native.frame; }
  set frame(value: number) { this.native.frame = value; }
}

type Key = string | number;

// 树：每次换数据整棵重建（子项组件回到 FairyGUI 的对象池再复用），展开状态按 key 记下来；选中项自己记一份（和列表一样）。
class H5Tree extends H5Object implements UITree {
  private renderer: ((key: Key, item: UIComponent) => void) | null = null;
  private readonly nodes = new Map<Key, fgui.GTreeNode>();
  private readonly keys = new Map<fgui.GTreeNode, Key>();
  private readonly expanded = new Map<Key, boolean>();
  private selected: Key | null = null;
  constructor(readonly native: fgui.GTree) {
    super(native);
    native.treeNodeRender = (node, cell) => { const key = this.keys.get(node); if (key !== undefined) this.renderer?.(key, wrapComponent(cell)); };
  }
  get nodeRenderer(): ((key: Key, item: UIComponent) => void) | null { return this.renderer; }
  set nodeRenderer(value: ((key: Key, item: UIComponent) => void) | null) { this.renderer = value; }
  setNodes(list: readonly UITreeNode[]): void {
    for (const [key, node] of this.nodes) this.expanded.set(key, node.expanded);
    const pane = this.native.scrollPane;
    const position = {x: pane?.posX ?? 0, y: pane?.posY ?? 0};
    this.native.rootNode.removeChildren();
    this.nodes.clear();
    this.keys.clear();
    const add = (parent: fgui.GTreeNode, items: readonly UITreeNode[]): void => {
      for (const item of items) {
        const node = new fgui.GTreeNode(item.children.length > 0);
        node.expanded = this.expanded.get(item.key) ?? true;
        this.nodes.set(item.key, node);
        this.keys.set(node, item.key);
        parent.addChild(node);
        add(node, item.children);
      }
    };
    add(this.native.rootNode, list);
    for (const key of [...this.expanded.keys()]) if (!this.nodes.has(key)) this.expanded.delete(key);
    this.selectedKey = this.selected !== null && this.nodes.has(this.selected) ? this.selected : null;
    if (pane) { this.native.ensureBoundsCorrect(); pane.setPosX(position.x, false); pane.setPosY(position.y, false); }
  }
  get selectedKey(): Key | null { return this.selected; }
  set selectedKey(key: Key | null) {
    this.selected = key;
    this.native.clearSelection();
    const node = key === null ? undefined : this.nodes.get(key);
    if (node) this.native.selectNode(node);
  }
  get numItems(): number { return this.native.numChildren; }
  itemAt(index: number): UIComponent | null { return index >= 0 && index < this.native.numChildren ? wrapComponent(this.native.getChildAt(index)) : null; }
  onClickNode(handler: (key: Key) => void): Unsubscribe {
    return listen(this.native, 'click_item', event => {
      for (const [node, key] of this.keys) {
        if (node.cell !== event.data) continue;
        this.selected = key;
        handler(key);
        return;
      }
    });
  }
}

class H5Graph extends H5Object implements UIGraph {
  constructor(readonly native: fgui.GGraph) { super(native); }
  get color(): string { return toHex(this.native.color); }
  set color(value: string) { this.native.color = fromHex(value); }
}

class H5Controller implements UIController {
  constructor(readonly native: fgui.Controller) {}
  get name(): string { return this.native.name; }
  get selectedPage(): string { return this.native.selectedPage; }
  set selectedPage(value: string) {
    if (!this.pages.includes(value)) throw new LgRuntimeError('LGUI-RT-022', `控制器 ${this.name} 没有页 ${value}。`, `能用的页：${this.pages.join('、')}。`);
    this.native.selectedPage = value;
  }
  get pages(): readonly string[] {
    const pages: string[] = [];
    for (let i = 0; i < this.native.pageCount; i++) pages.push(this.native.getPageName(i));
    return pages;
  }
  onChange(handler: (page: string) => void): Unsubscribe { return listen(this.native, 'status_changed', () => handler(this.native.selectedPage)); }
}

class H5Transition implements UITransition {
  constructor(readonly native: fgui.Transition) {}
  get name(): string { return this.native.name; }
  get settings(): UITransition['settings'] { return {autoPlay: this.native._autoPlay === true, times: this.native._autoPlayTimes ?? 1, delay: Math.round((this.native._autoPlayDelay ?? 0) * 1000)}; }
  get playing(): boolean { return this.native.playing; }
  play(options: {times?: number; delay?: number} = {}, onComplete?: () => void): void {
    // FairyGUI 重播时会把上一次当作放完（调用它的回调）；先不带回调停掉，只有正常放完才通知。
    this.native.stop(true, false);
    this.native.play(onComplete, options.times ?? 1, (options.delay ?? 0) / 1000);
  }
  stop(): void { this.native.stop(true, false); }
  setPaused(paused: boolean): void { this.native.setPaused(paused); }
  // 和 FairyGUI 放动效时一样找每一项的目标：没写目标是组件自己。
  touches(): readonly {target: UIObject; what: TransitionTouch}[] {
    const owner = this.native._owner;
    const found: {target: UIObject; what: TransitionTouch}[] = [];
    for (const item of this.native._items) {
      const what = TOUCHES[item.type];
      const target = item.target ?? (item.targetId ? owner.getChildById(item.targetId) : owner);
      if (what && target) found.push({target: wrap(target), what});
    }
    return found;
  }
}

const cache = new WeakMap<object, UIObject>();
const controllerCache = new WeakMap<fgui.Controller, UIController>();
const transitionCache = new WeakMap<fgui.Transition, UITransition>();
const natives = new WeakMap<UIObject, fgui.GObject>();

// 组件的「包/组件」名：创建时由后端写进 data 之外的一个私有字段。
const componentNames = new WeakMap<fgui.GObject, string>();
export function setComponentName(native: fgui.GObject, name: string): void { componentNames.set(native, name); }

/** 包一个 FairyGUI 对象。 */
export function wrap(native: fgui.GObject): UIObject {
  const cached = cache.get(native);
  if (cached) return cached;
  const item = native.packageItem;
  const name = componentNames.get(native) ?? (item ? `${item.owner.name}/${item.name}` : '');
  let wrapped: UIObject;
  if (native instanceof fgui.GTree) wrapped = new H5Tree(native);
  else if (native instanceof fgui.GList) wrapped = new H5List(native);
  else if (native instanceof fgui.GButton) wrapped = new H5Button(native, name);
  else if (native instanceof fgui.GProgressBar) wrapped = new H5Progress(native, name);
  else if (native instanceof fgui.GLabel) wrapped = new H5Label(native, name);
  else if (native instanceof fgui.GSlider) wrapped = new H5Slider(native, name);
  else if (native instanceof fgui.GComboBox) wrapped = new H5ComboBox(native, name);
  else if (native instanceof fgui.GComponent) wrapped = new H5Component(native, name);
  else if (native instanceof fgui.GTextInput) wrapped = new H5Input(native);
  else if (native instanceof fgui.GTextField) wrapped = new H5Text(native);
  else if (native instanceof fgui.GImage) wrapped = new H5Image(native);
  else if (native instanceof fgui.GLoader) wrapped = new H5Loader(native);
  else if (native instanceof fgui.GGraph) wrapped = new H5Graph(native);
  else if (native instanceof fgui.GMovieClip) wrapped = new H5MovieClip(native);
  else wrapped = new H5Object(native);
  cache.set(native, wrapped);
  natives.set(wrapped, native);
  return wrapped;
}

/** 包一个组件；不是组件时报错。 */
export function wrapComponent(native: fgui.GObject): UIComponent {
  const wrapped = wrap(native);
  if (!(wrapped instanceof H5Component)) throw new LgRuntimeError('LGUI-RT-023', `${native.name} 不是组件。`, '检查 ui/ 里这个控件的类型。');
  return wrapped;
}

function wrapController(native: fgui.Controller): UIController {
  let wrapped = controllerCache.get(native);
  if (!wrapped) { wrapped = new H5Controller(native); controllerCache.set(native, wrapped); }
  return wrapped;
}

function wrapTransition(native: fgui.Transition): UITransition {
  let wrapped = transitionCache.get(native);
  if (!wrapped) { wrapped = new H5Transition(native); transitionCache.set(native, wrapped); }
  return wrapped;
}

/** 接口对象 → FairyGUI 对象。 */
export function nativeOf(object: UIObject): fgui.GObject {
  const native = natives.get(object);
  if (!native) throw new LgRuntimeError('LGUI-RT-024', `${object.name} 不是 h5 后端创建的对象。`, '不要混用不同后端的对象。');
  return native;
}
