// 绑定引擎：把 View 的绑定表接到控件上。每个绑定的订阅、手势识别都登记在 scope 里，解绑时一次清掉。
// 词表和写法见 references/mvc-spec.md 第 6.4 节。
import type {UIButton, UIComboBox, UIComponent, UIController, UIImage, UIInput, UIList, UILoader, UIMovieClip, UIObject, UIProgress, UISlider, UIText, UITransition, UITree} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {isPicked} from '../pick';
import {Scope} from '../scope';
import {runtime} from '../runtime';
import {asActor} from '../actor';
import {inputType} from '../input/input-type';
import {recognize} from '../input/gestures';
import {dragSource, dropTarget} from '../input/drag-drop';
import type {GestureHandlers} from '../input/gestures';
import type {InputType} from '../types';
import {bindList} from './list';
import {bindTree} from './tree';
import {bindPart} from './part';
import {bindTransition} from './transition';
import {applyIcon} from './icon';
import {pick} from '../pick';
import {redDots, redDotState} from '../red-dot';
import {renderArtText} from '../art-text';
import {clickSound} from '../sound';
import {later, updatesHeld} from '../language-switch';
import {pickParts} from '../pick';
import {claimProgress, claimRoll, roll} from '../tween/index';
import {writeText} from '../tween/text';
import {eachTransition} from '../tween/engine';
import type {TweenGroup} from '../tween/engine';
import {isEase} from '../tween/ease';
import {fault} from '../log';
import type {ViewTimers} from '../timers';

/** 绑定时要知道的事。 */
export interface BindContext {
  /** 发起动作的界面（View、ItemView 或 PartView 实例）。 */
  owner: object;
  /** 绑定的清理清单。 */
  scope: Scope;
  /** 这个界面现在能不能接收输入（UIManager 提供；只有激活的界面能）。 */
  isActive: () => boolean;
  /** ItemView 里这一项的数据；值写成函数时传给它。 */
  item?: {data: unknown};
  /** 界面名，报错时用。 */
  where: string;
}

type Table = Record<string, Record<string, unknown> | undefined>;

const displayWords = ['text', 'visible', 'enabled', 'icon', 'progress', 'redDot', 'value', 'playing'];
const listWords = ['items', 'item', 'key', 'selected', 'select'];
const actionWords = ['click', 'doubleClick', 'hold', 'drag', 'swipe', 'pinch', 'wheel', 'hover'];
// 用户改了控件的值时调用：输入框的 input、滑动条的 change（下拉框、列表、树的 select 在 listWords 里）。
const valueWords = ['input', 'change'];
const modifierWords = ['lockWhilePending', 'visibleOn', 'placeholder', 'roll', 'tick'];
const controllerWords = ['page', 'change'];
const dragWords = ['dragData', 'dragIcon', 'drop'];

const fail = (code: string, message: string, next: string): never => { throw new LgRuntimeError(code, message, next); };

/** 解析绑定表的键：控件名、控制器名、动效名，或者用「.」连起来的路径。 */
function resolve(component: UIComponent, key: string, where: string): {kind: 'controller'; target: UIController} | {kind: 'transition'; target: UITransition} | {kind: 'object'; target: UIObject} {
  const dot = key.lastIndexOf('.');
  const parent = dot < 0 ? component : component.child(key.slice(0, dot));
  const last = dot < 0 ? key : key.slice(dot + 1);
  if (parent && 'controller' in parent) {
    const controller = (parent as UIComponent).controller(last);
    if (controller) return {kind: 'controller', target: controller};
    const transition = (parent as UIComponent).transition(last);
    if (transition) return {kind: 'transition', target: transition};
  }
  const target = component.child(key);
  if (!target) fail('LGUI-RT-062', `${where} 的绑定表里写了 ${key}，但组件 ${component.componentName} 里没有这个控件、控制器或动效。`, '用 lgui ui list 查看真实的控件名；改了 ui/ 之后要重新生成。');
  return {kind: 'object', target: target as UIObject};
}

/** 一个显示类的值现在是多少：固定值、pick，或者 ItemView 里的函数（传入这一项的数据）。 */
function current<T>(value: unknown, ctx: BindContext): T {
  if (isPicked(value)) return value.get() as T;
  if (typeof value === 'function' && ctx.item) return (value as (data: unknown) => T)(ctx.item.data);
  return value as T;
}

/** 读一个显示类的值：固定值、pick，或者 ItemView 里的函数；变化时重新调用 apply。换语言的空窗里先不刷新，切完再按当时的值刷一次。
 * 返回「按现在的值重算一次，结果变了才写」（绑定的 tick 定时调用它）。 */
export function watch<T>(value: unknown, ctx: BindContext, apply: (value: T) => void): () => void {
  let last: {value: T} | null = null;
  const update = (): void => { const next = current<T>(value, ctx); last = {value: next}; apply(next); };
  const refresh = (): void => { if (updatesHeld()) later(update, () => !ctx.scope.isClosed); else update(); };
  refresh();
  if (isPicked(value)) ctx.scope.add(value.subscribe(refresh));
  return () => {
    if (updatesHeld() || ctx.scope.isClosed) return;
    const next = current<T>(value, ctx);
    if (last && Object.is(last.value, next)) return;
    last = {value: next};
    apply(next);
  };
}

const bindingError = (ctx: BindContext, key: string, message: string, fix: string): never => fail('LGUI-RT-284', `${ctx.where} 的 ${key} ${message}`, fix);

/** roll、tick 写错了（第 ① 类）：开发模式里抛出；正式构建只记 error 日志，返回 false，这一项不生效（照常显示，不滚、不定时重算）。 */
function soft(run: () => void): boolean {
  try {
    run();
    return true;
  } catch (error) {
    if (!(error instanceof LgRuntimeError)) throw error;
    fault(error);
    return false;
  }
}

/** 绑定所在界面的补间组和定时器（roll、tick 用；ctx.owner 不是界面——测试里直接绑——时没有）。 */
function ownerParts(ctx: BindContext): {tweens: TweenGroup | null; timers: ViewTimers | null} {
  const owner = ctx.owner as {__tweens?: TweenGroup; __timers?: ViewTimers};
  return {tweens: owner.__tweens ?? null, timers: owner.__timers ?? null};
}

/** roll：text（或 progress）的 pick 取出的数字从旧值平滑滚到新值。打开时直接显示当前值；滚动中值又变了，从现在显示的数接着滚。
 * show 收到滚动中的数字（text 时已经交给格式化函数），格式化后的结果变了才写。 */
function bindRoll(component: UIComponent, value: unknown, binding: Record<string, unknown>, ctx: BindContext, key: string, target: UIObject, show: (n: number) => void): boolean {
  return soft(() => setupRoll(component, value, binding, ctx, key, target, show));
}

function setupRoll(component: UIComponent, value: unknown, binding: Record<string, unknown>, ctx: BindContext, key: string, target: UIObject, show: (n: number) => void): void {
  const options = binding.roll as {duration?: unknown; ease?: unknown};
  if (ctx.item) bindingError(ctx, key, '在 ItemView 里写了 roll（列表子项会被重复使用，认不出旧值）。', '把滚动的数字放到 View 或 PartView 里；列表子项直接显示 text。');
  if (typeof options !== 'object' || options === null || typeof options.duration !== 'number' || !Number.isFinite(options.duration) || options.duration < 0) bindingError(ctx, key, `的 roll 要写成 { duration: 毫秒 }（现在是 ${JSON.stringify(options)}）。`, '写成 roll: { duration: 500 }，缓动可选 ease。');
  if (options.ease !== undefined && !isEase(options.ease)) bindingError(ctx, key, `的 roll 的 ease 是 ${String(options.ease)}，不是缓动名。`, "写法和 ui/ 的 XML 一样，比如 'Quad.Out'。");
  const parts = pickParts(value);
  if (!parts) bindingError(ctx, key, '写了 roll，但值不是 pick（固定值不会变，没什么可滚的）。', '写成 text: pick(model, s => s.gold, format.number), roll: { duration: 500 }。');
  const read = (): number => {
    const n = (parts as {raw: () => unknown}).raw();
    if (typeof n !== 'number' || !Number.isFinite(n)) bindingError(ctx, key, `写了 roll，但 pick 取出的不是数字（${JSON.stringify(n)}）。`, 'pick 取出数字，带文字的写进格式化函数：n => lgui.t(\'main.gold\', { n: format.number(n) })。');
    return n as number;
  };
  let shown = read();
  // 和别的主人抢文字：齿轮 gearText、动效的 Text 项（LGUI-RT-282）。
  if ('text' in binding) {
    const gear = target.ownerOf('text');
    const transitions: string[] = [];
    eachTransition(component, t => { if (t.touches().some(x => x.target === target && x.what === 'text')) transitions.push(t.name); });
    if (gear || transitions.length) fail('LGUI-RT-282', `${ctx.where} 的 ${key} 写了 roll，但它的文字还归${gear ?? `动效 ${transitions.join('、')} 的 Text 项`}管，两边会抢同一段文字。`, '滚动的数字放在一个只归绑定管的文字控件上。');
    claimRoll(target);
  }
  const {tweens} = ownerParts(ctx);
  show(shown);
  let stop: (() => void) | null = null;
  ctx.scope.add(() => stop?.());
  const integers = (a: number, b: number): boolean => Number.isInteger(a) && Number.isInteger(b);
  const change = (): void => {
    if (ctx.scope.isClosed) return;
    let to = shown;
    // 后来取出的不是数字：开发模式抛出，正式构建记 error、这次不滚，照旧显示原来的数。
    if (!soft(() => { to = read(); })) return;
    const from = shown;
    if (to === from) return;
    stop?.();
    const step = (n: number): void => { shown = n; show(integers(from, to) ? Math.round(n) : n); };
    // 测试里直接绑（不在界面里）时没有补间组：直接显示新值。
    if (!tweens) { step(to); return; }
    stop = roll(tweens, target, from, to, {duration: options.duration as number, ease: options.ease as never}, step);
  };
  ctx.scope.add((value as {subscribe(l: () => void): () => void}).subscribe(() => { if (updatesHeld()) later(change, () => !ctx.scope.isClosed); else change(); }));
}

function setText(target: UIObject, text: string, where: string, key: string): void {
  if (writeText(target, text)) return; // 打字机（chars）只露出一部分时：记下全文，只写露出的
  if ('title' in target) (target as UIButton).title = text;
  else if ('text' in target) (target as UIText).text = text;
  else if ((target as UIComponent).componentName === 'Common/ArtText') renderArtText(target as UIComponent, text, `${where} 的 ${key}`);
  else fail('LGUI-RT-063', `${where} 的 ${key} 不能绑定 text（它不是文字、按钮或 ArtText）。`, '换成文字控件，或者去掉 text。');
}

/** 绑定一个控件。 */
function bindObject(component: UIComponent, key: string, target: UIObject, binding: Record<string, unknown>, ctx: BindContext): void {
  for (const word of Object.keys(binding)) {
    if (![...displayWords, ...listWords, ...actionWords, ...valueWords, ...modifierWords, ...dragWords, 'view'].includes(word)) {
      fail('LGUI-RT-063', `${ctx.where} 的 ${key} 用了词表以外的词 ${word}。`, `能用的词见 references/mvc-spec.md 第 6.4 节。`);
    }
  }
  // 显示
  let visible = true;
  let allowedOn: readonly InputType[] | null = null;
  const applyVisible = (): void => { target.visible = visible && (!allowedOn || allowedOn.includes(inputType.get())); };
  const refreshes0: (() => void)[] = [];
  if ('visible' in binding) refreshes0.push(watch<boolean>(binding.visible, ctx, v => { visible = v; applyVisible(); }));
  if ('visibleOn' in binding) {
    allowedOn = binding.visibleOn as readonly InputType[];
    if (!('visible' in binding)) visible = target.visible;
    applyVisible();
    ctx.scope.add(inputType.subscribe(applyVisible));
  }
  let enabled = true;
  let pending = false;
  const applyEnabled = (): void => { target.enabled = enabled && !pending; };
  if ('enabled' in binding) refreshes0.push(watch<boolean>(binding.enabled, ctx, v => { enabled = v; applyEnabled(); }));
  // 定时重算（tick）：每个显示词按现在的值再刷一次。
  const refreshes: (() => void)[] = [];
  if ('roll' in binding && !('text' in binding) && !('progress' in binding)) soft(() => bindingError(ctx, key, '写了 roll，但没写 text 或 progress。', 'roll 配 text（数字文字）或 progress（进度条）用。'));
  if ('text' in binding) {
    const parts = pickParts(binding.text);
    let last: string | null = null;
    const rolled = 'roll' in binding && bindRoll(component, binding.text, binding, ctx, key, target, n => { const s = String(parts?.format ? parts.format(n) : n); if (s !== last) { last = s; setText(target, s, ctx.where, key); } });
    if (!rolled) refreshes.push(watch<string>(binding.text, ctx, v => setText(target, String(v), ctx.where, key)));
  }
  if ('icon' in binding) {
    if (!('url' in target) && !('icon' in target)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不能绑定 icon（它不是加载器或按钮）。`, '换成加载器，或者去掉 icon。');
    refreshes.push(watch<string>(binding.icon, ctx, v => applyIcon(target as UILoader | UIButton, v, binding.placeholder as string | undefined, ctx)));
  }
  if ('progress' in binding) {
    if (!('max' in target)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不能绑定 progress（它不是进度条）。`, '换成进度条组件，或者去掉 progress。');
    claimProgress(target);
    const write = (v: number): void => { const bar = target as UIProgress; bar.value = (Math.max(0, Math.min(100, v)) / 100) * bar.max; };
    const rolled = 'roll' in binding && !('text' in binding) && bindRoll(component, binding.progress, binding, ctx, key, target, write);
    if (!rolled) refreshes.push(watch<number>(binding.progress, ctx, write));
  }
  if ('value' in binding) {
    if (!('min' in target)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不能绑定 value（它不是滑动条）。`, '换成滑动条组件（扩展类型 Slider），或者去掉 value。');
    refreshes.push(watch<number>(binding.value, ctx, v => { (target as UISlider).value = v; }));
  }
  if ('playing' in binding) {
    if (!('playing' in target)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不能绑定 playing（它不是序列帧动画）。`, '换成序列帧动画（movieclip），或者去掉 playing。');
    refreshes.push(watch<boolean>(binding.playing, ctx, v => { (target as UIMovieClip).playing = v; }));
  }
  if ('redDot' in binding) {
    const dot = 'child' in target ? (target as UIComponent).child('redDot') : null;
    if (!dot) fail('LGUI-UI-012', `${ctx.where} 的 ${key} 绑定了 redDot，但它里面没有名为 redDot 的子控件。`, '在 ui/ 里给这个控件放一个 Common/RedDot 的实例，名字叫 redDot（UI 开发规范第 10 节）。');
    // 路径可以是固定的，也可以在 ItemView 里按这一项算（it => `sign.day${it.day}`）；路径变了就改看新的路径。
    let following = new Scope();
    ctx.scope.add(() => following.dispose());
    watch<string>(binding.redDot, ctx, path => {
      if (typeof path !== 'string' || !path) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 的 redDot 不是红点路径（${String(path)}）。`, 'redDot 写成红点路径，比如 \'bag.equip\'；ItemView 里可以写成函数，按这一项返回路径。');
      following.dispose();
      following = new Scope();
      watch<{lit: boolean; count: number}>(pick(redDots, () => redDotState(path), s => s), {...ctx, scope: following}, s => {
        (dot as UIObject).visible = s.lit;
        const count = (dot as UIComponent).child?.('count') as UIText | null;
        if (count && 'text' in count) count.text = s.count > 0 ? String(s.count) : '';
      });
    });
  }
  if ('tick' in binding) bindTick(binding.tick, [...refreshes0, ...refreshes], ctx, key);
  // 单独的 Check、Radio 按钮：selected 是选中状态
  const isButton = 'selected' in target && 'title' in target;
  if (isButton && 'selected' in binding) bindSelected(target as UIButton, binding.selected, ctx, key);
  // 列表、树、下拉框、部件
  const listUse = listWords.filter(word => word in binding && !(isButton && word === 'selected'));
  if (listUse.length) {
    if (isButton) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 是按钮，不能用 ${listUse.join('、')}。`, '按钮只能用 selected（Check、Radio 按钮的选中状态）；列表的子项写在列表上。');
    if ('setNodes' in target) bindTree(target as UITree, binding, ctx, key);
    else if ('numItems' in target) bindList(target as UIList, binding, ctx, key);
    else if ('items' in target) bindComboBox(target as UIComboBox, binding, ctx, key);
    else fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不是列表、树或下拉框，不能用 ${listWords.join('、')}。`, '换成列表、树或下拉框。');
  }
  if ('view' in binding) {
    if (!('componentName' in target)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不是组件，不能用 view。`, '换成子组件。');
    bindPart(target as UIComponent, binding.view, ctx);
  }
  // 拖放
  if ('dragIcon' in binding && !('dragData' in binding)) fail('LGUI-RT-221', `${ctx.where} 的 ${key} 写了 dragIcon，但没写 dragData。`, '加上 dragData（拖起时带的数据），或者去掉 dragIcon。');
  if ('drop' in binding) dropTarget(target, key, binding.drop, ctx);
  const dragging = 'dragData' in binding ? dragSource(target, key, binding, ctx, () => ctx.isActive() && !pending && target.enabled) : null;
  // 动作
  const lock = binding.lockWhilePending === true;
  // 执行一个动作，返回动作的结果（锁住时是等它结束再解锁的 Promise）。
  const run = (action: unknown, ...args: unknown[]): unknown => {
    if (!ctx.isActive() || pending || !target.enabled) return undefined;
    if (action === binding.click) clickSound(target);
    const result = asActor(ctx.owner, () => (action as (...a: unknown[]) => unknown)(...args));
    if (lock && result instanceof Promise) {
      pending = true;
      applyEnabled();
      // 结束时界面可能已经关了（组件已销毁）：绑定还在才改控件。动作照常跑完；失败时错误沿着 Promise 照常报出来，不在这里吞掉。
      return result.finally(() => { pending = false; if (!ctx.scope.isClosed) applyEnabled(); });
    }
    return result;
  };
  if (binding.input) {
    if (!('promptText' in target)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不能绑定 input（它不是输入框）。`, '换成输入框（inputtext），或者去掉 input。');
    const input = target as UIInput;
    // 动作跑完以后，框里显示绑定的值：Model 截断或拒绝了这次修改时值没变，订阅不会触发，要在这里写回去。
    const writeBack = (): void => {
      if (!('text' in binding) || ctx.scope.isClosed) return;
      const shown = String(current<string>(binding.text, ctx));
      if (input.text !== shown) input.text = shown;
    };
    ctx.scope.add(input.onChange(text => {
      const result = run(binding.input, text);
      if (result instanceof Promise) void result.finally(writeBack);
      else writeBack();
    }));
  }
  if (binding.change) {
    if (!('min' in target)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 不能绑定 change（只有控制器和滑动条能用）。`, '控制器切页、滑动条改值时用 change；按钮用 click。');
    ctx.scope.add((target as UISlider).onChange(value => run(binding.change, value)));
  }
  const actions = actionWords.filter(word => word in binding);
  if (actions.length || dragging) {
    const handlers: GestureHandlers = {pointer: e => inputType.set(e.pointerType === 'mouse' ? 'keyboardMouse' : 'touch')};
    // ItemView 里的点击、双击、长按：参数是这一项的数据（click: it => shopController.buy(it.id)）。
    const item = ctx.item ? [ctx.item.data] : [];
    if (binding.click) handlers.click = () => run(binding.click, ...item);
    if (binding.doubleClick) handlers.doubleClick = () => run(binding.doubleClick, ...item);
    if (binding.hold) {
      const hold = binding.hold as {ms: number; action: () => unknown};
      const bar = 'child' in target ? (target as UIComponent).child('holdProgress') as UIProgress | null : null;
      if (bar) claimProgress(bar);
      handlers.hold = {ms: hold.ms, action: () => run(hold.action, ...item), progress: ratio => { if (bar && 'max' in bar && ctx.isActive()) bar.value = ratio * bar.max; }};
    }
    if (binding.drag || dragging) handlers.drag = g => { if (binding.drag) run(binding.drag, g); dragging?.(g); };
    if (binding.swipe) handlers.swipe = g => run(binding.swipe, g);
    if (binding.pinch) handlers.pinch = g => run(binding.pinch, g);
    if (binding.hover) handlers.hover = inside => run(binding.hover, inside);
    const platform = runtime().backend.platform;
    ctx.scope.add(recognize(target, platform.input, platform.time, handlers));
    // 滚轮只认落在这个控件（或它里面的控件）上的事件。
    if (binding.wheel) ctx.scope.add(target.onWheel(e => run(binding.wheel, {dx: e.deltaX, dy: e.deltaY})));
  } else if (binding.lockWhilePending) {
    fail('LGUI-RT-063', `${ctx.where} 的 ${key} 写了 lockWhilePending，但没有动作。`, '和 click 一起用。');
  }
}

/** tick：每隔这么多毫秒按现在的值重算这一项的每个显示词（结果变了才写，写的时候各个控件自己比较）；被盖住时不算，露出来马上算一次。 */
function bindTick(ms: unknown, refreshes: readonly (() => void)[], ctx: BindContext, key: string): void {
  const ok = soft(() => {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) bindingError(ctx, key, `的 tick 是 ${String(ms)}，要写正数（毫秒）。`, '写成 tick: 1000（倒计时每秒重算一次）。');
    if (!refreshes.length) bindingError(ctx, key, '写了 tick，但这一项没有显示词（text、visible、enabled、icon、progress、value、playing）。', 'tick 定时重算显示词的值；没有显示词就去掉 tick。');
  });
  if (!ok) return;
  const {timers} = ownerParts(ctx);
  if (!timers) return;
  ctx.scope.add(timers.tick(ms as number, () => { for (const refresh of refreshes) refresh(); }));
}

/** 单独的 Check、Radio 按钮：selected 显示 Model 的值，用户点击时由 click 交给 Controller 改 Model。
 * FairyGUI 点 Check、Radio 按钮时自己切换选中（在框架的点击处理之后），所以每次点完，下一帧（画出来之前）再按绑定的值写回一次，选中状态只跟 Model 走。 */
function bindSelected(button: UIButton, value: unknown, ctx: BindContext, key: string): void {
  // 普通按钮（Common 模式）不保持选中：绑定时就报，不等值第一次变成 true。
  if (button.mode !== 'Check' && button.mode !== 'Radio') fail('LGUI-RT-242', `${ctx.where} 的 ${key} 绑定了 selected，但它是 ${button.mode} 模式的按钮，显示不出选中。`, '在 ui/ 里把这个按钮组件的模式改成 Check（开关）或 Radio（单选），或者去掉 selected。');
  const show = (selected: boolean): void => { button.selected = selected; };
  watch<boolean>(value, ctx, v => show(v === true));
  const {time} = runtime().backend.platform;
  let waiting: (() => void) | null = null;
  ctx.scope.add(button.onPointer(e => {
    if (e.type !== 'up' || waiting) return;
    const stop = time.onFrame(() => {
      if (waiting) ctx.scope.remove(waiting);
      if (!ctx.scope.isClosed) show(current<boolean>(value, ctx) === true);
    });
    waiting = () => { stop(); waiting = null; };
    ctx.scope.add(waiting);
  }));
}

/** 下拉框：items 是每一项的文字，selected 是选中项的序号，select 在用户选了一项时调用。 */
function bindComboBox(combo: UIComboBox, binding: Record<string, unknown>, ctx: BindContext, key: string): void {
  for (const word of ['item', 'key']) if (word in binding) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 是下拉框，不能用 ${word}。`, '下拉框只用 items、selected、select。');
  let selected = -1;
  if ('items' in binding) watch<readonly string[]>(binding.items, ctx, items => { combo.items = items.map(String); if ('selected' in binding) combo.selectedIndex = selected; });
  if ('selected' in binding) watch<number>(binding.selected, ctx, index => { selected = index; combo.selectedIndex = index; });
  if (binding.select) {
    const select = binding.select as (index: number) => unknown;
    ctx.scope.add(combo.onChange(index => { if (ctx.isActive() && combo.enabled) asActor(ctx.owner, () => select(index)); }));
  }
}

/** 绑定一个控制器：page 显示当前页，change 在用户切页时调用。 */
function bindController(controller: UIController, key: string, binding: Record<string, unknown>, ctx: BindContext): void {
  for (const word of Object.keys(binding)) {
    if (!controllerWords.includes(word)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 是控制器，只能用 page 和 change，不能用 ${word}。`, '控制器只写 page 和 change。');
  }
  let setting = false;
  if ('page' in binding) watch<string>(binding.page, ctx, page => { setting = true; try { controller.selectedPage = page; } finally { setting = false; } });
  if (binding.change) {
    const change = binding.change as (page: string) => unknown;
    ctx.scope.add(controller.onChange(page => { if (!setting && ctx.isActive()) asActor(ctx.owner, () => change(page)); }));
  }
}

/** 把一张绑定表接到组件上。 */
export function applyBindings(component: UIComponent, table: Table, ctx: BindContext): void {
  for (const [key, binding] of Object.entries(table)) {
    if (!binding) continue;
    const resolved = resolve(component, key, ctx.where);
    if (resolved.kind === 'controller') bindController(resolved.target, key, binding, ctx);
    else if (resolved.kind === 'transition') bindTransition(resolved.target, key, binding, ctx);
    else bindObject(component, key, resolved.target, binding, ctx);
  }
}

export type {UIImage};

/** 部件、列表子项登记到所在的界面，定时器跟着它暂停；ctx.owner 不是界面（测试里直接绑）时不登记。 */
export function adoptChild(owner: object, child: object): () => void {
  const adopt = (owner as {__adopt?: (c: object) => () => void}).__adopt;
  return typeof adopt === 'function' ? adopt.call(owner, child) : () => {};
}
