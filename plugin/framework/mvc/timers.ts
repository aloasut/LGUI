// 定时器：after、every、countdown、onUpdate。都跟着界面走：被盖住时暂停，露出来时恢复，关闭时取消。
import type {Scope} from './scope';
import {runtime, wallNow} from './runtime';

interface Timer {
  /** 每帧调用；返回 false 表示结束。 */
  step(deltaMs: number): boolean;
}

export class ViewTimers {
  private timers = new Set<Timer>();
  private stopFrames: (() => void) | null = null;
  private paused = false;
  /** 露出来时马上调用一次（绑定的 tick：被盖住时不重算，露出来显示就要是对的）。 */
  private resumed = new Set<() => void>();

  constructor(private readonly scope: Scope) {}

  /** 当前有几个定时器（给调试快照用）。 */
  get size(): number { return this.timers.size; }

  private add(timer: Timer): () => void {
    if (this.scope.isClosed) return () => {};
    this.timers.add(timer);
    if (!this.stopFrames) {
      const off = runtime().backend.platform.time.onFrame(dt => this.frame(dt));
      this.stopFrames = this.scope.add(() => { off(); this.timers.clear(); this.resumed.clear(); this.stopFrames = null; });
    }
    return () => { this.timers.delete(timer); };
  }

  // 一个定时器出错不耽误同一界面的其他定时器：这一帧都跑完，再把第一个错误抛出去。
  private frame(deltaMs: number): void {
    if (this.paused) return;
    let failure: {error: unknown} | null = null;
    for (const timer of Array.from(this.timers)) {
      try { if (!timer.step(deltaMs)) this.timers.delete(timer); } catch (error) { if (!failure) failure = {error}; }
    }
    if (failure) throw failure.error;
  }

  /** 延时 ms 毫秒执行一次。时间只在界面没被盖住时才走。回调出错也只执行这一次。 */
  after(ms: number, handler: () => void): void {
    let elapsed = 0;
    let fired = false;
    this.add({step: dt => { if (fired) return false; elapsed += dt; if (elapsed < ms) return true; fired = true; handler(); return false; }});
  }

  /** 每隔 ms 毫秒执行一次。一帧里跨过好几个间隔（比如切回前台）只执行一次，不补发。返回取消（框架内部用）。 */
  every(ms: number, handler: () => void): () => void {
    let elapsed = 0;
    return this.add({step: dt => { elapsed += dt; if (elapsed >= ms) { elapsed %= ms; handler(); } return true; }});
  }

  /** 内部用：绑定的 tick——每隔 ms 毫秒调用一次，露出来时马上再调用一次。返回取消。 */
  tick(ms: number, handler: () => void): () => void {
    const stop = this.every(ms, handler);
    this.resumed.add(handler);
    return () => { stop(); this.resumed.delete(handler); };
  }

  /** 倒计时：每次都按「结束时间 − 现在」算。开始时和剩余秒数变化时调用 tick，到点调用 done（出错也只调用这一次）。 */
  countdown(endsAt: number, tick: (leftMs: number) => void, done: () => void): void {
    let shown = -1;
    let finished = false;
    const check = (): boolean => {
      if (finished) return false;
      const left = Math.max(0, endsAt - wallNow());
      const seconds = Math.ceil(left / 1000);
      if (seconds !== shown) { shown = seconds; tick(left); }
      if (left > 0) return true;
      finished = true;
      done();
      return false;
    };
    if (check()) this.add({step: check});
  }

  /** 每帧执行。 */
  onUpdate(handler: (deltaMs: number) => void): void {
    this.add({step: dt => { handler(dt); return true; }});
  }

  /** 界面被盖住时暂停。 */
  pause(): void { this.paused = true; }

  /** 露出来时恢复；倒计时会马上按现在的时间重算一次。 */
  resume(): void {
    this.paused = false;
    this.frame(0);
    for (const handler of [...this.resumed]) handler();
  }
}
