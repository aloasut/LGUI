// 代码补间对外的三个方法（View、PartView 的 this.tween / this.stopTweens / this.itemsOf）和框架内部用的按下效果、roll。
// 报错都是第 ① 类（写错了）：开发和测试里抛错，正式构建记 error 日志、这次调用不生效。错误码 LGUI-RT-280–284。
import type {TweenProp, UIButton, UIComponent, UIList, UIObject, UITransition} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {fault} from '../log';
import type {Ease, RollOptions, TweenOptions, TweenProps} from '../types';
import {eases, isEase} from './ease';
import {hasText} from './text';
import type {Channel, Key, Timing, TweenGroup} from './engine';
import {TOUCHED_BY, Tween, eachTransition, engine, pathOf, valueAt} from './engine';

export {TweenGroup} from './engine';

const NEVER = new Promise<void>(() => {});

/** 绑定表里写了 progress 的进度条、长按的 holdProgress、写了 roll 的文字：这些属性归绑定管（代码补间碰它们报 LGUI-RT-282）。 */
const boundProgress = new WeakSet<UIObject>();
const rolled = new WeakSet<UIObject>();
/** 内部用：绑定登记「这个进度条的值归绑定管」。 */
export function claimProgress(object: UIObject): void { boundProgress.add(object); }
/** 内部用：绑定登记「这段文字写了 roll」。 */
export function claimRoll(object: UIObject): void { rolled.add(object); }

const PROPS = ['dx', 'dy', 'scale', 'scaleX', 'scaleY', 'rotation', 'alpha', 'width', 'height', 'color', 'fontSize', 'fillAmount', 'progress', 'chars'] as const;
type PropName = typeof PROPS[number];

function error(code: string, message: string, fix: string): LgRuntimeError { return new LgRuntimeError(code, message, fix); }
const arg = (where: string, message: string, fix: string): LgRuntimeError => error('LGUI-RT-280', `${where} 的 this.tween：${message}`, fix);

/** 一项属性 → 引擎里的哪几项（dx、dy 记在 x、y 上；scale 拆成 scaleX、scaleY）。 */
function keysOf(prop: PropName): Key[] {
  if (prop === 'dx') return ['x'];
  if (prop === 'dy') return ['y'];
  if (prop === 'scale') return ['scaleX', 'scaleY'];
  return [prop];
}

/** 查一组属性的写法和取值范围，换成「引擎里的一项 → 值」（颜色换成数字）。 */
function readProps(props: unknown, label: string, where: string): Map<Key, number> {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) throw arg(where, `${label}要写成一个对象，比如 { scale: 1 }。`, '属性写在同一个对象里：{ dx: 0, alpha: 1 }。');
  const record = props as Record<string, unknown>;
  const names = Object.keys(record);
  for (const name of names) if (!(PROPS as readonly string[]).includes(name)) throw arg(where, `${label}里的 ${name} 不是能补间的属性。`, `能用的属性：${PROPS.join('、')}。`);
  if ('scale' in record && ('scaleX' in record || 'scaleY' in record)) throw arg(where, `${label}里 scale 和 scaleX / scaleY 写在了一起。`, 'scale 等于同时写 scaleX 和 scaleY，二选一。');
  const out = new Map<Key, number>();
  for (const name of names as PropName[]) {
    const value = record[name];
    let n: number;
    if (name === 'color') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw arg(where, `${label}里的 color 是 ${JSON.stringify(value)}，要写成 '#rrggbb'。`, "颜色写成 '#ff3b30' 这样；透明度用 alpha。");
      n = parseInt(value.slice(1), 16);
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw arg(where, `${label}里的 ${name} 是 ${String(value)}，不是有限的数字。`, '属性的值写成数字。');
      n = value;
      const range = name === 'alpha' || name === 'fillAmount' ? [0, 1] : name === 'progress' ? [0, 100] : ['scale', 'scaleX', 'scaleY', 'width', 'height', 'fontSize', 'chars'].includes(name) ? [0, Infinity] : null;
      if (range && (n < range[0] || n > range[1])) throw arg(where, `${label}里的 ${name} 是 ${n}，超出范围（${range[1] === Infinity ? '不能为负' : `${range[0]}–${range[1]}`}）。`, name === 'alpha' || name === 'fillAmount' ? `${name} 在 0–1 之间。` : name === 'progress' ? 'progress 在 0–100 之间（和绑定词 progress 同一个单位）。' : `${name} 不能为负。`);
    }
    for (const key of keysOf(name)) out.set(key, n);
  }
  return out;
}

/** 查选项，换成节奏（delay 是数组目标时按序号算的，这里先不算）。 */
function readOptions(options: unknown, where: string): {timing: Omit<Timing, 'delay'>; delay: number | ((index: number) => number)} {
  if (typeof options !== 'object' || options === null) throw arg(where, '没写选项（duration 必填）。', '写成 this.tween(目标, { scale: 1 }, { duration: 250 })。');
  const o = options as Partial<TweenOptions> & Record<string, unknown>;
  for (const name of Object.keys(o)) if (!['duration', 'ease', 'delay', 'from', 'repeat', 'yoyo'].includes(name)) throw arg(where, `选项里的 ${name} 不认识。`, '能用的选项：duration、ease、delay、from、repeat、yoyo。');
  if (typeof o.duration !== 'number' || !Number.isFinite(o.duration) || o.duration < 0) throw arg(where, `duration 是 ${String(o.duration)}：必填，毫秒，不能为负。`, '写上 duration，比如 { duration: 250 }。');
  const ease: Ease = o.ease ?? 'Quad.Out';
  if (!isEase(ease)) throw arg(where, `ease 是 ${String(o.ease)}，不是缓动名。`, "写法和 ui/ 的 XML 一样，比如 'Quad.Out'、'Back.Out'、'Linear'。");
  const repeat = o.repeat ?? 0;
  if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < -1) throw arg(where, `repeat 是 ${String(o.repeat)}：要写不小于 -1 的整数（-1 一直循环）。`, 'repeat 写再重复几次，比如 repeat: 1；一直循环写 -1。');
  if (repeat < 0 && o.duration === 0) throw arg(where, 'duration 是 0 又一直循环（repeat: -1）。', '一直循环时 duration 要大于 0。');
  if (o.yoyo !== undefined && typeof o.yoyo !== 'boolean') throw arg(where, `yoyo 是 ${String(o.yoyo)}，要写 true 或 false。`, '来回走写 yoyo: true。');
  const delay = o.delay ?? 0;
  if (typeof delay !== 'function' && (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0)) throw arg(where, `delay 是 ${String(o.delay)}：毫秒，不能为负；目标是数组时可以写成 i => i * 80。`, '写成 delay: 100 或 delay: i => i * 80。');
  return {timing: {duration: o.duration, ease: eases[ease], repeat, yoyo: o.yoyo === true}, delay};
}

/** 这个属性在这个控件上能不能补（LGUI-RT-280）。 */
function supported(object: UIObject, key: Key): boolean {
  if (key === 'chars') return hasText(object);
  return object.supports(key as TweenProp);
}

const owned = (object: UIObject, key: Key, by: string, where: string): LgRuntimeError =>
  error('LGUI-RT-282', `${where} 的 this.tween 要改 ${object.name} 的 ${key === 'x' ? 'dx' : key === 'y' ? 'dy' : key}，但它还归${by}管，两边会抢同一个属性。`, '同一个控件的同一个属性只交给一方：两方都要动就套一层（外层归一方、里层归另一方，效果相乘或相加），见 mvc-spec「代码补间」和 motion.md。');

/** 这一项还有没有别的主人（LGUI-RT-282）：齿轮、按钮的按下效果、正在放的 ui/ 动效、绑定。 */
function checkOwner(object: UIObject, key: Key, playing: readonly UITransition[], where: string): void {
  if (key === 'chars') { if (rolled.has(object)) throw owned(object, key, '绑定的 roll（每帧换字，露几个字没有意义）', where); return; }
  const gear = object.ownerOf(key as TweenProp);
  if (gear) throw owned(object, key, gear, where);
  if ((key === 'scaleX' || key === 'scaleY') && 'downEffect' in object && (object as UIButton).downEffect.type === 'scale') throw owned(object, key, '按钮的 downEffect="scale"（按下、松开由框架补缩放）', where);
  if (key === 'color') {
    for (let o: UIObject | null = object; o; o = o.parent) if ('downEffect' in o && (o as UIButton).downEffect.type === 'dark') throw owned(object, key, `按钮 ${o.name} 的 downEffect="dark"（按下时改按钮里各控件的颜色）`, where);
  }
  if (key === 'progress' && boundProgress.has(object)) throw owned(object, key, '绑定表里的 progress（或长按的 holdProgress）', where);
  // 按钮、标签的标题颜色、字号就是 title 子控件的：动效改 title 的颜色也算（齿轮那一侧由后端的 ownerOf 查）。
  const title = (key === 'color' || key === 'fontSize') && 'title' in object && 'child' in object ? (object as unknown as UIComponent).child('title') : null;
  for (const t of playing) {
    for (const touch of t.touches()) {
      if ((touch.target === object || touch.target === title) && TOUCHED_BY[touch.what].includes(key)) throw owned(object, key, `正在放的 ui/ 动效 ${t.name}${touch.target === title ? '（改的是标题 title）' : ''}`, where);
    }
  }
}

/** 内部用：this.tween。 */
export function startTween(group: TweenGroup, where: string, target: UIObject | readonly UIObject[], to: TweenProps, options: TweenOptions): Promise<void> {
  try {
    return start(group, where, target, to, options);
  } catch (e) {
    if (!(e instanceof LgRuntimeError)) throw e;
    fault(e, {where});
    return NEVER;
  }
}

function start(group: TweenGroup, where: string, target: UIObject | readonly UIObject[], to: TweenProps, options: TweenOptions): Promise<void> {
  const root = group.root;
  if (!root) throw error('LGUI-RT-065', `${where} 还没打开或已经关闭，不能用 this.tween。`, '在生命周期钩子、this.after / this.every 的回调、this.on 的收听回调里用 this.tween。');
  const {timing, delay} = readOptions(options, where);
  const end = readProps(to, '终值', where);
  const from = options.from === undefined ? new Map<Key, number>() : readProps(options.from, 'from ', where);
  for (const key of from.keys()) if (!end.has(key)) throw arg(where, `from 里写了 ${key === 'x' ? 'dx' : key === 'y' ? 'dy' : key}，终值里没有。`, 'from 只写终值里有的属性。');
  const targets = Array.isArray(target) ? target as readonly UIObject[] : [target as UIObject];
  if (!targets.length) return Promise.resolve();
  let playing: UITransition[] | null = null;
  const plans: {object: UIObject; delay: number}[] = [];
  targets.forEach((object, index) => {
    if (!object || typeof object !== 'object' || !('getProp' in object)) throw error('LGUI-RT-281', `${where} 的 this.tween 的目标${targets.length > 1 ? `（第 ${index} 个）` : ''}不是控件（${String(object)}）。`, '目标写 this.ui.<控件>，列表的子项用 this.itemsOf(列表)。');
    if (object.disposed || !pathOf(root, object)) throw error('LGUI-RT-281', `${where} 的 this.tween 的目标 ${object.name} ${object.disposed ? '已经销毁了' : '不在这个界面自己的组件里'}。`, '目标写这个界面自己的 this.ui.<控件>；别的界面的控件由那个界面自己补。');
    for (const key of end.keys()) {
      if (!supported(object, key)) throw arg(where, `${object.name} 不支持 ${key === 'x' ? 'dx' : key === 'y' ? 'dy' : key}${key === 'fillAmount' ? '（只有设了填充方式的图片、加载器能补 fillAmount）' : ''}。`, '每种属性能用在哪种控件上见 mvc-spec「代码补间」的属性表。');
      playing ??= collectPlaying(root);
      checkOwner(object, key, playing, where);
      if ((key === 'scaleX' || key === 'scaleY' || key === 'rotation')) {
        const {x, y} = object.pivot;
        if (x === 0 && y === 0) throw error('LGUI-RT-283', `${where} 的 this.tween 要补 ${object.name} 的${key === 'rotation' ? '旋转' : '缩放'}，但它的轴心是 (0, 0)：会${key === 'rotation' ? '绕左上角转' : '从左上角缩放'}。`, '在 ui/ 里给这个控件设轴心：从中间缩放、旋转设 (0.5, 0.5)；要从一边拉长（血条用 scaleX）设成 (0, 0.5) 这类。');
      }
    }
    const wait = typeof delay === 'function' ? delay(index) : delay;
    if (typeof wait !== 'number' || !Number.isFinite(wait) || wait < 0) throw arg(where, `delay 按序号算出来第 ${index} 个是 ${String(wait)}，不能为负。`, 'delay 函数返回不小于 0 的毫秒数。');
    plans.push({object, delay: wait});
  });
  const e = engine();
  return new Promise<void>(resolve => {
    let left = plans.length;
    const done = (): void => { if (--left === 0) resolve(); };
    for (const plan of plans) {
      const channels: Channel[] = [];
      for (const [key, value] of end) {
        e.origin(plan.object, key, group);
        channels.push({object: plan.object, key, from: from.get(key) ?? e.current(plan.object, key, group), to: value, last: null});
      }
      const tween = new Tween(group, 'code', {...timing, delay: plan.delay}, channels, done);
      e.add(tween);
      // from 马上生效（在 delay 之前，第一帧画出来之前就是起点）。
      for (const c of channels) if (from.has(c.key)) e.write(tween, c, valueAt(c, 0));
      if (plan.delay === 0 && timing.duration === 0) e.step(tween, 0);
    }
  });
}

/** 组件里正在放的 ui/ 动效。 */
function collectPlaying(root: UIComponent): UITransition[] {
  const found: UITransition[] = [];
  eachTransition(root, t => { if (t.playing) found.push(t); });
  return found;
}

/** 内部用：this.stopTweens。 */
export function stopTweens(group: TweenGroup, where: string, target: UIObject | readonly UIObject[] | undefined, options: {complete?: boolean} = {}): void {
  const targets = target === undefined ? null : Array.isArray(target) ? target as readonly UIObject[] : [target as UIObject];
  group.stop(targets, options.complete === true);
  void where;
}

/** 内部用：this.itemsOf。写错了（虚拟列表、不是列表）开发模式抛出；正式构建记 error 日志，返回空数组（补间马上 resolve，什么也不动）。 */
export function itemsOf(group: TweenGroup, where: string, list: UIList): UIComponent[] {
  void group;
  try {
    return listItems(where, list);
  } catch (e) {
    if (!(e instanceof LgRuntimeError)) throw e;
    fault(e, {where});
    return [];
  }
}

function listItems(where: string, list: UIList): UIComponent[] {
  if (!list || typeof list !== 'object' || !('numItems' in list) || !('itemAt' in list)) throw error('LGUI-RT-281', `${where} 的 this.itemsOf 要的是列表（${String(list && (list as UIObject).name)} 不是）。`, '写成 this.itemsOf(this.ui.<列表>)。');
  if (list.virtual) throw error('LGUI-RT-281', `${where} 的 this.itemsOf 用在了虚拟列表 ${list.name} 上：虚拟列表只创建看得见的子项，还会重复使用，按序号对不上。`, '要逐个弹出的列表用不滚动的普通列表（ui/ 里不写 overflow="scroll"）；能滚动的长列表不做逐项补间。');
  const items: UIComponent[] = [];
  for (let i = 0; i < list.numItems; i++) { const item = list.itemAt(i); if (item) items.push(item); }
  return items;
}

/** 按钮按下效果的参数（写死，不开放配置）：按下 50 毫秒 Quad.Out，松开 100 毫秒 Back.Out。 */
export const PRESS = {down: {duration: 50, ease: 'Quad.Out' as Ease}, up: {duration: 100, ease: 'Back.Out' as Ease}};

/** 内部用：按钮按下（down）或松开：从现在的缩放补到 downEffectValue 或 1；连点时松开的接管按下的。 */
export function press(group: TweenGroup, button: UIButton, down: boolean): void {
  const e = engine();
  const spec = down ? PRESS.down : PRESS.up;
  e.origin(button, 'press', group);
  const channel: Channel = {object: button, key: 'press', from: button.pressScale, to: down ? button.downEffect.value : 1, last: null};
  e.add(new Tween(group, 'press', {duration: spec.duration, ease: eases[spec.ease], delay: 0, repeat: 0, yoyo: false}, [channel], null));
}

/** 内部用：绑定的 roll：从 from 滚到 to，每帧调用 write；滚动中值又变了，新的接管（从现在显示的数接着滚）。返回停掉它。 */
export function roll(group: TweenGroup, object: UIObject, from: number, to: number, options: RollOptions, write: (value: number) => void): () => void {
  const e = engine();
  const channel: Channel = {object, key: 'roll', from, to, last: null, write};
  const tween = new Tween(group, 'roll', {duration: options.duration, ease: eases[options.ease ?? 'Quad.Out'], delay: 0, repeat: 0, yoyo: false}, [channel], null);
  e.add(tween);
  if (options.duration === 0) e.step(tween, 0);
  return () => e.end(tween, false);
}

/** 内部用：绑定表开始放一个动效时反过来查一遍：它改的属性有没有代码补间正在补（LGUI-RT-282）。 */
export function checkTransition(transition: UITransition, where: string): void {
  const e = engine();
  for (const touch of transition.touches()) {
    for (const key of TOUCHED_BY[touch.what]) {
      const tween = e.owner(touch.target, key);
      if (tween && tween.kind === 'code') throw error('LGUI-RT-282', `${where} 开始放动效 ${transition.name}，它改 ${touch.target.name} 的 ${key === 'x' ? '位置' : key}，可这个属性正在被代码补间改。`, '同一个控件的同一个属性只交给一方：两方都要动就套一层（外层归一方、里层归另一方），见 mvc-spec「代码补间」和 motion.md。');
    }
  }
}

/** 内部用：t.look 读引擎记的原位（算 dx、dy；跟着关联挪过的）；没被补间碰过时是现在的位置。 */
export function originOf(object: UIObject, key: 'x' | 'y'): number { const e = engine(); return e.origins.get(object)?.has(key) ? e.follow(object, key) : object.getProp(key); }

/** 内部用：补间碰过这个控件的这一项没有（碰过以后 headless 知道它的值）。 */
export function tweened(object: UIObject, key: Key): boolean { return engine().origins.get(object)?.has(key) ?? false; }

/** 内部用：引擎里还有几个补间、帧回调退订了没有（t.end() 检查）。 */
export function engineState(): {tweens: number; subscribed: boolean} { const e = engine(); return {tweens: e.tweens.size, subscribed: e.subscribed}; }

export type {Key};
