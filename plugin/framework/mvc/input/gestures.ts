// 手势识别：后端只上报原始指针事件，点击、双击、长按、拖拽、滑动、双指缩放、悬停都在这里统一识别，网页和 Unity 手感一致。
// 坐标一律是设计尺寸里的坐标。
import type {InputService, PointerInput, TimeService, UIObject} from '../../core/index';
import type {DragGesture, PinchGesture, SwipeGesture} from '../types';

/** 判定阈值（先写成常量，以后再开放配置）。 */
export const thresholds = {
  /** 点击：移动不超过这么多像素。 */
  tapMove: 10,
  /** 点击：按下到抬起不超过这么多毫秒。 */
  tapMs: 300,
  /** 双击：两次点击间隔不超过这么多毫秒。 */
  doubleTapMs: 300,
  /** 拖拽：移动超过这么多像素后开始。 */
  dragStart: 10,
  /** 滑动：抬起时速度超过这么多（像素/毫秒）。 */
  swipeSpeed: 0.5,
  /** 算滑动速度时，只看最后这么多毫秒的移动。 */
  swipeWindowMs: 100
};

/** 要识别哪些手势，以及识别到以后做什么。 */
export interface GestureHandlers {
  /** 点击。 */
  click?: () => void;
  /** 双击。 */
  doubleClick?: () => void;
  /** 长按：按满 ms 毫秒执行 action；按住期间每帧调用 progress（0–1），松手或取消时 progress(0)。 */
  hold?: {ms: number; action: () => void; progress?: (ratio: number) => void};
  /** 拖拽。 */
  drag?: (gesture: DragGesture) => void;
  /** 滑动。 */
  swipe?: (gesture: SwipeGesture) => void;
  /** 双指缩放。 */
  pinch?: (gesture: PinchGesture) => void;
  /** 鼠标移入、移出（触屏没有）。 */
  hover?: (inside: boolean) => void;
  /** 每次按下时调用，参数是指针类型（给输入类型判断用）。 */
  pointer?: (event: PointerInput) => void;
  /** 按下（true）和不再按着（false：松开、取消、移动超过点击的范围开始拖动或滑动、两指缩放）。按钮的按下效果用它。 */
  press?: (down: boolean) => void;
}

interface Track {
  startX: number;
  startY: number;
  startTime: number;
  x: number;
  y: number;
  samples: {x: number; y: number; time: number}[];
}

const distance = (a: {x: number; y: number}, b: {x: number; y: number}): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 在一个控件上识别手势，返回取消函数。 */
export function recognize(object: UIObject, input: InputService, time: TimeService, handlers: GestureHandlers): () => void {
  const tracks = new Map<number, Track>();
  let primary: number | null = null;
  let moved = false;
  let dragging = false;
  let holdDone = false;
  let lastClick = -Infinity;
  let pinchBase = 0;
  let pinching = false;
  let inside = false;
  let lastOwnEvent: PointerInput | null = null;
  let stopHold: (() => void) | null = null;
  let pressing = false;
  const release = (): void => { if (pressing) { pressing = false; handlers.press?.(false); } };

  const endHold = (): void => {
    if (stopHold) { stopHold(); stopHold = null; handlers.hold?.progress?.(0); }
  };

  const reset = (): void => {
    endHold();
    release();
    tracks.clear();
    primary = null;
    moved = dragging = holdDone = pinching = false;
  };

  const pair = (): [Track, Track] | null => {
    const all = Array.from(tracks.values());
    return all.length >= 2 ? [all[0], all[1]] : null;
  };

  const onOwn = (e: PointerInput): void => {
    lastOwnEvent = e;
    if (e.type === 'move' && e.pointerType === 'mouse' && tracks.size === 0) {
      if (!inside) { inside = true; handlers.hover?.(true); }
      return;
    }
    if (e.type === 'down') {
      handlers.pointer?.(e);
      tracks.set(e.pointerId, {startX: e.x, startY: e.y, startTime: e.time, x: e.x, y: e.y, samples: [{x: e.x, y: e.y, time: e.time}]});
      if (primary === null) {
        primary = e.pointerId;
        moved = dragging = holdDone = false;
        if (handlers.press) { pressing = true; handlers.press(true); }
        const hold = handlers.hold;
        if (hold) {
          const start = e.time;
          stopHold = time.onFrame(() => {
            if (moved || pinching) { endHold(); return; }
            const ratio = Math.min(1, (time.now() - start) / hold.ms);
            hold.progress?.(ratio);
            if (ratio >= 1) { holdDone = true; endHold(); hold.action(); }
          });
        }
      } else if (handlers.pinch && tracks.size === 2) {
        const p = pair();
        if (p) { pinchBase = distance(p[0], p[1]) || 1; pinching = true; endHold(); release(); handlers.pinch({phase: 'start', scale: 1}); }
      }
    }
  };

  // 移动、抬起、取消在舞台上监听：手指移出控件以后也要继续跟踪。
  const onStage = (e: PointerInput): void => {
    if (e.type === 'move' && e.pointerType === 'mouse' && tracks.size === 0) {
      if (inside && lastOwnEvent !== e) { inside = false; handlers.hover?.(false); }
      return;
    }
    const track = tracks.get(e.pointerId);
    if (!track || e.type === 'down') return;
    if (e.type === 'cancel') { if (dragging) handlers.drag?.({phase: 'end', x: track.x, y: track.y, dx: track.x - track.startX, dy: track.y - track.startY, cancelled: true}); if (pinching) handlers.pinch?.({phase: 'end', scale: 1}); reset(); return; }
    track.x = e.x;
    track.y = e.y;
    track.samples.push({x: e.x, y: e.y, time: e.time});
    while (track.samples.length > 2 && e.time - track.samples[0].time > thresholds.swipeWindowMs) track.samples.shift();
    if (pinching) {
      const p = pair();
      if (p && e.type === 'move') handlers.pinch?.({phase: 'move', scale: distance(p[0], p[1]) / pinchBase});
      if (e.type === 'up') { handlers.pinch?.({phase: 'end', scale: p ? distance(p[0], p[1]) / pinchBase : 1}); reset(); }
      return;
    }
    if (e.pointerId !== primary) return;
    const dx = e.x - track.startX, dy = e.y - track.startY;
    if (!moved && Math.hypot(dx, dy) > thresholds.tapMove) { moved = true; endHold(); release(); }
    if (e.type === 'move') {
      if (!dragging && handlers.drag && Math.hypot(dx, dy) > thresholds.dragStart) { dragging = true; handlers.drag({phase: 'start', x: e.x, y: e.y, dx, dy}); }
      else if (dragging) handlers.drag?.({phase: 'move', x: e.x, y: e.y, dx, dy});
      return;
    }
    // 抬起
    if (dragging) handlers.drag?.({phase: 'end', x: e.x, y: e.y, dx, dy});
    if (moved && handlers.swipe) {
      const first = track.samples[0];
      const dt = Math.max(1, e.time - first.time);
      const vx = (e.x - first.x) / dt, vy = (e.y - first.y) / dt;
      if (Math.hypot(vx, vy) > thresholds.swipeSpeed) handlers.swipe({dx, dy, vx, vy});
    }
    if (!moved && !holdDone && e.time - track.startTime <= thresholds.tapMs) {
      if (handlers.doubleClick && e.time - lastClick <= thresholds.doubleTapMs) { lastClick = -Infinity; handlers.doubleClick(); }
      else { lastClick = e.time; handlers.click?.(); }
    }
    reset();
  };

  const offOwn = object.onPointer(onOwn);
  const offStage = input.onPointer(onStage);
  return () => { offOwn(); offStage(); endHold(); };
}
