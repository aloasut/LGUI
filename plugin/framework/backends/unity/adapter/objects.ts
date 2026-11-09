// FairyGUI-unity 对象 → 引擎无关接口。缓存包装对象，所有原生事件均有成对的 Add/Remove。
import type {PointerInput, Rect, UIObject, UIComponent, UIText, UIInput, UIButton, UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph, Unsubscribe,
  UILabel, UISlider, UIComboBox, UIMovieClip, UITree, UITreeNode, WheelInput, TweenProp, TransitionTouch} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';
import type {NativeColor, NativeComponent, NativeController, NativeEventContext, NativeEventHandler, NativeEventListener, NativeFairyGUI, NativeGraph, NativeImage, NativeInputEvent, NativeList, NativeLoader, NativeObject, NativeProgress, NativeRect, NativeText, NativeTextInput, NativeButton, NativeTransition,
  NativeLabel, NativeSlider, NativeComboBox, NativeMovieClip, NativeTree, NativeTreeNode} from './native-ui';

const fillMethods = ['none', 'horizontal', 'vertical', 'radial90', 'radial180', 'radial360'] as const;
const byte = (value: number): string => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
const rgb = (color: NativeColor): string => byte(color.r) + byte(color.g) + byte(color.b);
const colorText = (color: NativeColor, alpha = false): string => '#' + (alpha && color.a < 1 ? byte(color.a) : '') + rgb(color);
type Key = string | number;
const colorNumber = (color: NativeColor): number => (Math.round(color.r * 255) << 16) | (Math.round(color.g * 255) << 8) | Math.round(color.b * 255);
const numberText = (value: number): string => '#' + (Math.round(value) & 0xffffff).toString(16).padStart(6, '0');
// 代码补间的属性归哪个齿轮管：FairyGUI 的 _gears 序号（1 XY、2 Size（也管 scale）、3 Look（透明度、旋转）、4 Color、9 FontSize）。
const GEAR_OF: Partial<Record<TweenProp | 'text', [number, string]>> = {
  text: [6, 'gearText'],
  x: [1, 'gearXY'], y: [1, 'gearXY'], width: [2, 'gearSize'], height: [2, 'gearSize'], scaleX: [2, 'gearSize'], scaleY: [2, 'gearSize'],
  alpha: [3, 'gearLook'], rotation: [3, 'gearLook'], color: [4, 'gearColor'], fontSize: [9, 'gearFontSize']
};
const BASE_PROPS: readonly TweenProp[] = ['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotation', 'alpha'];
// 动效项的 TransitionActionType → 改哪一类属性。
const TOUCHES: Record<number, TransitionTouch> = {0: 'xy', 1: 'size', 2: 'scale', 4: 'alpha', 5: 'rotation', 6: 'color', 11: 'shake', 14: 'text'};

/** 对象层要用的宿主能力。FairyGUI 不公开按钮音效的地址和动效的自动播放设置，由 LGUI.Platform 读出来。 */
export interface ObjectServices {
  /** 这一次滚轮的横向滚动量。 */
  wheelDeltaX(): number;
  /** 设计尺寸里 (x, y) 上最上面那个接收输入的控件，没有时是 null。 */
  hitTest(x: number, y: number): NativeObject | null;
  /** 按钮在 ui/ 里设的点击音效地址，没设是空字符串。 */
  buttonSound(button: NativeButton): string;
  /** 动效在 ui/ 里写的设置（delay 是毫秒）。 */
  transitionSettings(transition: NativeTransition): UITransition['settings'];
  /** 第 index 个齿轮跟的控制器名，没有这个齿轮是空字符串。 */
  gearController(object: NativeObject, index: number): string;
  /** 按钮的按下效果（0 没有、1 变暗、2 缩放）和 downEffectValue。 */
  downEffect(button: NativeButton): {type: number; value: number};
  /** 关掉 FairyGUI 自己的按下缩放（框架接管）。 */
  disableDownEffect(button: NativeButton): void;
  /** 动效的每一项：改的控件（没有是 null）和 TransitionActionType。 */
  transitionItems(transition: NativeTransition): {target: NativeObject | null; type: number}[];
}

/** 为一个 Unity 后端创建独立的对象和事件缓存，不能混用另一个后端的对象。 */
export function createObjectAdapter(fgui: NativeFairyGUI, now: () => number, toPoint: (x: number, y: number) => {x: number; y: number}, toRect: (x: number, y: number, width: number, height: number) => NativeRect, services: ObjectServices, onComponentReleased?: (component: UIComponent) => void) {
  const cache = new WeakMap<NativeObject, UnityObject>();
  const natives = new WeakMap<UIObject, NativeObject>();
  const names = new WeakMap<NativeObject, string>();
  const controllers = new WeakMap<NativeController, UIController>();
  const transitions = new WeakMap<NativeTransition, UITransition>();
  const pointers = new Map<NativeObject, Set<(input: PointerInput) => void>>();
  const activeObjects = new Set<UnityObject>();
  const activeLists = new Set<UnityList | UnityTree>();
  let converted = new WeakMap<NativeInputEvent, PointerInput>();

  function fromColor(value: string): NativeColor {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) throw new LgRuntimeError('LGUI-RT-020', `颜色 ${value} 的格式不对。`, '写成 #rrggbb 或 #aarrggbb。');
    return fgui.Utils.ToolSet.ConvertFromHtmlColor(value);
  }

  /** 同一个原生输入在控件与舞台上返回同一对象；帧开始时清除池化原生事件的旧映射。 */
  function toPointerInput(type: PointerInput['type'], context: NativeEventContext): PointerInput {
    const event = context.inputEvent;
    if (!event) throw new LgRuntimeError('LGUI-RT-001', 'Unity 原生指针事件没有输入数据。', '仅对 FairyGUI 的原始输入事件做指针转换。');
    const point = toPoint(event.x, event.y);
    const previous = converted.get(event);
    if (previous && previous.type === type && previous.x === point.x && previous.y === point.y && previous.pointerId === event.touchId) return previous;
    const input: PointerInput = {type, pointerId: event.touchId, pointerType: fgui.Stage.touchScreen ? 'touch' : 'mouse', ...point, time: now()};
    converted.set(event, input);
    return input;
  }
  function clearPointerCache(): void { converted = new WeakMap<NativeInputEvent, PointerInput>(); }

  /** Unity 未按下鼠标时只向 Stage 发送 move；先给命中对象及祖先发送同一事件，再交给舞台。 */
  function dispatchHover(target: NativeObject | null, context: NativeEventContext): void {
    if (!context.inputEvent || fgui.Stage.touchScreen) return;
    const input = toPointerInput('move', context);
    for (let current = target; current; current = current.parent) {
      for (const handler of [...(pointers.get(current) ?? [])]) handler(input);
    }
  }

  class UnityObject implements UIObject {
    private subscriptions = new Set<Unsubscribe>();
    constructor(readonly native: NativeObject) {}
    get name(): string { return this.native.name; }
    get visible(): boolean { return this.native.visible; }
    set visible(value: boolean) { this.native.visible = value; }
    // 真的显示：在舞台上（被齿轮或组藏起来时 FairyGUI 把显示对象从父容器里移走），一路往上每一级显示对象都显示。
    get shown(): boolean {
      if (!this.native.onStage) return false;
      for (let display = this.native.displayObject; display; display = display.parent) if (!display.visible) return false;
      return true;
    }
    get enabled(): boolean { return !this.native.grayed; }
    set enabled(value: boolean) { this.native.enabled = value; }
    get touchable(): boolean { return this.native.touchable; }
    set touchable(value: boolean) { this.native.touchable = value; }
    get customData(): string { return this.native.data == null ? '' : String(this.native.data); }
    get rect(): Rect { return {x: this.native.x, y: this.native.y, width: this.native.width, height: this.native.height}; }
    set rect(value: Rect) { this.native.SetXY(value.x, value.y); this.native.SetSize(value.width, value.height); }
    get parent(): UIObject | null { const p = this.native.parent; return p ? wrap(p) : null; }
    get disposed(): boolean { return this.native.isDisposed; }
    get pivot(): {x: number; y: number} { return {x: this.native.pivotX, y: this.native.pivotY}; }
    /** 颜色、字号写在哪（文字自己；按钮、标签的标题文字；图片、加载器、序列帧、图形只有颜色），没有是 null。 */
    protected look(prop: TweenProp): {get(): number; set(value: number): void} | null {
      const n = this.native;
      if (n instanceof fgui.GTextField) {
        const text = n as NativeText;
        if (prop === 'color') return {get: () => colorNumber(text.color), set: v => { text.color = fromColor(numberText(v)); }};
        if (prop === 'fontSize') return {get: () => text.textFormat.size, set: v => { const format = text.textFormat; format.size = v; text.textFormat = format; }};
      }
      if (n instanceof fgui.GButton || n instanceof fgui.GLabel) {
        const titled = n as NativeButton | NativeLabel;
        if (!titled.GetTextField()) return null;
        if (prop === 'color') return {get: () => colorNumber(titled.titleColor), set: v => { titled.titleColor = fromColor(numberText(v)); }};
        if (prop === 'fontSize') return {get: () => titled.titleFontSize, set: v => { titled.titleFontSize = v; }};
      }
      if (prop === 'color' && (n instanceof fgui.GImage || n instanceof fgui.GLoader || n instanceof fgui.GMovieClip || n instanceof fgui.GGraph)) {
        const tinted = n as NativeImage | NativeLoader | NativeMovieClip | NativeGraph;
        return {get: () => colorNumber(tinted.color), set: v => { tinted.color = fromColor(numberText(v)); }};
      }
      return null;
    }
    supports(prop: TweenProp): boolean {
      const n = this.native;
      if (BASE_PROPS.includes(prop) || this.look(prop)) return true;
      if (prop === 'fillAmount') return (n instanceof fgui.GImage || n instanceof fgui.GLoader) && (n as NativeImage).fillMethod !== 0;
      return prop === 'progress' && n instanceof fgui.GProgressBar;
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
        case 'fillAmount': return (n as NativeImage).fillAmount;
        case 'progress': { const bar = n as NativeProgress; return bar.max ? bar.value / bar.max * 100 : 0; }
        default: return this.look(prop)?.get() ?? 0;
      }
    }
    // 每写一次是一次 PuerTS 跨边界调用；只改这一项。
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
        case 'fillAmount': (n as NativeImage).fillAmount = value; break;
        case 'progress': { const bar = n as NativeProgress; bar.value = value / 100 * bar.max; break; }
        default: this.look(prop)?.set(value);
      }
    }
    // 按钮、标签的标题颜色、字号、文字就是标题文字控件的：它自己的齿轮也算。
    ownerOf(prop: TweenProp | 'text'): string | null {
      const gear = GEAR_OF[prop];
      if (!gear) return null;
      const n = this.native;
      const title = (prop === 'color' || prop === 'fontSize' || prop === 'text') && (n instanceof fgui.GButton || n instanceof fgui.GLabel) ? (n as NativeButton | NativeLabel).GetTextField() : null;
      for (const o of title ? [n, title] : [n]) {
        const controller = services.gearController(o, gear[0]);
        if (controller) return `齿轮 ${gear[1]}（控制器 ${controller}）`;
      }
      return null;
    }
    track(off: Unsubscribe): Unsubscribe {
      let active = true;
      const release = (): void => { if (!active) return; active = false; this.subscriptions.delete(release); if (!this.subscriptions.size) activeObjects.delete(this); off(); };
      this.subscriptions.add(release);
      activeObjects.add(this);
      return release;
    }
    protected listen(listener: NativeEventListener, callback: NativeEventHandler): Unsubscribe {
      listener.Add(callback);
      return this.track(() => listener.Remove(callback));
    }
    release(): void { for (const off of [...this.subscriptions]) off(); }
    // FairyGUI 的命中测试（跳过不接收输入的控件），再按 GObject 一级级往上数到自己。
    hitDepth(x: number, y: number): number {
      let depth = 0;
      for (let object = services.hitTest(x, y); object; object = object.parent, depth++) if (object === this.native) return depth;
      return -1;
    }
    // 滚轮事件从命中的显示对象往上冒泡，所以只有落在自己（或里面的控件）上的才收到。
    onWheel(handler: (event: WheelInput) => void): Unsubscribe {
      const display = this.native.displayObject;
      if (!display) throw new LgRuntimeError('LGUI-RT-032', `${this.name} 没有显示对象（组），收不到滚轮。`, '把 wheel 绑在组里的控件或外面的组件上。');
      return this.listen(display.onMouseWheel, context => {
        const input = context.inputEvent;
        if (!input) return;
        const point = toPoint(input.x, input.y);
        handler({...point, deltaX: services.wheelDeltaX(), deltaY: input.mouseWheelDelta});
      });
    }
    onPointer(handler: (event: PointerInput) => void): Unsubscribe {
      let owners = pointers.get(this.native);
      if (!owners) { owners = new Set(); pointers.set(this.native, owners); }
      let previous: PointerInput | null = null;
      // A captured mouse move reaches both stage hover forwarding and the native
      // GObject monitor. Deduplicate each subscription using their shared input.
      const deliver = (input: PointerInput): void => {
        if (input === previous) return;
        previous = input;
        handler(input);
      };
      owners.add(deliver);
      const send = (type: PointerInput['type']): NativeEventHandler => context => {
        if (!context.inputEvent) return;
        if (type === 'down') context.CaptureTouch();
        deliver(toPointerInput(type, context));
      };
      const down = this.listen(this.native.onTouchBegin, send('down'));
      const move = this.listen(this.native.onTouchMove, send('move'));
      const up = this.listen(this.native.onTouchEnd, send('up'));
      return this.track(() => { down(); move(); up(); owners.delete(deliver); previous = null; if (!owners.size) pointers.delete(this.native); });
    }
  }

  class UnityComponent extends UnityObject implements UIComponent {
    constructor(readonly native: NativeComponent, readonly componentName: string) { super(native); }
    child(path: string): UIObject | null {
      let current: NativeObject | null = this.native;
      for (const name of path.split('.')) {
        if (!(current instanceof fgui.GComponent)) return null;
        current = current.GetChild(name);
        if (!current) return null;
      }
      return current ? wrap(current) : null;
    }
    childNames(): readonly string[] { return Array.from({length: this.native.numChildren}, (_, index) => this.native.GetChildAt(index).name); }
    controller(name: string): UIController | null {
      const native = this.native.GetController(name);
      if (!native) return null;
      let result = controllers.get(native);
      if (!result) { result = new UnityController(native, this); controllers.set(native, result); }
      return result;
    }
    transition(name: string): UITransition | null {
      const native = this.native.GetTransition(name);
      return native ? transitionOf(native) : null;
    }
    allTransitions(): readonly UITransition[] {
      const list = this.native.Transitions;
      return Array.from({length: list.Count}, (_, index) => transitionOf(list.get_Item(index)));
    }
    addChild(child: UIObject): void { this.native.AddChild(nativeOf(child)); }
    removeChild(child: UIObject): void { this.native.RemoveChild(nativeOf(child)); }
    dispose(): void { releaseTree(this.native); this.native.Dispose(); }
  }
  class UnityText extends UnityObject implements UIText {
    constructor(readonly native: NativeText) { super(native); }
    get text(): string { return this.native.text; }
    set text(value: string) { this.native.text = value; }
    get color(): string { return colorText(this.native.color); }
    set color(value: string) { this.native.color = fromColor(value); }
  }
  class UnityInput extends UnityText implements UIInput {
    constructor(readonly native: NativeTextInput) { super(native); }
    get promptText(): string { return this.native.promptText; }
    set promptText(value: string) { this.native.promptText = value; }
    onChange(handler: (value: string) => void): Unsubscribe { return this.listen(this.native.onChanged, () => handler(this.native.text)); }
  }
  /** FairyGUI.ButtonMode 的名字。不假定 PuerTS 给的是数字：数字按序号，字符串按名字，枚举对象用它的 ToString()；认不出的原样写出来。 */
  const buttonModeName = (value: unknown): string => {
    const names = ['Common', 'Check', 'Radio'];
    let name: unknown = value;
    if (typeof value === 'number') name = names[value];
    else if (value !== null && typeof value === 'object' && typeof (value as {ToString?: unknown}).ToString === 'function') name = (value as {ToString(): unknown}).ToString();
    return typeof name === 'string' && names.includes(name) ? name : `ButtonMode ${String(name ?? value)}`;
  };
  class UnityButton extends UnityComponent implements UIButton {
    constructor(readonly native: NativeButton, name: string) { super(native, name); }
    get title(): string { return this.native.title; }
    set title(value: string) { this.native.title = value; }
    get icon(): string { return this.native.icon; }
    set icon(value: string) { this.native.icon = value; }
    get selected(): boolean { return this.native.selected; }
    set selected(value: boolean) { this.native.selected = value; }
    get mode(): string { return buttonModeName(this.native.mode); }
    get sound(): string { return services.buttonSound(this.native); }
    get soundVolume(): number { return this.native.soundVolumeScale; }
    private effect: UIButton['downEffect'] | null = null;
    // 第一次读时：downEffect="scale" 的关掉 FairyGUI 自己的一下子缩小（框架接管，带缓动），记下倍数；dark 还是 FairyGUI 的。
    get downEffect(): UIButton['downEffect'] {
      if (!this.effect) {
        const raw = services.downEffect(this.native);
        this.effect = {type: raw.type === 2 ? 'scale' : raw.type === 1 ? 'dark' : 'none', value: raw.value};
        if (raw.type === 2) services.disableDownEffect(this.native);
      }
      return this.effect;
    }
    private press = 1;
    private pressBase: [number, number] | null = null;
    get pressScale(): number { return this.press; }
    // FairyGUI-unity 的按下缩放本来就改 GObject 的 scale（轴心在按钮中间，上游设的）；这里一样，只是带缓动。
    set pressScale(value: number) {
      if (!this.pressBase) this.pressBase = [this.native.scaleX, this.native.scaleY];
      this.press = value;
      this.native.SetScale(this.pressBase[0] * value, this.pressBase[1] * value);
      if (value === 1) this.pressBase = null;
    }
  }
  class UnityImage extends UnityObject implements UIImage {
    constructor(readonly native: NativeImage) { super(native); }
    get fillMethod(): UIImage['fillMethod'] { return fillMethods[this.native.fillMethod]; }
    set fillMethod(value: UIImage['fillMethod']) { this.native.fillMethod = fillMethods.indexOf(value); }
    get fillOrigin(): number { return this.native.fillOrigin; }
    set fillOrigin(value: number) { this.native.fillOrigin = value; }
    get fillClockwise(): boolean { return this.native.fillClockwise; }
    set fillClockwise(value: boolean) { this.native.fillClockwise = value; }
    get fillAmount(): number { return this.native.fillAmount; }
    set fillAmount(value: number) { this.native.fillAmount = value; }
  }
  class UnityLoader extends UnityObject implements UILoader {
    private loads = new Set<() => void>();
    private errors = new Set<(url: string) => void>();
    constructor(readonly native: NativeLoader) { super(native); }
    get url(): string { return this.native.url ?? ''; }
    set url(value: string) {
      this.native.url = value;
      if (!value.startsWith('ui://')) return;
      const item = fgui.UIPackage.GetItemByURL(value);
      // Image 和 Component 在赋 url 时同步加载；MovieClip 的帧不暴露为 texture。
      const loaded = item && (this.native.texture != null || this.native.component != null || item.type === 1);
      if (loaded) { for (const handler of [...this.loads]) handler(); }
      else { for (const handler of [...this.errors]) handler(value); }
    }
    onLoad(handler: () => void): Unsubscribe {
      this.loads.add(handler);
      const off = this.listen(this.native.onLoaded, event => { if (event.data === this.url) handler(); });
      return this.track(() => { this.loads.delete(handler); off(); });
    }
    onError(handler: (url: string) => void): Unsubscribe {
      this.errors.add(handler);
      const off = this.listen(this.native.onLoadError, event => { if (event.data === this.url) handler(this.url); });
      return this.track(() => { this.errors.delete(handler); off(); });
    }
  }
  class UnityList extends UnityObject implements UIList {
    private renderer: UIList['itemRenderer'] = null;
    private isVirtual = false;
    private selected = -1;
    constructor(readonly native: NativeList) { super(native); }
    get numItems(): number { return this.native.numItems; }
    set numItems(value: number) { this.native.numItems = value; if (this.selected >= value) this.selectedIndex = -1; }
    get itemRenderer(): UIList['itemRenderer'] { return this.renderer; }
    set itemRenderer(value: UIList['itemRenderer']) {
      this.renderer = value;
      this.native.itemRenderer = value ? (index, item) => value(index, wrapComponent(item)) : null;
      if (value) activeLists.add(this); else activeLists.delete(this);
    }
    get scrollable(): boolean { return this.native.scrollPane != null; }
    get virtual(): boolean { return this.isVirtual; }
    set virtual(value: boolean) {
      if (value === this.isVirtual) return;
      if (!value) throw new LgRuntimeError('LGUI-RT-021', '列表一旦设成虚拟列表就不能改回去。', '在第一次给数据之前决定要不要虚拟列表。');
      this.native.SetVirtual(); this.isVirtual = true;
    }
    get scrollPosition(): {x: number; y: number} { const pane = this.native.scrollPane; return {x: pane?.posX ?? 0, y: pane?.posY ?? 0}; }
    set scrollPosition(value: {x: number; y: number}) { this.native.scrollPane?.ScrollToView(toRect(value.x, value.y, 0, 0), false, true); }
    get selectedIndex(): number { return this.selected; }
    set selectedIndex(value: number) { this.selected = value; this.native.selectedIndex = value; }
    onClickItem(handler: (index: number) => void): Unsubscribe {
      return this.listen(this.native.onClickItem, event => {
        const item = event.data as NativeObject;
        const child = this.native.GetChildIndex(item);
        if (child < 0) return;
        this.selected = this.native.ChildIndexToItemIndex(child);
        handler(this.selected);
      });
    }
    itemAt(index: number): UIComponent | null {
      if (index < 0 || index >= this.native.numItems) return null;
      const child = this.native.ItemIndexToChildIndex(index);
      return child < 0 || child >= this.native.numChildren ? null : wrapComponent(this.native.GetChildAt(child));
    }
    scrollToView(index: number): void { this.native.ScrollToView(index, false); }
    override release(): void { super.release(); this.itemRenderer = null; }
  }
  class UnityProgress extends UnityComponent implements UIProgress {
    constructor(readonly native: NativeProgress, name: string) { super(native, name); }
    get value(): number { return this.native.value; }
    set value(value: number) { this.native.value = value; }
    get max(): number { return this.native.max; }
    set max(value: number) { this.native.max = value; }
  }
  class UnityLabel extends UnityComponent implements UILabel {
    constructor(readonly native: NativeLabel, name: string) { super(native, name); }
    get title(): string { return this.native.title ?? ''; }
    set title(value: string) { this.native.title = value; }
    get icon(): string { return this.native.icon ?? ''; }
    set icon(value: string) { this.native.icon = value; }
  }
  class UnitySlider extends UnityComponent implements UISlider {
    constructor(readonly native: NativeSlider, name: string) { super(native, name); }
    get value(): number { return this.native.value; }
    set value(value: number) { this.native.value = value; }
    get min(): number { return this.native.min; }
    set min(value: number) { this.native.min = value; }
    get max(): number { return this.native.max; }
    set max(value: number) { this.native.max = value; }
    // FairyGUI 只在用户拖动或点击时发 onChanged，代码设置不发。
    onChange(handler: (value: number) => void): Unsubscribe { return this.listen(this.native.onChanged, () => handler(this.native.value)); }
  }
  // 下拉框：选中序号统一成「在范围内，否则 -1」。FairyGUI 给 items 时会把 -1 改成 0、把超出的改成最后一项，这里改回来，和 h5、headless 一致。
  class UnityComboBox extends UnityComponent implements UIComboBox {
    constructor(readonly native: NativeComboBox, name: string) { super(native, name); }
    get items(): readonly string[] { const list = this.native.itemList; return Array.from({length: list.Count}, (_, index) => list.get_Item(index)); }
    set items(value: readonly string[]) {
      const keep = this.selectedIndex;
      const list = this.native.itemList;
      list.Clear();
      for (const item of value) list.Add(item);
      this.native.ApplyListChange();
      this.selectedIndex = keep;
    }
    get selectedIndex(): number { const index = this.native.selectedIndex; return index >= 0 && index < this.native.itemList.Count ? index : -1; }
    set selectedIndex(value: number) { this.native.selectedIndex = value >= 0 && value < this.native.itemList.Count ? value : -1; }
    get text(): string { return this.native.text ?? ''; }
    onChange(handler: (index: number) => void): Unsubscribe { return this.listen(this.native.onChanged, () => handler(this.selectedIndex)); }
  }
  class UnityMovieClip extends UnityObject implements UIMovieClip {
    constructor(readonly native: NativeMovieClip) { super(native); }
    get playing(): boolean { return this.native.playing; }
    set playing(value: boolean) { this.native.playing = value; }
    get frame(): number { return this.native.frame; }
    set frame(value: number) { this.native.frame = value; }
  }
  // 树：每次换数据整棵重建（子项组件回到 FairyGUI 的对象池再复用），展开状态按 key 记下来；选中项自己记一份（和列表一样）。
  class UnityTree extends UnityObject implements UITree {
    private renderer: ((key: Key, item: UIComponent) => void) | null = null;
    private readonly nodes = new Map<Key, NativeTreeNode>();
    private readonly keys = new Map<NativeTreeNode, Key>();
    private readonly expanded = new Map<Key, boolean>();
    private selected: Key | null = null;
    constructor(readonly native: NativeTree) { super(native); }
    get nodeRenderer(): ((key: Key, item: UIComponent) => void) | null { return this.renderer; }
    set nodeRenderer(value: ((key: Key, item: UIComponent) => void) | null) {
      this.renderer = value;
      this.native.treeNodeRender = value ? (node, cell) => { const key = this.keys.get(node); if (key !== undefined) value(key, wrapComponent(cell)); } : null;
      if (value) activeLists.add(this); else activeLists.delete(this);
    }
    setNodes(list: readonly UITreeNode[]): void {
      for (const [key, node] of this.nodes) this.expanded.set(key, node.expanded);
      const pane = this.native.scrollPane;
      const position = {x: pane?.posX ?? 0, y: pane?.posY ?? 0};
      this.native.rootNode.RemoveChildren(0, -1);
      this.nodes.clear();
      this.keys.clear();
      const add = (parent: NativeTreeNode, items: readonly UITreeNode[]): void => {
        for (const item of items) {
          const node = new fgui.GTreeNode(item.children.length > 0);
          node.expanded = this.expanded.get(item.key) ?? true;
          this.nodes.set(item.key, node);
          this.keys.set(node, item.key);
          parent.AddChild(node);
          add(node, item.children);
        }
      };
      add(this.native.rootNode, list);
      for (const key of [...this.expanded.keys()]) if (!this.nodes.has(key)) this.expanded.delete(key);
      this.selectedKey = this.selected !== null && this.nodes.has(this.selected) ? this.selected : null;
      if (pane) { this.native.EnsureBoundsCorrect(); pane.SetPosX(position.x, false); pane.SetPosY(position.y, false); }
    }
    get selectedKey(): Key | null { return this.selected; }
    set selectedKey(key: Key | null) {
      this.selected = key;
      this.native.ClearSelection();
      const node = key === null ? undefined : this.nodes.get(key);
      if (node) this.native.SelectNode(node, false);
    }
    get numItems(): number { return this.native.numChildren; }
    itemAt(index: number): UIComponent | null { return index >= 0 && index < this.native.numChildren ? wrapComponent(this.native.GetChildAt(index)) : null; }
    onClickNode(handler: (key: Key) => void): Unsubscribe {
      return this.listen(this.native.onClickItem, event => {
        for (const [node, key] of this.keys) {
          if (node.cell !== event.data) continue;
          this.selected = key;
          handler(key);
          return;
        }
      });
    }
    override release(): void { super.release(); this.nodeRenderer = null; }
  }
  class UnityGraph extends UnityObject implements UIGraph {
    constructor(readonly native: NativeGraph) { super(native); }
    get color(): string { return colorText(this.native.color, true); }
    set color(value: string) { this.native.color = fromColor(value); }
  }
  class UnityController implements UIController {
    constructor(readonly native: NativeController, private owner: UnityComponent) {}
    get name(): string { return this.native.name; }
    get selectedPage(): string { return this.native.selectedPage; }
    set selectedPage(value: string) {
      if (!this.pages.includes(value)) throw new LgRuntimeError('LGUI-RT-022', `控制器 ${this.name} 没有页 ${value}。`, `能用的页：${this.pages.join('、')}。`);
      this.native.selectedPage = value;
    }
    get pages(): readonly string[] { return Array.from({length: this.native.pageCount}, (_, index) => this.native.GetPageName(index)); }
    onChange(handler: (page: string) => void): Unsubscribe {
      const callback: NativeEventHandler = () => handler(this.native.selectedPage);
      this.native.onChanged.Add(callback);
      return this.owner.track(() => this.native.onChanged.Remove(callback));
    }
  }
  class UnityTransition implements UITransition {
    constructor(readonly native: NativeTransition) {}
    get name(): string { return this.native.name; }
    get settings(): UITransition['settings'] { return services.transitionSettings(this.native); }
    get playing(): boolean { return this.native.playing; }
    play(options: {times?: number; delay?: number} = {}, onComplete?: () => void): void {
      // FairyGUI 重播时会把上一次当作放完（调用它的回调）；先不带回调停掉，只有正常放完才通知。FairyGUI 的 delay 是秒。
      this.native.Stop(true, false);
      this.native.Play(options.times ?? 1, (options.delay ?? 0) / 1000, () => onComplete?.());
    }
    stop(): void { this.native.Stop(true, false); }
    setPaused(paused: boolean): void { this.native.SetPaused(paused); }
    touches(): readonly {target: UIObject; what: TransitionTouch}[] {
      return services.transitionItems(this.native).flatMap(item => {
        const what = TOUCHES[item.type];
        return what && item.target ? [{target: wrap(item.target), what}] : [];
      });
    }
  }

  function releaseTree(native: NativeObject): void {
    const object = cache.get(native);
    object?.release();
    // Native GComponent.Dispose destroys descendants without invoking their
    // wrappers. Drop backend ownership for every released component in the tree.
    if (object instanceof UnityComponent) onComponentReleased?.(object);
    if (native instanceof fgui.GComponent) for (let index = 0; index < native.numChildren; index++) releaseTree(native.GetChildAt(index));
  }
  function transitionOf(native: NativeTransition): UITransition {
    let result = transitions.get(native);
    if (!result) { result = new UnityTransition(native); transitions.set(native, result); }
    return result;
  }
  function setComponentName(native: NativeObject, name: string): void { names.set(native, name); }
  function wrap(native: NativeObject): UIObject {
    const existing = cache.get(native);
    if (existing) return existing;
    const item = native.packageItem;
    const name = names.get(native) ?? (item ? `${item.owner.name}/${item.name}` : '');
    let result: UnityObject;
    if (native instanceof fgui.GTree) result = new UnityTree(native);
    else if (native instanceof fgui.GList) result = new UnityList(native);
    else if (native instanceof fgui.GButton) result = new UnityButton(native, name);
    else if (native instanceof fgui.GProgressBar) result = new UnityProgress(native, name);
    else if (native instanceof fgui.GLabel) result = new UnityLabel(native, name);
    else if (native instanceof fgui.GSlider) result = new UnitySlider(native, name);
    else if (native instanceof fgui.GComboBox) result = new UnityComboBox(native, name);
    else if (native instanceof fgui.GComponent) result = new UnityComponent(native, name);
    else if (native instanceof fgui.GTextInput) result = new UnityInput(native);
    else if (native instanceof fgui.GTextField) result = new UnityText(native);
    else if (native instanceof fgui.GImage) result = new UnityImage(native);
    else if (native instanceof fgui.GLoader) result = new UnityLoader(native);
    else if (native instanceof fgui.GGraph) result = new UnityGraph(native);
    else if (native instanceof fgui.GMovieClip) result = new UnityMovieClip(native);
    else result = new UnityObject(native);
    cache.set(native, result); natives.set(result, native);
    return result;
  }
  function wrapComponent(native: NativeObject): UIComponent {
    const result = wrap(native);
    if (!(result instanceof UnityComponent)) throw new LgRuntimeError('LGUI-RT-023', `${native.name} 不是组件。`, '检查 ui/ 里这个控件的类型。');
    return result;
  }
  function nativeOf(object: UIObject): NativeObject {
    const native = natives.get(object);
    if (!native) throw new LgRuntimeError('LGUI-RT-024', `${object.name} 不是这个 Unity 后端创建的对象。`, '不要混用不同后端的对象。');
    return native;
  }
  function dispose(): void {
    for (const object of [...activeObjects]) object.release();
    for (const list of [...activeLists]) list.release();
    pointers.clear();
    clearPointerCache();
  }
  return {wrap, wrapComponent, nativeOf, setComponentName, toPointerInput, clearPointerCache, dispatchHover, dispose};
}
