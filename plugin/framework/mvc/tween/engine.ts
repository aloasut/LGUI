// 代码补间的引擎：三端共用一套，跑在 LGUI 自己的帧时钟（platform.time.onFrame）上。
// 只有一个每帧回调：有补间（含绑定的 roll 和按钮的按下效果）时才订阅，最后一个停了就退订。
// 每帧对每个补间：所在界面暂停就跳过 → 累计时间 → 过了 delay 算进度（含重复、来回）→ 缓动 → 插值 → 写属性（值没变不写）。
// 一个补间出错不影响别的，这一帧跑完再把第一个错误抛出去（和 ViewTimers 一样）。
// 还登记「控件 + 属性 → 当前补间」（同一属性后来的接管）和每个碰过的控件在 ui/ 里的原值（算偏移、关闭时还原）。
// 状态挂在当前运行时上，每个测试重新开始。写法和语义见 references/mvc-spec.md 的「代码补间」一节。
import type {TweenProp, TransitionTouch, UIButton, UIComponent, UIList, UIObject, UITransition} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {runtime} from '../runtime';
import {devMode} from '../log';
import {eases} from './ease';
import {fullText, setTyping, showAll, showChars, shownChars, visibleCount} from './text';

/** 引擎里的一项：控件的属性，加上打字机（chars）、按钮的按下缩放（press）、绑定的数字滚动（roll）。dx、dy 记在 x、y 上（值是偏移）。 */
export type Key = TweenProp | 'chars' | 'press' | 'roll';

/** 补间是谁放的：代码（this.tween）、按钮的按下效果、绑定的 roll。只有代码放的会被 stopTweens 停、在重建时带到新组件上。 */
export type TweenKind = 'code' | 'press' | 'roll';

/** 一个补间的节奏（毫秒）。 */
export interface Timing {
  duration: number;
  ease: (t: number) => number;
  delay: number;
  /** 再重复几次，-1 一直循环。 */
  repeat: number;
  yoyo: boolean;
}

export interface Channel {
  object: UIObject;
  key: Key;
  from: number;
  to: number;
  /** 上次写的值（x、y 是写进去的绝对位置）；还没写过是 null。 */
  last: number | null;
  /** roll 的写法（交给绑定格式化后写文字或进度条）。 */
  write?: (value: number) => void;
}

const fail = (code: string, message: string, fix: string): LgRuntimeError => new LgRuntimeError(code, message, fix);

/** 一个补间：同一个目标的几项属性，同一个节奏。 */
export class Tween {
  elapsed = 0;
  /** 已经结束（放完、停掉或被接管完）。 */
  ended = false;
  constructor(readonly group: TweenGroup, readonly kind: TweenKind, readonly timing: Timing, readonly channels: Channel[], readonly done: (() => void) | null) {}
}

/** 一轮内的进度（0–1，已经按来回倒过来、按缓动算好）。finished：总时长走完了。 */
function progress(t: Timing, elapsed: number): {eased: number; finished: boolean} {
  const time = elapsed - t.delay;
  if (time < 0) return {eased: 0, finished: false};
  if (t.duration <= 0) return {eased: t.yoyo && t.repeat > 0 && t.repeat % 2 === 1 ? 0 : 1, finished: t.repeat >= 0};
  const total = t.repeat < 0 ? Infinity : t.duration * (t.repeat + 1);
  if (time >= total) {
    const reversed = t.yoyo && t.repeat % 2 === 1;
    return {eased: t.ease(reversed ? 0 : 1), finished: true};
  }
  const round = Math.floor(time / t.duration);
  const local = (time - round * t.duration) / t.duration;
  const reversed = t.yoyo && round % 2 === 1;
  return {eased: t.ease(reversed ? 1 - local : local), finished: false};
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, e: number): number => a + (b - a) * e;
function mixColor(a: number, b: number, e: number): number {
  const ch = (shift: number): number => clamp(Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, e)), 0, 255) << shift;
  return ch(16) | ch(8) | ch(0);
}

/** 按缓动后的进度算这一项的值（中间值按属性夹住、取整）。 */
export function valueAt(c: Channel, eased: number): number {
  switch (c.key) {
    case 'color': return mixColor(c.from, c.to, eased);
    case 'alpha': case 'fillAmount': return clamp(lerp(c.from, c.to, eased), 0, 1);
    case 'progress': return clamp(lerp(c.from, c.to, eased), 0, 100);
    case 'width': case 'height': return Math.max(0, lerp(c.from, c.to, eased));
    case 'fontSize': return Math.max(0, Math.round(lerp(c.from, c.to, eased)));
    case 'chars': return Math.max(0, Math.floor(lerp(c.from, c.to, eased) + 1e-9)); // 浮点误差不让整字少一个（120 / 280 × 7 = 2.9999…）
    default: return lerp(c.from, c.to, eased);
  }
}

// 浮点写进去再读出来可能差一点点（Unity 是 float）：差得不多就算没被别人改过。
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));
// 颜色按 r、g、b 分量比（各端换算可能差 1），不拿整数做相对容差。
const sameColor = (a: number, b: number): boolean => [16, 8, 0].every(shift => Math.abs(((a >> shift) & 0xff) - ((b >> shift) & 0xff)) <= 1);

/** 位置、尺寸：关联（屏幕尺寸变了）会挪它、拉它，原位要跟着走。 */
const LAYOUT: readonly Key[] = ['x', 'y', 'width', 'height'];

/** 「控件 + 属性」这一项归哪类东西管时报的说明：动效的哪一类项会改它。 */
export const TOUCHED_BY: Record<TransitionTouch, Key[]> = {
  xy: ['x', 'y'], shake: ['x', 'y'], size: ['width', 'height'], scale: ['scaleX', 'scaleY'], alpha: ['alpha'], rotation: ['rotation'], color: ['color'], text: ['roll']
};

/** 组件里（含子组件、列表子项）的每个动效。 */
export function eachTransition(object: UIObject, visit: (t: UITransition) => void): void {
  if ('numItems' in object && 'itemAt' in object) {
    const list = object as UIList;
    for (let i = 0; i < list.numItems; i++) { const item = list.itemAt(i); if (item) eachTransition(item, visit); }
    return;
  }
  if (!('childNames' in object)) return;
  const component = object as UIComponent;
  for (const t of component.allTransitions()) visit(t);
  for (const name of component.childNames()) { const child = component.child(name); if (child) eachTransition(child, visit); }
}

/** 一段路径：控件名，或者列表的第几项。 */
type Step = string | number;

/** 控件在组件里的路径（header.icon、rewards[2] 记成 ['rewards', 2]）；不在这个组件里返回 null。 */
export function pathOf(root: UIObject, object: UIObject): Step[] | null {
  const steps: Step[] = [];
  for (let o: UIObject | null = object; o !== root; o = o.parent) {
    if (!o) return null;
    const parent: UIObject | null = o.parent;
    if (!parent) return null;
    if ('numItems' in parent && 'itemAt' in parent) {
      const list = parent as UIList;
      let index = -1;
      for (let i = 0; i < list.numItems && index < 0; i++) if (list.itemAt(i) === o) index = i;
      if (index < 0) return null;
      steps.unshift(index);
    } else steps.unshift(o.name);
  }
  return steps;
}

/** 按路径找控件，找不到返回 null。 */
export function follow(root: UIObject, steps: readonly Step[]): UIObject | null {
  let current: UIObject | null = root;
  for (const step of steps) {
    if (!current) return null;
    if (typeof step === 'number') current = 'itemAt' in current ? (current as UIList).itemAt(step) : null;
    else current = 'child' in current ? (current as UIComponent).child(step) : null;
  }
  return current;
}

export const describePath = (steps: readonly Step[]): string => steps.map((s, i) => typeof s === 'number' ? `[${s}]` : (i ? '.' : '') + s).join('');

/** 每个运行时一份。 */
class Engine {
  readonly tweens = new Set<Tween>();
  /** 控件 + 一项 → 正在改它的补间。 */
  readonly owners = new WeakMap<UIObject, Map<Key, Tween>>();
  /** 控件在 ui/ 里的原值（第一次被补间碰到时记下；位置、尺寸跟着关联的挪动更新）。 */
  readonly origins = new WeakMap<UIObject, Map<Key, number>>();
  /** 位置、尺寸上次由补间写进去的值：再读到不一样，就是关联挪过它，原位跟着挪同样多。 */
  readonly written = new WeakMap<UIObject, Map<Key, number>>();
  private stopFrames: (() => void) | null = null;

  /** 有没有订阅帧回调（t.end() 检查）。 */
  get subscribed(): boolean { return this.stopFrames !== null; }

  owner(object: UIObject, key: Key): Tween | null { return this.owners.get(object)?.get(key) ?? null; }

  /** 记下原值（已经记过就不再记），返回它。 */
  origin(object: UIObject, key: Key, group: TweenGroup): number {
    let map = this.origins.get(object);
    if (!map) { map = new Map(); this.origins.set(object, map); }
    let value = map.get(key);
    if (value === undefined) {
      value = key === 'chars' ? shownChars(object) : key === 'press' ? (object as UIButton).pressScale : key === 'roll' ? 0 : object.getProp(key);
      map.set(key, value);
      group.touched.add(object);
    } else if (LAYOUT.includes(key)) value = this.follow(object, key);
    return value;
  }

  /** 位置、尺寸：上次补间写完以后被关联挪过、拉过，原位跟着挪同样多（补间结束以后也一样），返回现在的原位。 */
  follow(object: UIObject, key: Key): number {
    const origins = this.origins.get(object);
    const origin = origins?.get(key) ?? 0;
    const last = this.written.get(object)?.get(key);
    if (!origins || last === undefined) return origin;
    const now = object.getProp(key as TweenProp);
    if (same(now, last)) return origin;
    origins.set(key, origin + now - last);
    this.written.get(object)?.set(key, now);
    return origin + now - last;
  }

  /** 记下补间写进去的位置、尺寸。 */
  private wrote(object: UIObject, key: Key, value: number): void {
    let map = this.written.get(object);
    if (!map) { map = new Map(); this.written.set(object, map); }
    map.set(key, value);
  }

  /** 从引擎里摘下一个补间（重建时先摘、接到新组件上再加回来）：不结束、不 resolve。没有补间了就退订帧回调。 */
  detach(tween: Tween): void {
    for (const c of tween.channels) {
      const map = this.owners.get(c.object);
      if (map?.get(c.key) === tween) map.delete(c.key);
      if (c.key === 'chars') setTyping(c.object, false);
    }
    this.tweens.delete(tween);
    tween.group.tweens.delete(tween);
    if (!this.tweens.size && this.stopFrames) { this.stopFrames(); this.stopFrames = null; }
  }

  /** 现在的值（x、y 是相对原位的偏移）。 */
  current(object: UIObject, key: Key, group: TweenGroup): number {
    if (key === 'x' || key === 'y') return object.getProp(key) - this.origin(object, key, group);
    if (key === 'chars') return shownChars(object);
    if (key === 'press') return (object as UIButton).pressScale;
    return object.getProp(key as TweenProp);
  }

  add(tween: Tween): void {
    // 同一项后来的接管：旧补间交出这一项，别的属性照走；全交出去的算停止（Promise 不 resolve）。
    for (const c of tween.channels) {
      let map = this.owners.get(c.object);
      if (!map) { map = new Map(); this.owners.set(c.object, map); }
      const old = map.get(c.key);
      if (old && old !== tween) this.release(old, c.object, c.key);
      map.set(c.key, tween);
      if (c.key === 'chars') setTyping(c.object, true);
    }
    this.tweens.add(tween);
    tween.group.tweens.add(tween);
    if (!this.stopFrames) this.stopFrames = runtime().backend.platform.time.onFrame(dt => this.frame(dt));
  }

  /** 旧补间交出一项。 */
  private release(tween: Tween, object: UIObject, key: Key): void {
    const index = tween.channels.findIndex(c => c.object === object && c.key === key);
    if (index >= 0) tween.channels.splice(index, 1);
    if (key === 'chars') setTyping(object, false);
    if (!tween.channels.length) this.end(tween, false);
  }

  /** 结束一个补间：交出它管的每一项；放完的调用 done（Promise resolve）。 */
  end(tween: Tween, finished: boolean): void {
    if (tween.ended) return;
    tween.ended = true;
    for (const c of tween.channels) {
      const map = this.owners.get(c.object);
      if (map?.get(c.key) === tween) map.delete(c.key);
      if (c.key === 'chars') {
        setTyping(c.object, false);
        // 放完、终值不少于字数时恢复成「全部显示」。
        if (finished && !c.object.disposed && (c.last ?? 0) >= visibleCount(fullText(c.object))) showAll(c.object);
      }
    }
    this.tweens.delete(tween);
    tween.group.tweens.delete(tween);
    if (!this.tweens.size && this.stopFrames) { this.stopFrames(); this.stopFrames = null; }
    if (finished) tween.done?.();
  }

  private frame(dt: number): void {
    let failure: {error: unknown} | null = null;
    for (const tween of [...this.tweens]) {
      if (tween.ended || tween.group.paused) continue;
      try { this.step(tween, dt); } catch (error) { this.end(tween, false); if (!failure) failure = {error}; }
    }
    if (failure) throw failure.error;
  }

  /** 走 dt 毫秒并写属性。 */
  step(tween: Tween, dt: number): void {
    for (const c of tween.channels) {
      if (!c.object.disposed) continue;
      this.end(tween, false);
      // 按下效果、roll 的控件跟着列表子项、界面一起销毁是正常的；代码补间的目标被销毁说明框架漏了一种情况。
      if (tween.kind === 'code') throw fail('LGUI-RT-281', `补间的目标 ${c.object.name} 已经销毁了，补间停掉。`, '这说明框架漏了一种情况（关闭、重建、列表换数据都会先停掉或接上补间）：请把复现步骤报给 LGUI。');
      return;
    }
    tween.elapsed += dt;
    const {eased, finished} = progress(tween.timing, tween.elapsed);
    if (tween.elapsed >= tween.timing.delay) for (const c of tween.channels) this.write(tween, c, valueAt(c, eased));
    if (finished) this.end(tween, true);
  }

  /** 写一项。写之前对一下上次写的值：被别人改了时，位置按新的原位接着算偏移（关联在挪它）、尺寸接着往终值写（关联在拉它），其余开发模式下报 LGUI-RT-282。 */
  write(tween: Tween, c: Channel, value: number): void {
    const o = c.object;
    switch (c.key) {
      case 'roll': if (c.last !== value) { c.last = value; c.write?.(value); } return;
      case 'press': if (c.last !== value) { c.last = value; (o as UIButton).pressScale = value; } return;
      case 'chars': if (c.last !== value) { c.last = value; showChars(o, value); } return;
      case 'x': case 'y': {
        // 位置：被关联挪了，按新的原位接着算偏移。
        const target = this.follow(o, c.key) + value;
        c.last = target;
        if (o.getProp(c.key) !== target) o.setProp(c.key, target);
        this.wrote(o, c.key, target);
        return;
      }
      case 'width': case 'height': {
        // 尺寸：被关联拉了，原位跟着变（关闭时还原成关联算出来的），补间照样往终值写。
        this.follow(o, c.key);
        if (o.getProp(c.key) !== value) o.setProp(c.key, value);
        c.last = value;
        this.wrote(o, c.key, value);
        return;
      }
      default: {
        if (c.last !== null && devMode()) {
          const now = o.getProp(c.key);
          if (c.key === 'color' ? !sameColor(now, c.last) : !same(now, c.last)) throw fail('LGUI-RT-282', `${o.name} 的 ${c.key} 正在补间，但被别的东西改了（比如开始放的 ui/ 动效、齿轮），两边抢同一个属性。`, '同一个控件的同一个属性只交给一方：动效和补间都要动它就套一层，外层归一方、里层归另一方（mvc-spec「代码补间」）。');
        }
        if (c.last === value) return;
        c.last = value;
        o.setProp(c.key, value);
      }
    }
  }

  /** 跳到终值（一直循环的跳回这一轮的起点），算放完。 */
  complete(tween: Tween): void {
    if (tween.ended) return;
    const t = tween.timing;
    let eased: number;
    if (t.repeat < 0) {
      const round = t.duration > 0 ? Math.floor(Math.max(0, tween.elapsed - t.delay) / t.duration) : 0;
      eased = t.ease(t.yoyo && round % 2 === 1 ? 1 : 0);
    } else eased = progress(t, Infinity).eased;
    for (const c of tween.channels) if (!c.object.disposed) this.write(tween, c, valueAt(c, eased));
    this.end(tween, true);
  }
}

const engines = new WeakMap<object, Engine>();

/** 内部用：列表换数据前，这个列表子项上的代码补间跳到终值（子项会重新分配），和 complete 一样（Promise resolve）。 */
export function completeTweensUnder(list: UIObject): void {
  const r = runtime();
  const e = engines.get(r);
  if (!e) return;
  for (const tween of [...e.tweens]) {
    if (tween.kind !== 'code') continue;
    if (tween.channels.some(c => { for (let o: UIObject | null = c.object.parent; o; o = o.parent) if (o === list) return true; return false; })) e.complete(tween);
  }
}

/** 当前运行时的引擎。 */
export function engine(): Engine {
  const r = runtime();
  let found = engines.get(r);
  if (!found) { found = new Engine(); engines.set(r, found); }
  return found;
}

/** 重建时带到新组件上的补间：路径和每一项。 */
interface Moving {
  tween: Tween;
  steps: Step[];
}

/** 一个 View / PartView 的补间：被盖住时暂停，露出来接着走，关闭时全部停掉、碰过的属性还原；重建时正在走的接到新组件上。 */
export class TweenGroup {
  readonly tweens = new Set<Tween>();
  /** 这个界面的补间碰过的控件（关闭时还原）。 */
  readonly touched = new Set<UIObject>();
  /** 现在绑着的组件（目标必须在它里面）。 */
  root: UIComponent | null = null;
  paused = false;

  get size(): number { return this.tweens.size; }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  /** 停掉 stopTweens 管的补间（代码放的），targets 不给是全部；complete 时跳到终值并 resolve。 */
  stop(targets: readonly UIObject[] | null, complete: boolean): void {
    const e = engine();
    for (const tween of [...this.tweens]) {
      if (tween.kind !== 'code') continue;
      if (targets && !tween.channels.some(c => targets.includes(c.object))) continue;
      if (complete) e.complete(tween); else e.end(tween, false);
    }
  }

  /** 关闭：全部停掉（不 resolve），碰过的属性还原成 ui/ 里的值（界面可能被缓存，下次打开要是原样）。 */
  dispose(): void {
    const e = engine();
    for (const tween of [...this.tweens]) e.end(tween, false);
    for (const object of this.touched) {
      const origins = e.origins.get(object);
      // 位置、尺寸还原成关联现在算出来的原位，不写回旧的。
      if (origins && !object.disposed) for (const key of LAYOUT) if (origins.has(key)) e.follow(object, key);
      e.origins.delete(object);
      e.written.delete(object);
      if (!origins || object.disposed) continue;
      for (const [key, value] of origins) {
        if (key === 'chars') showAll(object);
        else if (key === 'press') (object as UIButton).pressScale = value;
        else if (key !== 'roll' && object.getProp(key) !== value) object.setProp(key, value);
      }
    }
    this.touched.clear();
    this.root = null;
  }

  /** 重建前：记下正在走的代码补间的路径，从旧组件上摘下来（旧组件马上销毁）。按下效果、roll 不带过去（绑定会重新接上）。 */
  capture(): Moving[] {
    const e = engine();
    const moving: Moving[] = [];
    const root = this.root;
    for (const tween of [...this.tweens]) {
      const object = tween.channels[0]?.object;
      const steps = root && object && tween.kind === 'code' ? pathOf(root, object) : null;
      if (!steps) { e.end(tween, false); continue; }
      e.detach(tween);
      moving.push({tween, steps});
    }
    for (const object of this.touched) { e.origins.delete(object); e.written.delete(object); }
    this.touched.clear();
    return moving;
  }

  /** 摘下来以后没接到新组件上的补间（新版里没有这个部件、界面关了）：真正结束，不 resolve。 */
  drop(moving: readonly Moving[]): void {
    for (const {tween} of moving) tween.ended = true;
  }

  /** 重建后：按路径在新组件上找到目标，接着走（进度不变；dx、dy 是偏移，换到另一个方向的版本上也对得上）。找不到报 LGUI-RT-281。 */
  reattach(root: UIComponent, moving: readonly Moving[], where: string): void {
    const e = engine();
    let failure: LgRuntimeError | null = null;
    for (const {tween, steps} of moving) {
      const object = follow(root, steps);
      if (!object) {
        tween.ended = true; // 已经从引擎里摘下来了：不再走，不 resolve
        failure ??= fail('LGUI-RT-281', `${where} 重建后按路径 ${describePath(steps)} 找不到补间的目标，补间停掉。`, '横版、竖版（和各语言的版本）里控件名要一致；补间的目标写成 this.ui.<控件>。');
        continue;
      }
      for (const c of tween.channels) { c.object = object; c.last = null; e.origin(object, c.key, this); }
      e.add(tween);
      // 还在 delay 里：起点照样马上生效；否则按现在的进度写一次，不等下一帧。
      if (tween.elapsed < tween.timing.delay) for (const c of tween.channels) e.write(tween, c, valueAt(c, 0));
      else e.step(tween, 0);
    }
    if (failure) throw failure;
  }
}
