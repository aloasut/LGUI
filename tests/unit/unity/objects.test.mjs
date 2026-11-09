import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importTs, typecheck} from '../../helpers/ts.mjs';

const entry = fileURLToPath(new URL('../../../plugin/framework/backends/unity/adapter/objects.ts', import.meta.url));
let implementation;
async function adapter(...args) {
  try { implementation ??= await importTs(entry); }
  catch (error) { assert.fail(`Unity UI object adapter is unavailable: ${error.message}`); }
  const [fgui, now, toPoint, onComponentReleased, services = noServices] = args;
  return implementation.createObjectAdapter(fgui, now, toPoint, (x, y, width, height) => new NativeRect(x, y, width, height), services, onComponentReleased);
}
const noServices = {wheelDeltaX: () => 0, hitTest: () => null, buttonSound: () => '', transitionSettings: () => ({autoPlay: false, times: 1, delay: 0})};

class NativeRect {
  constructor(x, y, width, height) { Object.assign(this, {x, y, width, height}); }
}

class Listener {
  handlers = new Set();
  Add(fn) { this.handlers.add(fn); }
  Remove(fn) { this.handlers.delete(fn); }
  AddCapture(fn) { this.Add(fn); }
  RemoveCapture(fn) { this.Remove(fn); }
  Call(data) { const event = data?.inputEvent ? data : {data, inputEvent: null}; for (const fn of [...this.handlers]) fn(event); }
}
// FairyGUI 的显示对象：父节点跟着 GObject 的父组件走。
class Display {
  visible = true; onMouseWheel = new Listener();
  constructor(owner) { this.gOwner = owner; }
  get parent() { return this.gOwner.parent?.displayObject ?? null; }
}
class Obj {
  name = ''; visible = true; grayed = false; touchable = true; onStage = true; displayObject = new Display(this);
  x = 0; y = 0; width = 10; height = 20; data = null; packageItem = null; parent = null;
  onTouchBegin = new Listener(); onTouchMove = new Listener(); onTouchEnd = new Listener();
  onRollOver = new Listener(); onRollOut = new Listener();
  SetXY(x, y) { this.x = x; this.y = y; }
  SetSize(width, height) { this.width = width; this.height = height; }
  get enabled() { return !this.grayed && this.touchable; }
  set enabled(value) { this.grayed = !value; this.touchable = value; }
  Dispose() { this.disposed = true; }
}
class Component extends Obj {
  children = []; controllers = new Map(); transitions = new Map();
  get numChildren() { return this.children.length; }
  GetChild(name) { return this.children.find(x => x.name === name) ?? null; }
  GetChildAt(index) { return this.children[index]; }
  GetChildIndex(child) { return this.children.indexOf(child); }
  GetController(name) { return this.controllers.get(name) ?? null; }
  GetTransition(name) { return this.transitions.get(name) ?? null; }
  get Transitions() { const list = [...this.transitions.values()]; return {Count: list.length, get_Item: index => list[index]}; }
  AddChild(child) { this.children.push(child); child.parent = this; return child; }
  RemoveChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
}
class Text extends Obj { text = ''; color = {r: 1, g: 1, b: 1, a: 1}; }
class Input extends Text { promptText = ''; onChanged = new Listener(); }
class Button extends Component { title = ''; icon = ''; selected = false; mode = 0; sound = null; soundVolumeScale = 1; }
class Label extends Component { title = null; icon = null; }
class Slider extends Component { value = 0; min = 0; max = 100; onChanged = new Listener(); }
// 和 FairyGUI 一样：ApplyListChange 把 -1 改成 0、把超出的改成最后一项。itemList 像 PuerTS 里的 C# List。
class ComboBox extends Component {
  list = []; index = -1; onChanged = new Listener();
  itemList = {owner: this, get Count() { return this.owner.list.length; }, get_Item(index) { return this.owner.list[index]; }, Clear() { this.owner.list.length = 0; }, Add(item) { this.owner.list.push(item); }};
  ApplyListChange() { this.index = !this.list.length ? -1 : this.index >= this.list.length ? this.list.length - 1 : this.index === -1 ? 0 : this.index; }
  get selectedIndex() { return this.index; }
  set selectedIndex(value) { this.index = value; }
  get text() { return this.list[this.index] ?? ''; }
}
class MovieClip extends Obj { playing = true; frame = 0; }
class Image extends Obj { fillMethod = 0; fillOrigin = 0; fillClockwise = true; fillAmount = 1; }
class Loader extends Obj { url = ''; texture = null; component = null; onLoaded = new Listener(); onLoadError = new Listener(); }
class Graph extends Obj { color = {r: 1, g: 1, b: 1, a: 1}; }
class Progress extends Component { value = 0; max = 100; }
class List extends Component {
  numItems = 0; itemRenderer = null; selectedIndex = -1; onClickItem = new Listener(); first = 0;
  scrollPane = {posX: 0, posY: 0, SetPosX(x) { this.posX = x; }, SetPosY(y) { this.posY = y; },
    ScrollToView(rect) { this.SetPosX(rect.x); this.SetPosY(rect.y); }};
  SetVirtual() { this.virtualCalls = (this.virtualCalls ?? 0) + 1; }
  ItemIndexToChildIndex(index) { return index - this.first; }
  ChildIndexToItemIndex(index) { return index + this.first; }
  ScrollToView(index) { this.scrolledTo = index; }
}
class TreeNode {
  expanded = false; cell = null; parent = null;
  constructor(hasChild) { this.children = hasChild ? [] : null; }
  AddChild(child) { this.children.push(child); child.parent = this; return child; }
  RemoveChildren(begin, end) { this.removed = [begin, end]; this.children.length = 0; }
}
// 树：显示着的节点按顺序当子控件，子项组件第一次显示时创建并交给 treeNodeRender。
class Tree extends List {
  rootNode = Object.assign(new TreeNode(true), {expanded: true}); treeNodeRender = null; selectedNode = null;
  shownNodes() { const out = []; const walk = node => { for (const child of node.children ?? []) { out.push(child); if (child.expanded) walk(child); } }; walk(this.rootNode); return out; }
  get numChildren() { return this.shownNodes().length; }
  GetChildAt(index) { const node = this.shownNodes()[index]; node.cell ??= new Component(); this.treeNodeRender?.(node, node.cell); return node.cell; }
  SelectNode(node, scroll) { this.selectedNode = node; this.scrolled = scroll; }
  ClearSelection() { this.selectedNode = null; }
  EnsureBoundsCorrect() { this.boundsCorrect = true; }
}
const fgui = {
  GComponent: Component, GTextField: Text, GTextInput: Input, GButton: Button,
  GImage: Image, GLoader: Loader, GList: List, GGraph: Graph, GProgressBar: Progress,
  GLabel: Label, GSlider: Slider, GComboBox: ComboBox, GMovieClip: MovieClip, GTree: Tree, GTreeNode: TreeNode,
  Stage: {touchScreen: false}, UIPackage: {GetItemByURL() { return null; }},
  Utils: {ToolSet: {ConvertFromHtmlColor(value) {
    const hex = value.slice(1); const alpha = hex.length === 8 ? parseInt(hex.slice(0, 2), 16) / 255 : 1;
    const rgb = hex.slice(-6);
    return {r: parseInt(rgb.slice(0, 2), 16) / 255, g: parseInt(rgb.slice(2, 4), 16) / 255, b: parseInt(rgb.slice(4, 6), 16) / 255, a: alpha};
  }}}
};
const context = (x, y, touchId = -1) => ({inputEvent: {x, y, touchId, button: 0}, data: null, CaptureTouch() { this.captured = true; }});

let backendImplementation;
async function containerBackend({platform = {}, fonts, defaultFont = null} = {}) {
  backendImplementation ??= await importTs(fileURLToPath(new URL('../../../plugin/framework/backends/unity/adapter/index.ts', import.meta.url)));
  class NativeComponent extends Component {
    disposeCalls = 0;
    Dispose() {
      this.disposeCalls++;
      // FairyGUI GComponent.Dispose recursively disposes its native children;
      // those child calls do not invoke their TypeScript wrapper.dispose().
      for (const child of [...this.children]) child.Dispose();
      this.children.length = 0;
      super.Dispose();
    }
  }
  const captures = new Map();
  const stage = {
    AddCapture(name, handler) { if (!captures.has(name)) captures.set(name, new Set()); captures.get(name).add(handler); },
    RemoveCapture(name, handler) { captures.get(name)?.delete(handler); }
  };
  const bridge = {
    UnityEngine: {Rect: NativeRect},
    FairyGUI: {...fgui, GComponent: NativeComponent, GRoot: {inst: new NativeComponent()},
      Stage: {touchScreen: false, inst: stage}, UIConfig: {defaultFont: ''},
      UIPackage: {...fgui.UIPackage, GetByName() { return {}; }, CreateObject() { return new NativeComponent(); }}},
    LGUI: {Platform: {Now: 0, ScreenWidth: 1280, ScreenHeight: 720, ...platform}, LGUIResourceLoader: Loader}
  };
  const backend = backendImplementation.createUnityBackend(bridge);
  await backend.init({projectName: 'containers', defaultFont, fonts, uiBase: 'UI'});
  return {backend, bridge, dispose: () => globalThis.__lguiDispose?.()};
}

test('Unity wrappers preserve object identity, nested lookup and native ownership', async () => {
  const a = await adapter(fgui, () => 100, (x, y) => ({x: x / 2, y: y / 2}));
  const root = new Component(); root.name = 'root';
  const sub = new Component(); sub.name = 'header'; root.AddChild(sub);
  const text = new Text(); text.name = 'title'; sub.AddChild(text);
  a.setComponentName(root, 'Bag/Panel');
  const wrapped = a.wrapComponent(root);
  assert.equal(wrapped.componentName, 'Bag/Panel');
  assert.strictEqual(a.wrap(root), wrapped);
  assert.strictEqual(wrapped.child('header.title'), a.wrap(text));
  assert.equal(wrapped.child('header.missing'), null);
  assert.equal(wrapped.child('header.title.nope'), null);
  assert.deepEqual(wrapped.childNames(), ['header']);
  const label = wrapped.child('header.title'); label.text = '金币'; label.color = '#1234ab';
  assert.equal(text.text, '金币'); assert.equal(label.color, '#1234ab');
  assert.throws(() => { label.color = 'not a color'; }, {code: 'LGUI-RT-020'});
  label.rect = {x: 2, y: 3, width: 40, height: 50};
  assert.deepEqual(label.rect, {x: 2, y: 3, width: 40, height: 50});
  assert.strictEqual(a.nativeOf(label), text);
  assert.throws(() => a.nativeOf({name: 'alien'}), {code: 'LGUI-RT-024'});
  assert.throws(() => a.wrapComponent(text), {code: 'LGUI-RT-023'});
});

test('Unity pointer subscribers share normalized input with the stage and detach the same delegates', async () => {
  let time = 100;
  const a = await adapter(fgui, () => time, (x, y) => ({x: x / 2, y: y / 2}));
  const native = new Button(); const wrapped = a.wrap(native); const events = [];
  const off = wrapped.onPointer(event => events.push(event));
  const event = context(40, 60, 7);
  fgui.Stage.touchScreen = true;
  native.onTouchBegin.Call(event);
  assert.deepEqual(events[0], {type: 'down', pointerId: 7, pointerType: 'touch', x: 20, y: 30, time: 100});
  assert.strictEqual(a.toPointerInput('down', event), events[0]);
  time = 120; event.inputEvent.x = 44; native.onTouchMove.Call(event);
  assert.equal(events[1].x, 22); assert.equal(events[1].type, 'move');
  off(); off(); native.onTouchEnd.Call(event);
  assert.equal(events.length, 2);
  assert.equal(native.onTouchBegin.handlers.size, 0); assert.equal(native.onTouchMove.handlers.size, 0);
  fgui.Stage.touchScreen = false;
});

test('Unity list maps virtual child indices, keeps non-button selection and disposes renderer callbacks', async () => {
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}));
  const native = new List(); const item = new Component(); native.AddChild(item); native.first = 4;
  const list = a.wrap(native); const rendered = [];
  list.itemRenderer = (index, wrapped) => rendered.push([index, wrapped]);
  native.itemRenderer(4, item);
  assert.strictEqual(rendered[0][1], a.wrapComponent(item));
  list.numItems = 8; list.selectedIndex = 5; assert.equal(list.selectedIndex, 5);
  const clicks = []; const off = list.onClickItem(index => clicks.push(index));
  native.onClickItem.Call(item); assert.deepEqual(clicks, [4]); assert.equal(list.selectedIndex, 4);
  assert.strictEqual(list.itemAt(4), a.wrapComponent(item)); assert.equal(list.itemAt(3), null);
  list.scrollPosition = {x: 12, y: 33}; assert.deepEqual(list.scrollPosition, {x: 12, y: 33});
  assert.equal(list.scrollable, true, '有滚动面板的列表能滚动');
  const fixed = new List(); fixed.scrollPane = null; assert.equal(a.wrap(fixed).scrollable, false, '没有滚动面板（overflow 不是 scroll）的列表不能滚动');
  list.virtual = true; list.virtual = true; assert.equal(native.virtualCalls, 1);
  assert.throws(() => { list.virtual = false; }, {code: 'LGUI-RT-021'});
  list.numItems = 2; assert.equal(list.selectedIndex, -1);
  off(); native.onClickItem.Call(item); assert.deepEqual(clicks, [4]);
  list.itemRenderer = null; assert.equal(native.itemRenderer, null);
});

test('Unity list position uses the native Rect public synchronous scroll commit before the next inertia frame', async () => {
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}));
  const native = new List();
  // Model the documented native boundary: SetPos only queues a refresh, while
  // ScrollToView(..., false, true) commits a different target and ends the tween.
  const pane = {posX: 0, posY: 68, renderedX: 0, renderedY: 68, tweening: true, publicCommits: 0,
    SetPosX(x) { this.posX = x; }, SetPosY(y) { this.posY = y; },
    ScrollToView(rect, animate, setFirst) {
      assert.ok(rect instanceof NativeRect, 'a CLR Rect factory value must cross the typed boundary');
      assert.deepEqual({x: rect.x, y: rect.y, width: rect.width, height: rect.height, animate, setFirst},
        {x: 0, y: 40, width: 0, height: 0, animate: false, setFirst: true});
      this.posX = this.renderedX = rect.x; this.posY = this.renderedY = rect.y;
      this.tweening = false; this.publicCommits++;
    },
    nextFrame() { if (this.tweening) this.posY = this.renderedY = 68; }};
  native.scrollPane = pane;
  const list = a.wrap(native);
  list.scrollPosition = {x: 0, y: 40};
  assert.equal(pane.renderedY, 40, 'assignment must commit the rendered position before returning');
  pane.nextFrame();
  assert.deepEqual(list.scrollPosition, {x: 0, y: 40});
  assert.equal(pane.publicCommits, 1);
});

test('Unity loader forwards native completion and failure without publishing stale URLs', async () => {
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}));
  const native = new Loader(); const loader = a.wrap(native); const loads = []; const errors = [];
  const offLoad = loader.onLoad(() => loads.push(loader.url));
  const offError = loader.onError(url => errors.push(url));
  loader.url = 'https://example.test/a.png';
  loader.url = 'https://example.test/b.png';
  native.onLoaded.Call('https://example.test/a.png');
  assert.deepEqual(loads, []);
  native.onLoaded.Call('https://example.test/b.png');
  assert.deepEqual(loads, ['https://example.test/b.png']);
  native.onLoadError.Call('https://example.test/b.png');
  assert.deepEqual(errors, ['https://example.test/b.png']);
  offLoad(); offError(); native.onLoaded.Call('https://example.test/b.png');
  assert.equal(loads.length, 1); assert.equal(native.onLoaded.handlers.size, 0); assert.equal(native.onLoadError.handlers.size, 0);
});

test('Unity controller changes, text input, image fill, colors and transition callbacks use native contracts', async () => {
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}));
  const native = new Component();
  const controller = {name: 'tabs', selectedPage: 'bag', pageCount: 2, GetPageName(i) {return ['bag','shop'][i];}, onChanged: new Listener()};
  native.controllers.set('tabs', controller);
  const transition = {name: 'fade', playing: false, Play(times, delay, callback) {this.play = {times, delay}; this.complete = callback;}, Stop(complete, callback) {this.stop = {complete, callback};}, SetPaused(value) {this.paused = value;}};
  native.transitions.set('fade', transition);
  const component = a.wrapComponent(native); const tabs = component.controller('tabs');
  const pages = []; const off = tabs.onChange(page => pages.push(page));
  tabs.selectedPage = 'shop'; controller.onChanged.Call(); assert.deepEqual(pages, ['shop']);
  assert.throws(() => {tabs.selectedPage = 'missing';}, {code: 'LGUI-RT-022'}); off();
  assert.strictEqual(tabs, component.controller('tabs'));
  const input = new Input(); const wrappedInput = a.wrap(input); const changes = [];
  wrappedInput.promptText = '搜索'; assert.equal(input.promptText, '搜索');
  const offInput = wrappedInput.onChange(value => changes.push(value)); input.text = '剑'; input.onChanged.Call(); assert.deepEqual(changes, ['剑']); offInput();
  const image = new Image(); const wrappedImage = a.wrap(image); wrappedImage.fillMethod = 'radial180'; wrappedImage.fillAmount = .25;
  assert.equal(image.fillMethod, 4); assert.equal(wrappedImage.fillMethod, 'radial180'); assert.equal(image.fillAmount, .25);
  const graph = new Graph(); a.wrap(graph).color = '#80ff0000'; assert.equal(graph.color.a, 128 / 255); assert.equal(a.wrap(graph).color, '#80ff0000');
  const progress = new Progress(); const wrappedProgress = a.wrap(progress); wrappedProgress.value = 15; wrappedProgress.max = 20; assert.equal(progress.value, 15); assert.equal(progress.max, 20);
  // 重播前先不带回调停掉（FairyGUI 重播会调用上一次的回调）；delay 换成秒；只有正常放完才通知。
  const effect = component.transition('fade'); let completed = 0;
  effect.play({times: 2, delay: 500}, () => completed++);
  assert.deepEqual(transition.stop, {complete: true, callback: false}); assert.deepEqual(transition.play, {times: 2, delay: .5});
  transition.complete(); assert.equal(completed, 1);
  effect.play(); assert.deepEqual(transition.play, {times: 1, delay: 0}); transition.complete(); assert.equal(completed, 1, 'play() without onComplete notifies nobody');
  transition.playing = true; assert.equal(effect.playing, true);
  effect.setPaused(true); assert.equal(transition.paused, true); transition.stop = null; effect.stop(); assert.deepEqual(transition.stop, {complete: true, callback: false});
  assert.deepEqual(component.allTransitions(), [effect]);
});

test('Unity 对象：shown、hitDepth、onWheel、按钮音效和动效设置走 FairyGUI 和 LGUI.Platform', async () => {
  const hits = {target: null};
  const services = {
    wheelDeltaX: () => 3, hitTest: (x, y) => { hits.at = [x, y]; return hits.target; },
    buttonSound: button => button.sound ? 'ui://abcd0001' : '',
    transitionSettings: () => ({autoPlay: true, times: -1, delay: 250})
  };
  const a = await adapter(fgui, () => 0, (x, y) => ({x: x / 2, y: y / 2}), undefined, services);
  const root = new Component(); const panel = new Component(); const button = new Button();
  root.AddChild(panel); panel.AddChild(button);
  const wrapped = a.wrap(button);
  assert.equal(wrapped.mode, 'Common', 'FairyGUI.ButtonMode 0 是 Common');
  button.mode = 1; assert.equal(wrapped.mode, 'Check'); button.mode = 2; assert.equal(wrapped.mode, 'Radio');
  // PuerTS 给的不一定是数字：枚举名、带 ToString 的枚举对象也认
  button.mode = 'Check'; assert.equal(wrapped.mode, 'Check');
  button.mode = {ToString: () => 'Radio'}; assert.equal(wrapped.mode, 'Radio');
  button.mode = {ToString: () => 'Common'}; assert.equal(wrapped.mode, 'Common');
  button.mode = 7; assert.equal(wrapped.mode, 'ButtonMode 7', '认不出的值原样写出来（绑定 selected 时报 RT-242 能看到它）');
  button.mode = 0;
  assert.equal(wrapped.shown, true);
  panel.displayObject.visible = false; assert.equal(wrapped.shown, false, 'a hidden ancestor hides it');
  panel.displayObject.visible = true; button.onStage = false; assert.equal(wrapped.shown, false, 'gear or group removed it from the stage');
  button.onStage = true;
  hits.target = button;
  assert.equal(a.wrap(root).hitDepth(10, 20), 2); assert.deepEqual(hits.at, [10, 20]);
  assert.equal(a.wrap(button).hitDepth(10, 20), 0);
  hits.target = new Obj(); assert.equal(a.wrap(root).hitDepth(10, 20), -1);
  const wheels = []; const off = a.wrap(panel).onWheel(event => wheels.push(event));
  panel.displayObject.onMouseWheel.Call({inputEvent: {x: 40, y: 60, mouseWheelDelta: 120}, data: null});
  assert.deepEqual(wheels, [{x: 20, y: 30, deltaX: 3, deltaY: 120}]);
  off(); assert.equal(panel.displayObject.onMouseWheel.handlers.size, 0);
  assert.equal(wrapped.sound, ''); assert.equal(wrapped.soundVolume, 1);
  button.sound = {}; button.soundVolumeScale = 0; assert.equal(wrapped.sound, 'ui://abcd0001'); assert.equal(wrapped.soundVolume, 0);
  root.transitions.set('pulse', {name: 'pulse', playing: false});
  assert.deepEqual(a.wrapComponent(root).transition('pulse').settings, {autoPlay: true, times: -1, delay: 250});
});

test('Unity 新控件：标签、滑动条、下拉框、序列帧动画、树按 core 合同包装', async () => {
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}));
  const label = a.wrap(new Label()); assert.equal(label.title, ''); label.title = '金币'; label.icon = 'ui://Common/coin'; assert.deepEqual([label.native.title, label.native.icon], ['金币', 'ui://Common/coin']);
  const sliderNative = new Slider(); const slider = a.wrap(sliderNative); const values = [];
  slider.min = 10; slider.max = 50; slider.value = 20; assert.deepEqual([sliderNative.min, sliderNative.max, sliderNative.value], [10, 50, 20]);
  const offSlider = slider.onChange(value => values.push(value)); sliderNative.value = 35; sliderNative.onChanged.Call(); offSlider(); assert.deepEqual(values, [35]);
  const comboNative = new ComboBox(); const combo = a.wrap(comboNative); const picks = [];
  combo.items = ['低', '中', '高']; assert.equal(combo.selectedIndex, -1, 'giving items keeps "nothing selected"'); assert.equal(combo.text, '');
  combo.selectedIndex = 2; combo.items = ['低', '中']; assert.equal(combo.selectedIndex, -1, 'an out-of-range selection becomes -1');
  combo.selectedIndex = 1; assert.equal(combo.text, '中'); assert.deepEqual(combo.items, ['低', '中']);
  combo.onChange(index => picks.push(index)); comboNative.index = 0; comboNative.onChanged.Call(); assert.deepEqual(picks, [0]);
  const clipNative = new MovieClip(); const clip = a.wrap(clipNative); clip.playing = false; clip.frame = 3; assert.deepEqual([clipNative.playing, clipNative.frame], [false, 3]);
  const treeNative = new Tree(); const tree = a.wrap(treeNative); const rendered = []; const clicks = [];
  tree.nodeRenderer = (key, item) => rendered.push([key, item.native]);
  tree.setNodes([{key: 'a', children: [{key: 'a1', children: []}]}, {key: 'b', children: []}]);
  assert.equal(tree.numItems, 3, 'new nodes are expanded');
  treeNative.rootNode.children[0].expanded = false;
  tree.setNodes([{key: 'a', children: [{key: 'a1', children: []}, {key: 'a2', children: []}]}, {key: 'c', children: []}]);
  assert.deepEqual(treeNative.rootNode.removed, [0, -1]); assert.equal(tree.numItems, 2, 'node a keeps its collapsed state');
  tree.selectedKey = 'c'; assert.equal(treeNative.selectedNode, treeNative.rootNode.children[1]); assert.equal(treeNative.scrolled, false);
  tree.onClickNode(key => clicks.push(key));
  const cell = tree.itemAt(0).native; treeNative.onClickItem.Call(cell);
  assert.deepEqual(clicks, ['a']); assert.equal(tree.selectedKey, 'a');
  assert.ok(rendered.some(([key]) => key === 'a'));
  tree.nodeRenderer = null; assert.equal(treeNative.treeNodeRender, null);
});

test('Unity UI wrapper satisfies core interfaces under strict TypeScript without browser globals', () => {
  assert.deepEqual(typecheck([entry]), []);
});

test('Unity hover routes the stage move to the hit object and its ancestors before stage recognition', async () => {
  const a = await adapter(fgui, () => 12, (x, y) => ({x, y}));
  const root = new Component(); const child = new Button(); root.AddChild(child);
  const input = context(40, 60, 0); const seen = [];
  const offParent = a.wrap(root).onPointer(event => seen.push(['parent', event]));
  const offChild = a.wrap(child).onPointer(event => seen.push(['child', event]));
  a.dispatchHover(child, input);
  const stageInput = a.toPointerInput('move', input);
  assert.deepEqual(seen.map(([name]) => name), ['child', 'parent']);
  assert.strictEqual(seen[0][1], stageInput); assert.strictEqual(seen[1][1], stageInput);
  assert.equal(stageInput.pointerType, 'mouse', 'Unity uses touchId 0 for a mouse too');
  offParent(); offChild(); a.dispatchHover(child, input); assert.equal(seen.length, 2);
});

test('Unity delivers a captured mouse move once per subscriber across hover and native monitor routes', async () => {
  const a = await adapter(fgui, () => 12, (x, y) => ({x, y}));
  const native = new Button();
  const first = [], second = [];
  const offFirst = a.wrap(native).onPointer(event => first.push(event));
  const offSecond = a.wrap(native).onPointer(event => second.push(event));
  const event = context(40, 60, 0);

  // FairyGUI TouchInfo.Move sends the stage capture chain before GObject monitors.
  a.dispatchHover(native, event);
  const stageInput = a.toPointerInput('move', event);
  native.onTouchMove.Call(event);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.strictEqual(first[0], stageInput);
  assert.strictEqual(second[0], stageInput);

  // A new frame reuses the C# InputEvent, but must still deliver a fresh move.
  a.clearPointerCache();
  a.dispatchHover(native, event);
  native.onTouchMove.Call(event);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.notStrictEqual(first[1], first[0]);

  offFirst();
  a.clearPointerCache();
  a.dispatchHover(native, event);
  native.onTouchMove.Call(event);
  assert.equal(first.length, 2);
  assert.equal(second.length, 3);
  offSecond();
});

test('Unity pointer subscriptions remain independent when the same callback is registered twice', async () => {
  const a = await adapter(fgui, () => 12, (x, y) => ({x, y}));
  const native = new Button(); const seen = [];
  const handler = event => seen.push(event);
  const offFirst = a.wrap(native).onPointer(handler);
  const offSecond = a.wrap(native).onPointer(handler);
  const event = context(40, 60, 0);
  a.dispatchHover(native, event);
  native.onTouchMove.Call(event);
  assert.equal(seen.length, 2);
  offFirst();
  a.clearPointerCache();
  a.dispatchHover(native, event);
  native.onTouchMove.Call(event);
  assert.equal(seen.length, 3);
  offSecond();
});

test('Unity component disposal detaches descendant and controller subscriptions and list delegates', async () => {
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}));
  const root = new Component(); const list = new List(); const loader = new Loader(); root.AddChild(list); root.AddChild(loader);
  const controller = {name: 'tabs', selectedPage: 'bag', pageCount: 1, GetPageName() {return 'bag';}, onChanged: new Listener()};
  root.controllers.set('tabs', controller);
  a.wrap(loader).onLoad(() => {}); a.wrap(list).onClickItem(() => {}); a.wrap(list).itemRenderer = () => {};
  a.wrapComponent(root).controller('tabs').onChange(() => {});
  a.wrapComponent(root).dispose();
  assert.equal(loader.onLoaded.handlers.size, 0); assert.equal(list.onClickItem.handlers.size, 0);
  assert.equal(list.itemRenderer, null); assert.equal(controller.onChanged.handlers.size, 0);
});

test('Unity object adapter disposal releases active native subscriptions even without a component close', async () => {
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}));
  const native = new Button(); a.wrap(native).onPointer(() => {});
  const list = new List(); a.wrap(list).itemRenderer = () => {};
  a.dispose(); a.dispose();
  assert.equal(native.onTouchBegin.handlers.size, 0); assert.equal(native.onTouchMove.handlers.size, 0); assert.equal(native.onTouchEnd.handlers.size, 0);
  assert.equal(list.itemRenderer, null);
});

test('Unity removes a directly disposed container from backend ownership before teardown', async () => {
  const {backend, dispose} = await containerBackend();
  try {
    const owner = backend.createContainer('glyph-owner');
    const native = owner.native;
    owner.dispose();
    assert.equal(native.disposeCalls, 1);
    dispose();
    assert.equal(native.disposeCalls, 1, 'backend must not retain and revisit a disposed container');
  } finally { dispose(); }
});

test('Unity removes a container disposed recursively through an unregistered native ancestor', async () => {
  const {backend, dispose} = await containerBackend();
  try {
    const ancestor = backend.create('Bag', 'Panel');
    const owner = backend.createContainer('glyph-owner');
    const native = owner.native;
    ancestor.addChild(owner);
    ancestor.dispose();
    assert.equal(native.disposeCalls, 1, 'native ancestor disposal owns the child destruction');
    dispose();
    assert.equal(native.disposeCalls, 1, 'recursive release must unregister a child whose wrapper.dispose was not called');
  } finally { dispose(); }
});

test('Unity container teardown disposes a registered parent tree and remaining live containers once', async () => {
  const {backend, dispose} = await containerBackend();
  try {
    const parent = backend.createContainer('parent');
    const child = backend.createContainer('glyph-owner');
    const sibling = backend.createContainer('other-layer');
    parent.addChild(child);
    dispose();
    assert.equal(parent.native.disposeCalls, 1);
    assert.equal(child.native.disposeCalls, 1, 'registered child must not be disposed a second time after native recursion');
    assert.equal(sibling.native.disposeCalls, 1, 'removing parent/child ownership must not skip another live container');
  } finally { dispose(); }
});

test('Unity 项目字体：启动时按名字把 Resources 里的 UI/fonts/<名字> 注册成 TMP 字体；找不到、旧版 Unity 包都报 LGUI-RT-181', async () => {
  const calls = [];
  const logs = [];
  const {bridge, dispose} = await containerBackend({defaultFont: 'Noto', fonts: ['Noto', 'Title'], platform: {
    RegisterFont(name, resource) { calls.push([name, resource]); return true; }, TmpSettingsFound: true, FallbackFontName: 'PingFang SC', FallbackFontCandidates: 'PingFang SC, Microsoft YaHei',
    Log(level, message) { logs.push([level, message]); }
  }});
  assert.deepEqual(calls, [['Noto', 'UI/fonts/Noto'], ['Title', 'UI/fonts/Title']]);
  assert.equal(bridge.FairyGUI.UIConfig.defaultFont, 'Noto');
  assert.deepEqual(logs.filter(([, m]) => m.includes('lgui_rt_182')), [], '找到了系统回退字体就不记');
  dispose();
  await assert.rejects(containerBackend({fonts: ['Noto'], platform: {RegisterFont: () => false, TmpSettingsFound: true}}), e => e.code === 'LGUI-RT-181' && /Resources\/UI\/fonts\/Noto/.test(e.message));
  dispose();
  await assert.rejects(containerBackend({fonts: ['Noto']}), e => e.code === 'LGUI-RT-181' && /RegisterFont/.test(e.message));
  dispose();
  // 工程里没有 TMP Settings（没导入 TMP Essential Resources）：不调 RegisterFont（TMP 会空引用），报 RT-181 写明原因和改法
  const tried = [];
  await assert.rejects(containerBackend({fonts: ['Noto'], platform: {RegisterFont(name) { tried.push(name); return true; }, TmpSettingsFound: false}}),
    e => e.code === 'LGUI-RT-181' && /TMP Settings/.test(e.message) && /lgui unity export/.test(e.next) && /Window → TextMeshPro → Import TMP Essential Resources/.test(e.next));
  assert.deepEqual(tried, []);
  dispose();
  // 没有项目字体时不调 RegisterFont（旧版 Unity 包照样能启动），也不管系统回退字体（不记 RT-182）
  const quiet = [];
  await containerBackend({platform: {FallbackFontName: '', FallbackFontCandidates: 'x', Log(level, message) { quiet.push(message); }}});
  assert.deepEqual(quiet.filter(m => m.includes('lgui_rt_182')), []);
  dispose();
});

test('Unity 项目字体：一个系统回退字体都没找到时，启动照常，只记一次 LGUI-RT-182 错误日志（写明试过哪些）', async () => {
  const logs = [];
  const {backend, dispose} = await containerBackend({fonts: ['Noto', 'Title'], platform: {
    RegisterFont: () => true, TmpSettingsFound: true, FallbackFontName: '', FallbackFontCandidates: 'PingFang SC, Noto Sans CJK SC, Microsoft YaHei',
    Log(level, message) { logs.push([level, message]); }
  }});
  assert.ok(backend.root, '启动照常');
  const rt182 = logs.filter(([, m]) => m.includes('lgui_rt_182'));
  assert.equal(rt182.length, 1, '两个项目字体也只记一次');
  assert.equal(rt182[0][0], 'error');
  assert.match(rt182[0][1], /LGUI-RT-182/);
  assert.match(rt182[0][1], /PingFang SC, Noto Sans CJK SC, Microsoft YaHei/);
  dispose();
});

test('Unity 代码补间：属性读写、齿轮主人、按钮按下效果（关掉 FairyGUI 自己的缩放）、动效每一项，走 FairyGUI 和 LGUI.Platform（TweenInfo.cs）', async () => {
  const calls = [];
  const services = {
    ...noServices,
    gearController: (object, index) => object.name === 'geared' && index === 2 ? 'tabs' : '',
    downEffect: () => ({type: 2, value: 0.8}),
    disableDownEffect: button => calls.push(['disable', button.name]),
    transitionItems: () => [{target: image, type: 4}, {target: image, type: 9}, {target: null, type: 0}]
  };
  const a = await adapter(fgui, () => 0, (x, y) => ({x, y}), undefined, services);
  const look = {scaleX: 1, scaleY: 1, rotation: 0, alpha: 1, pivotX: 0.5, pivotY: 0.5, isDisposed: false, SetScale(x, y) { this.scaleX = x; this.scaleY = y; }};
  const text = Object.assign(new Text(), look, {name: 'price', textFormat: {size: 20}});
  const image = Object.assign(new Image(), look, {name: 'geared', fillMethod: 4});
  const button = Object.assign(new Button(), look, {name: 'claim', titleColor: {r: 0, g: 0, b: 0, a: 1}, titleFontSize: 24, GetTextField: () => text});
  const t = a.wrap(text), i = a.wrap(image), b = a.wrap(button);
  assert.deepEqual([t.supports('color'), t.supports('fontSize'), t.supports('fillAmount'), i.supports('fillAmount'), i.supports('fontSize'), b.supports('color')], [true, true, false, true, false, true]);
  t.setProp('color', 0xff3b30);
  t.setProp('fontSize', 30);
  assert.deepEqual([t.getProp('color'), text.textFormat.size, t.pivot], [0xff3b30, 30, {x: 0.5, y: 0.5}]);
  i.setProp('alpha', 0.5);
  i.setProp('x', 12);
  assert.deepEqual([image.alpha, image.x], [0.5, 12]);
  assert.deepEqual([i.ownerOf('scaleX'), i.ownerOf('alpha'), t.ownerOf('width')], ['齿轮 gearSize（控制器 tabs）', null, null]);
  assert.deepEqual(b.downEffect, {type: 'scale', value: 0.8});
  assert.deepEqual(b.downEffect, {type: 'scale', value: 0.8});
  assert.deepEqual(calls, [['disable', 'claim']], '第一次读时关掉一次');
  b.pressScale = 0.8;
  assert.deepEqual([button.scaleX, button.scaleY], [0.8, 0.8]);
  b.pressScale = 1;
  assert.deepEqual([button.scaleX, b.pressScale], [1, 1]);
  const transition = {name: 'blink', playing: false, Play() {}, Stop() {}, SetPaused() {}};
  const owner = Object.assign(new Component(), {name: 'panel'});
  owner.transitions.set('blink', transition);
  assert.deepEqual(a.wrapComponent(owner).transition('blink').touches().map(x => [x.target.name, x.what]), [['geared', 'alpha']], 'Sound 这类项、没有目标的项不算');
});
