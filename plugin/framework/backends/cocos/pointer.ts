// FairyGUI 事件 → 接口层的 PointerInput。不做按对象缓存：运行库的事件对象是池化复用的
// （borrowEvent），同一次派发里舞台和控件各转一次，值相同、语义不变（h5 的去重是 DOM 特有）。
// 运行库的事件不带时间戳，InputProcessor 从引擎输入回调里同步派发，取转换时刻即可。
import type {PointerInput} from '../../core/index';
import {Event} from 'fairygui-cc';

const types: Record<string, PointerInput['type']> = {
  [Event.TOUCH_BEGIN]: 'down',
  [Event.TOUCH_MOVE]: 'move',
  [Event.TOUCH_END]: 'up' // 取消也派发为 TOUCH_END（运行库如此）；手势层按移动量判断，不依赖 cancel
};

/** 最近一次真实 DOM 按下设备的 pointerType（platform 装监听更新）。cocos 上鼠标点击会被引擎
 * 合成成触摸（touchId>=0），按 touchId 分类会把鼠标判成 touch、inputType 对不齐 h5（T008d 实测）——
 * 设备类型以 DOM pointerType 为地面真相，和 h5 同一语义。原生目标 T012 换引擎输入时再接。 */
export const domPointer = {type: 'mouse' as PointerInput['pointerType']};

/** 最近一次真实 DOM 滚轮增量（platform 装监听更新）。运行库的 mouseWheelDelta 是 Math.max(scrollX, scrollY)
 * 合成的，向下滚时 cc 的 scrollY 为负、max 恒得 0，向下滚动量整个丢失（T008c wheel/wheel-delta 用例实测）——
 * 增量以 DOM wheel 事件为地面真相（正 = 向下，和 h5 同一语义），fairy 事件只用来定命中目标。 */
export const domWheel = {deltaX: 0, deltaY: 0};

export function toPointerInput(event: FguiEventOf): PointerInput {
  const type = types[event.type];
  if (!type) throw new Error(`未知的事件类型 ${event.type}`);
  return {
    type,
    pointerId: event.touchId,
    // 运行库的事件只有 touchId；笔在 Web 上按触摸对待（DOM pointerType 'pen' 也归 touch，与 h5 对齐）。
    pointerType: domPointer.type === 'touch' || domPointer.type === 'pen' ? 'touch' : 'mouse',
    x: event.pos.x,
    y: event.pos.y,
    time: performance.now()
  };
}

/** 只在运行库事件对象上用（它的类型随环境变化，这里收窄成我们读的字段）。 */
export interface FguiEventOf {
  readonly type: string;
  readonly pos: {x: number; y: number};
  readonly touchId: number;
  readonly mouseWheelDelta: number;
}
