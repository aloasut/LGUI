// 动效：动效名当绑定表的键。playing 为真就播（按 ui/ 里的播放次数）、为假就停；play 的值每变一次就播一次；done 在一次播放正常放完时调用。
// ui/ 里的自动播放照旧由后端负责。界面被盖住时由 ViewMotion 暂停它里面所有在放的动效，露出来接着放；关闭时停掉框架放的动效（组件销毁时后端会停掉其余的）。
import type {UIComponent, UIList, UIObject, UITransition} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {asActor} from '../actor';
import type {BindContext} from './index';
import {watch} from './index';
import {checkTransition} from '../tween/index';
import {fault} from '../log';

const words = ['playing', 'play', 'done'];

// 列表子项重新渲染时同一个动效要接着放、不从头放，所以这几样记在动效对象上，不记在某一次绑定里。
/** 框架放的（不是自动播放的）。 */
const ours = new WeakSet<UITransition>();
/** 放完时通知谁（最近一次绑定的 done）。 */
const notify = new WeakMap<UITransition, () => void>();
/** 上一次 playing 的值：只在值变了时播或停。 */
const lastPlaying = new WeakMap<UITransition, boolean>();

/** 组件里（含子组件、列表子项）的每个动效。 */
function eachTransition(object: UIObject, visit: (t: UITransition) => void): void {
  if ('numItems' in object) {
    const list = object as UIList;
    for (let i = 0; i < list.numItems; i++) { const item = list.itemAt(i); if (item) eachTransition(item, visit); }
    return;
  }
  if (!('childNames' in object)) return;
  const component = object as UIComponent;
  for (const t of component.allTransitions()) visit(t);
  for (const name of component.childNames()) { const child = component.child(name); if (child) eachTransition(child, visit); }
}

/** 一个界面的动效：被盖住时暂停，露出来时恢复，关闭时停掉。View 各有一份，ItemView、PartView 用它所在的 View 的那份。 */
export class ViewMotion {
  private paused = false;
  /** 这次暂停时停住的动效。 */
  private held = new Set<UITransition>();
  /** 这个界面的绑定表里写过的动效。 */
  private bound = new Set<UITransition>();

  /** 现在是不是暂停着（被盖住）。 */
  get isPaused(): boolean { return this.paused; }

  /** 暂停组件里所有在放的动效。已经暂停时再调用，只补上新组件里的（换版、列表新出现的子项）。 */
  pause(component: UIComponent | null): void {
    this.paused = true;
    if (component) eachTransition(component, t => { if (t.playing && !this.held.has(t)) { t.setPaused(true); this.held.add(t); } });
  }

  /** 恢复暂停时停住的动效。 */
  resume(): void {
    this.paused = false;
    const held = Array.from(this.held);
    this.held.clear();
    for (const t of held) t.setPaused(false);
  }

  /** 绑定表里写了一个动效：记下来，关闭时停掉。 */
  track(t: UITransition): void { this.bound.add(t); }

  /** 绑定开始放一个动效时调用：界面正被盖住就马上停住。 */
  started(t: UITransition): void {
    if (this.paused) { t.setPaused(true); this.held.add(t); }
  }

  /** 界面关闭：停掉绑定表里写的动效，不再通知 done；被盖住时暂停的动效（含自动播放的）也停掉——只清掉不停，
   * 它就一直是「暂停着的在放」，组件进了界面缓存、再打开时不会从头放，永远停在那一帧。记下的状态清掉（缓存里的组件再打开时从头算）。 */
  stop(): void {
    this.paused = false;
    const held = Array.from(this.held);
    this.held.clear();
    for (const t of held) if (t.playing) t.stop();
    for (const t of this.bound) { ours.delete(t); lastPlaying.delete(t); if (t.playing) t.stop(); }
    this.bound.clear();
  }
}

/** 绑定所在界面的 ViewMotion（ctx.owner 是 View 实例）。 */
export function motionOf(owner: object): ViewMotion | null {
  const motion = (owner as {__motion?: unknown}).__motion;
  return motion instanceof ViewMotion ? motion : null;
}

const fail = (code: string, message: string, next: string): never => { throw new LgRuntimeError(code, message, next); };

export function bindTransition(transition: UITransition, key: string, binding: Record<string, unknown>, ctx: BindContext): void {
  for (const word of Object.keys(binding)) {
    if (!words.includes(word)) fail('LGUI-RT-063', `${ctx.where} 的 ${key} 是动效，只能用 playing、play、done，不能用 ${word}。`, '动效只写 playing、play、done。');
  }
  const {autoPlay, times, delay} = transition.settings;
  if ('play' in binding && ('playing' in binding || ctx.item)) {
    fail('LGUI-RT-211', `${ctx.where} 的动效 ${key} ${ctx.item ? '在 ItemView 里写了 play（列表子项会重新渲染、被重复使用，认不出值变没变）' : '同时写了 playing 和 play'}。`, ctx.item ? 'ItemView 里改用 playing: it => …。' : '一直放、按条件停用 playing；每次事件播一遍用 play，二选一。');
  }
  if (binding.done && !('playing' in binding) && !('play' in binding) && !autoPlay) {
    fail('LGUI-RT-210', `${ctx.where} 的动效 ${key} 只写了 done，但它不会自动播放，也没写 playing 或 play，永远不会放完。`, '加上 playing 或 play；或者在 ui/ 里给这个动效勾上自动播放。');
  }
  const motion = motionOf(ctx.owner);
  motion?.track(transition);
  if (binding.done) {
    const done = binding.done as () => unknown;
    const handler = (): void => { asActor(ctx.owner, () => done()); };
    notify.set(transition, handler);
    ctx.scope.add(() => { if (notify.get(transition) === handler) notify.delete(transition); });
  }
  const start = (playTimes: number, wait = 0): void => {
    // 动效改的属性正在被代码补间改：两边抢同一个属性（LGUI-RT-282）。开发模式抛出；正式构建记 error 日志，这次不放（不从 Model.set 抛进 Controller）。
    try {
      checkTransition(transition, ctx.where);
    } catch (error) {
      if (!(error instanceof LgRuntimeError)) throw error;
      fault(error);
      return;
    }
    ours.add(transition);
    transition.play({times: playTimes, delay: wait}, () => { ours.delete(transition); notify.get(transition)?.(); });
    motion?.started(transition);
  };
  if ('playing' in binding) {
    watch<boolean>(binding.playing, ctx, on => {
      if (lastPlaying.get(transition) === on) return;
      lastPlaying.set(transition, on);
      if (on) start(times);
      else if (transition.playing) { ours.delete(transition); transition.stop(); }
    });
  } else if (binding.done && autoPlay && transition.playing && !ours.has(transition)) {
    // 自动播放已经开始了，但后端的自动播放不报放完：从头接过来放（同一帧里，看不出区别），才能通知 done。
    start(times, delay);
  }
  if ('play' in binding) {
    let first = true;
    let last: unknown;
    watch<unknown>(binding.play, ctx, value => {
      if (first) { first = false; last = value; return; } // 打开时的值不播
      if (Object.is(value, last)) return;
      last = value;
      start(1);
    });
  }
}
