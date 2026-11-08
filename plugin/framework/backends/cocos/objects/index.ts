// 把 fairygui-cc 的对象包成接口层的 UI 对象。每个对象只包一次（WeakMap 缓存），事件一律返回取消函数。
// 从 h5 的 objects/index.ts 移植；差异都在注释里标了。
import {Rect as CcRect, Vec2} from 'cc';
import * as fgui from 'fairygui-cc';
import type {
  PointerInput, Rect, UIObject, UIComponent, UIText, UIInput, UIButton, UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph, Unsubscribe,
  UILabel, UISlider, UIComboBox, UIMovieClip, UITree, UITreeNode, WheelInput
} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';
import {stage} from '../screen';
import {toPointerInput, domWheel} from '../pointer';
import type {FguiEventOf} from '../pointer';
import {isComposing} from '../ime';

const toHex = (color: fgui.FguiColor): string => '#' + [color.r, color.g, color.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const fromHex = (value: string): fgui.FguiColor => {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!match) throw new LgRuntimeError('LGUI-RT-020', `颜色 ${value} 的格式不对。`, '写成 #rrggbb。');
  const hex = match[1].slice(-6);
  return {r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16)};
};

// 订阅 FairyGUI 事件，返回取消函数。
function listen(target: fgui.EventDispatcher, type: string, handler: (event: fgui.Event) => void): Unsubscribe {
  target.on(type, handler);
  return () => target.off(type, handler);
}

// 原始指针事件（按下/移动/抬起，多点）：运行库把事件冒泡到祖先，控件收到的是带舞台坐标的同一事件。
const pointerTypes = [fgui.Event.TOUCH_BEGIN, fgui.Event.TOUCH_MOVE, fgui.Event.TOUCH_END];

class CocosObject implements UIObject {
  // 可用、接收输入分开记，一起决定 FairyGUI 的 touchable（同 h5：直接写会被齿轮/换层改回去）。
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
  // 真的显示：自己一路往上每级都没被齿轮/组藏起来（_finalVisible 含 visible+齿轮+组；父级隐藏要靠逐级走）。
  get shown(): boolean {
    for (let o: fgui.GObject | null = this.native; o; o = o.parent) if (!o._finalVisible) return false;
    return true;
  }
  get enabled(): boolean { return this.isEnabled; }
  set enabled(value: boolean) { this.isEnabled = value; this.native.grayed = !value; this.native.touchable = value && this.isTouchable; }
  get customData(): string { return this.native.data == null ? '' : String(this.native.data); }
  get touchable(): boolean { return this.isTouchable; }
  set touchable(value: boolean) { this.isTouchable = value; this.native.touchable = value && this.isEnabled; }
  get rect(): Rect { return {x: this.native.x, y: this.native.y, width: this.native.width, height: this.native.height}; }
  set rect(value: Rect) { this.native.setPosition(value.x, value.y); this.native.setSize(value.width, value.height); }
  onPointer(handler: (event: PointerInput) => void): Unsubscribe {
    const offs = pointerTypes.map(type => listen(this.native, type, event => {
      // 和 fairygui-dom 的自动指针捕获对齐：按下的控件持续收到 move/end——控件级手势（拖拽、hold）依赖它，
      // 不捕获的话 move 只给命中目标本身，拖出控件后流就断了（T008d 实测：drag-drop 拖不起来）。
      if (type === fgui.Event.TOUCH_BEGIN) (event as unknown as {captureTouch?: () => void}).captureTouch?.();
      const input = toPointerInput(event as FguiEventOf);
      // 坐标统一成设计单位（÷stage.scale，和 platform 层同一把尺子）：fairy 事件的 pos 是 GRoot 单位，
      // 控件级事件（本方法）和舞台级事件（platform 的 root 监听）会被手势层当同一条流消费，
      // 两边单位不一致时 scale≠1 的窗口里每次点击都被算成「移过」、click 全灭（T008c EXACT_FIT 实测）。
      const k = stage.scale || 1;
      handler({...input, x: input.x / k, y: input.y / k});
    }));
    return () => { for (const off of offs) off(); };
  }
  // 运行库做命中测试：取最上面的可点控件，往上数到自己是第几层。
  // hitTest 收的是「fairy 空间」的点（y 向下、GRoot 单位）——InputProcessor.updateInfo 在 screenToWorld 之后
  // 按 rootSize 翻 y 得到的就是它，设计单位 × stage.scale 还原，不做 y 翻转（旧实现走 toWorld 翻 y，
  // 落点全偏到面板 bg 上、drop 永远不中——T008c 地面真相配对实测：事件 pos 与设计点同值，翻 y 的反而不中）。
  hitDepth(x: number, y: number): number {
    const k = stage.scale || 1;
    const hit = fgui.GRoot.inst.hitTest(new Vec2(x * k, y * k), true);
    if (!hit) return -1;
    let depth = 0;
    for (let o: fgui.GObject | null = hit; o; o = o.parent, depth++) if (o === this.native) return depth;
    return -1;
  }
  onWheel(handler: (event: WheelInput) => void): Unsubscribe {
    // 增量取 DOM 地面真相（domWheel，正 = 向下，h5 同）：运行库的 mouseWheelDelta 向下滚恒为 0（pointer.ts 注释）。
    // 事件本身仍用运行库的 MOUSE_WHEEL：命中目标、坐标都是它定的；坐标换算成设计单位（同 onPointer）。
    return listen(this.native, fgui.Event.MOUSE_WHEEL, event => {
      const pos = (event as unknown as FguiEventOf).pos;
      const k = stage.scale || 1;
      handler({x: pos.x / k, y: pos.y / k, deltaX: domWheel.deltaX, deltaY: domWheel.deltaY});
    });
  }
}

class CocosComponent extends CocosObject implements UIComponent {
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

class CocosText extends CocosObject implements UIText {
  constructor(readonly native: fgui.GTextField) { super(native); }
  // 空文本归一成 ''：GTextInput 没输入过时 native.text 是 undefined，规范语义是字符串（headless/h5 同）。
  get text(): string { return this.native.text ?? ''; }
  set text(value: string) { this.native.text = value; }
  get color(): string { return toHex(this.native.color); }
  set color(value: string) { this.native.color = fromHex(value); }
}

class CocosInput extends CocosText implements UIInput {
  private prompt = '';
  constructor(readonly native: fgui.GTextInput) { super(native); }
  // getter 必须显式重复：子类原型上只写 set 会遮蔽父类的 get，读 text 直接 undefined（T008d 实测）。
  get text(): string { return this.native.text ?? ''; }
  // 文字没变就不写：写一次会把光标挪到最后（同 h5）。
  set text(value: string) {
    if (this.native.text === value) return;
    this.native.text = value;
    // cc EditBox 聚焦期间不把程序化文本传到 DOM input（_edTxt 是唯一真值，回写只更新 label）——
    // 聚焦时直写 _edTxt，让「绑定把 Model 值写回输入框」的回写对正在打字的人生效，
    // 否则下一个字接在旧文字上、和 h5 的回写语义分裂（T008d input 用例实测）。
    const edTxt = (this.native as unknown as {_editBox?: {_impl?: {_edTxt?: HTMLInputElement | HTMLTextAreaElement}}})._editBox?._impl?._edTxt;
    if (edTxt && document.activeElement === edTxt) edTxt.value = value;
  }
  get promptText(): string { return this.prompt; }
  set promptText(value: string) { this.prompt = value; this.native.promptText = value; }
  // 组字期间不通知，选完通知一次；有的浏览器选完还会再发一次 input，跳过（同 h5 的语义，事件源换成 TEXT_CHANGE）。
  onChange(handler: (text: string) => void): Unsubscribe {
    let ended: string | null = null;
    return listen(this.native, fgui.Event.TEXT_CHANGE, () => {
      const text = this.native.text;
      const repeat = ended === text;
      ended = null;
      if (isComposing()) { ended = text; return; }
      if (!repeat) handler(text);
    });
  }
}

/** ButtonMode（0、1、2）对应的名字。 */
const buttonModes = ['Common', 'Check', 'Radio'];

class CocosButton extends CocosComponent implements UIButton {
  constructor(readonly native: fgui.GButton, componentName: string) { super(native, componentName); }
  get title(): string { return this.native.title ?? ''; }
  set title(value: string) { this.native.title = value; }
  get icon(): string { return this.native.icon ?? ''; }
  set icon(value: string) { this.native.icon = value; }
  get selected(): boolean { return this.native.selected; }
  set selected(value: boolean) { this.native.selected = value; }
  get mode(): string { return buttonModes[this.native.mode] ?? `ButtonMode ${this.native.mode}`; }
  get sound(): string { return this.native.sound ?? ''; }
  get soundVolume(): number { return this.native.soundVolumeScale ?? 1; }
}

const fillMethods = ['none', 'horizontal', 'vertical', 'radial90', 'radial180', 'radial360'] as const;

class CocosImage extends CocosObject implements UIImage {
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

class CocosLoader extends CocosObject implements UILoader {
  private loads = new Set<() => void>();
  private errors = new Set<(url: string) => void>();
  private current = '';
  constructor(readonly native: fgui.GLoader) { super(native); }
  get url(): string { return this.current; }
  set url(value: string) {
    this.current = value;
    this.native.url = value;
    if (!value) return;
    // ui:// 是包里的图片，包加载后同步就绪；网络图片用探测 img 判断成功失败（运行库的加载器不报错，同 h5）。
    if (value.startsWith('ui://')) { for (const handler of Array.from(this.loads)) handler(); return; }
    if (typeof Image === 'undefined') { for (const handler of Array.from(this.loads)) handler(); return; } // 原生目标：T012 再接网络图
    const probe = new Image();
    probe.onload = () => { if (this.current === value) for (const handler of Array.from(this.loads)) handler(); };
    probe.onerror = () => { if (this.current === value) for (const handler of Array.from(this.errors)) handler(value); };
    probe.src = value;
  }
  onLoad(handler: () => void): Unsubscribe { this.loads.add(handler); return () => { this.loads.delete(handler); }; }
  onError(handler: (url: string) => void): Unsubscribe { this.errors.add(handler); return () => { this.errors.delete(handler); }; }
}

class CocosList extends CocosObject implements UIList {
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
  set scrollPosition(value: {x: number; y: number}) { this.native.scrollPane?.scrollToView(new CcRect(value.x, value.y, 0, 0), false, true); }
  // 选中项自己记一份：FairyGUI 只把按钮类型的子项当成可选中的，非按钮子项的选中会丢（同 h5，与 headless 一致）。
  private selected = -1;
  get selectedIndex(): number { return this.selected; }
  set selectedIndex(value: number) { this.selected = value; this.native.selectedIndex = value; }
  onClickItem(handler: (index: number) => void): Unsubscribe {
    // CLICK_ITEM 是运行库的 GList.dispatchItemEvent 用 cc 节点事件派发的（_node.emit(CLICK_ITEM, item, evt)），
    // 监听参数是 (item, evt)，不是带 initiator 的 fairy Event——拿 initiator 会得到 undefined、
    // childIndex 算出 -1，绑定层按越界静默丢弃（T008c list-rotate 实测，此前从未被测过）。
    return listen(this.native, fgui.Event.CLICK_ITEM, (item: fgui.GObject) => {
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

class CocosProgress extends CocosComponent implements UIProgress {
  constructor(readonly native: fgui.GProgressBar, componentName: string) { super(native, componentName); }
  get value(): number { return this.native.value; }
  set value(value: number) { this.native.value = value; }
  get max(): number { return this.native.max; }
  set max(value: number) { this.native.max = value; }
}

class CocosLabel extends CocosComponent implements UILabel {
  constructor(readonly native: fgui.GLabel, componentName: string) { super(native, componentName); }
  get title(): string { return this.native.title ?? ''; }
  set title(value: string) { this.native.title = value; }
  get icon(): string { return this.native.icon ?? ''; }
  set icon(value: string) { this.native.icon = value; }
}

class CocosSlider extends CocosComponent implements UISlider {
  constructor(readonly native: fgui.GSlider, componentName: string) { super(native, componentName); }
  get value(): number { return this.native.value; }
  set value(value: number) { this.native.value = value; }
  get min(): number { return this.native.min; }
  set min(value: number) { this.native.min = value; }
  get max(): number { return this.native.max; }
  set max(value: number) { this.native.max = value; }
  // 滑动条的 changed 事件与控制器/下拉框共用 STATUS_CHANGED（C# 语义如此；T007 实测校准）。
  onChange(handler: (value: number) => void): Unsubscribe { return listen(this.native, fgui.Event.STATUS_CHANGED, () => handler(this.native.value)); }
}

// 下拉框：选中序号统一成「在范围内，否则 -1」（FairyGUI 给 items 时会改 -1/超出的，同 h5）。
class CocosComboBox extends CocosComponent implements UIComboBox {
  constructor(readonly native: fgui.GComboBox, componentName: string) { super(native, componentName); }
  get items(): readonly string[] { return this.native.items; }
  set items(value: readonly string[]) { const keep = this.selectedIndex; this.native.items = [...value]; this.selectedIndex = keep; }
  get selectedIndex(): number { const index = this.native.selectedIndex; return index >= 0 && index < this.native.items.length ? index : -1; }
  set selectedIndex(value: number) { this.native.selectedIndex = value >= 0 && value < this.native.items.length ? value : -1; }
  get text(): string { return this.native.text ?? ''; }
  onChange(handler: (index: number) => void): Unsubscribe { return listen(this.native, fgui.Event.STATUS_CHANGED, () => handler(this.selectedIndex)); }
}

class CocosMovieClip extends CocosObject implements UIMovieClip {
  constructor(readonly native: fgui.GMovieClip) { super(native); }
  get playing(): boolean { return this.native.playing; }
  set playing(value: boolean) { this.native.playing = value; }
  get frame(): number { return this.native.frame; }
  set frame(value: number) { this.native.frame = value; }
}

type Key = string | number;

// 树：每次换数据整棵重建（子项回对象池复用），展开状态按 key 记；选中项自己记（同 h5）。
class CocosTree extends CocosObject implements UITree {
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
    for (const key of Array.from(this.expanded.keys())) if (!this.nodes.has(key)) this.expanded.delete(key);
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
    // CLICK_ITEM 的 cc 节点事件参数是 (cell, evt)，同 CocosList.onClickItem（T008c tree 实测同病）。
    return listen(this.native, fgui.Event.CLICK_ITEM, (cell: fgui.GObject) => {
      for (const [node, key] of this.keys) {
        if (node.cell !== cell) continue;
        this.selected = key;
        handler(key);
        return;
      }
    });
  }
}

class CocosGraph extends CocosObject implements UIGraph {
  constructor(readonly native: fgui.GGraph) { super(native); }
  get color(): string { return toHex(this.native.color); }
  set color(value: string) { this.native.color = fromHex(value); }
}

class CocosController implements UIController {
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
  onChange(handler: (page: string) => void): Unsubscribe { return listen(this.native, fgui.Event.STATUS_CHANGED, () => handler(this.native.selectedPage)); }
}

class CocosTransition implements UITransition {
  constructor(readonly native: fgui.Transition) {}
  get name(): string { return this.native.name; }
  get settings(): UITransition['settings'] { return {autoPlay: this.native._autoPlay === true, times: this.native._autoPlayTimes ?? 1, delay: Math.round((this.native._autoPlayDelay ?? 0) * 1000)}; }
  get playing(): boolean { return this.native.playing; }
  play(options: {times?: number; delay?: number} = {}, onComplete?: () => void): void {
    // 重播时运行库会把上一次当作放完；先不带回调停掉，只有正常放完才通知（同 h5）。
    this.native.stop(true, false);
    this.native.play(onComplete, options.times ?? 1, (options.delay ?? 0) / 1000);
  }
  stop(): void { this.native.stop(true, false); }
  setPaused(paused: boolean): void { this.native.setPaused(paused); }
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
  if (native instanceof fgui.GTree) wrapped = new CocosTree(native);
  else if (native instanceof fgui.GList) wrapped = new CocosList(native);
  else if (native instanceof fgui.GButton) wrapped = new CocosButton(native, name);
  else if (native instanceof fgui.GProgressBar) wrapped = new CocosProgress(native, name);
  else if (native instanceof fgui.GLabel) wrapped = new CocosLabel(native, name);
  else if (native instanceof fgui.GSlider) wrapped = new CocosSlider(native, name);
  else if (native instanceof fgui.GComboBox) wrapped = new CocosComboBox(native, name);
  else if (native instanceof fgui.GComponent) wrapped = new CocosComponent(native, name);
  else if (native instanceof fgui.GTextInput) wrapped = new CocosInput(native);
  else if (native instanceof fgui.GTextField) wrapped = new CocosText(native);
  else if (native instanceof fgui.GImage) wrapped = new CocosImage(native);
  else if (native instanceof fgui.GLoader) wrapped = new CocosLoader(native);
  else if (native instanceof fgui.GGraph) wrapped = new CocosGraph(native);
  else if (native instanceof fgui.GMovieClip) wrapped = new CocosMovieClip(native);
  else wrapped = new CocosObject(native);
  cache.set(native, wrapped);
  natives.set(wrapped, native);
  return wrapped;
}

/** 包一个组件；不是组件时报错。 */
export function wrapComponent(native: fgui.GObject): UIComponent {
  const wrapped = wrap(native);
  if (!(wrapped instanceof CocosComponent)) throw new LgRuntimeError('LGUI-RT-023', `${native.name} 不是组件。`, '检查 ui/ 里这个控件的类型。');
  return wrapped;
}

function wrapController(native: fgui.Controller): UIController {
  let wrapped = controllerCache.get(native);
  if (!wrapped) { wrapped = new CocosController(native); controllerCache.set(native, wrapped); }
  return wrapped;
}

function wrapTransition(native: fgui.Transition): UITransition {
  let wrapped = transitionCache.get(native);
  if (!wrapped) { wrapped = new CocosTransition(native); transitionCache.set(native, wrapped); }
  return wrapped;
}

/** 接口对象 → FairyGUI 对象。 */
export function nativeOf(object: UIObject): fgui.GObject {
  const native = natives.get(object);
  if (!native) throw new LgRuntimeError('LGUI-RT-024', `${object.name} 不是 cocos 后端创建的对象。`, '不要混用不同后端的对象。');
  return native;
}
