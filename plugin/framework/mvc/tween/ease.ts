// 缓动：31 个，名字和 ui/ 的 XML 一样（ease="Quad.Out"），算式照搬 FairyGUI 的 EaseManager（Back 冲过头的量 1.70158，Elastic 周期 0.3）。
// 输入是 0–1 的进度，输出是缓动后的进度（Back、Elastic 会超出 0–1）。
import type {Ease} from '../types';

const OVERSHOOT = 1.70158;
const PERIOD = 0.3;
const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;

function bounceOut(t: number): number {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}
const bounceIn = (t: number): number => 1 - bounceOut(1 - t);

// Elastic：振幅 1.70158（不小于 1，和 FairyGUI 一样按它算相位）、周期 0.3（InOut 是 0.45）。
function elastic(period: number): {a: number; s: number} {
  return {a: OVERSHOOT, s: period / TWO_PI * Math.asin(1 / OVERSHOOT)};
}

/** 每个缓动名的算式。 */
export const eases: Record<Ease, (t: number) => number> = {
  'Linear': t => t,
  'Sine.In': t => -Math.cos(t * HALF_PI) + 1,
  'Sine.Out': t => Math.sin(t * HALF_PI),
  'Sine.InOut': t => -0.5 * (Math.cos(Math.PI * t) - 1),
  'Quad.In': t => t * t,
  'Quad.Out': t => -t * (t - 2),
  'Quad.InOut': t => (t *= 2) < 1 ? 0.5 * t * t : -0.5 * ((--t) * (t - 2) - 1),
  'Cubic.In': t => t * t * t,
  'Cubic.Out': t => (t -= 1) * t * t + 1,
  'Cubic.InOut': t => (t *= 2) < 1 ? 0.5 * t * t * t : 0.5 * ((t -= 2) * t * t + 2),
  'Quart.In': t => t * t * t * t,
  'Quart.Out': t => -((t -= 1) * t * t * t - 1),
  'Quart.InOut': t => (t *= 2) < 1 ? 0.5 * t * t * t * t : -0.5 * ((t -= 2) * t * t * t - 2),
  'Quint.In': t => t * t * t * t * t,
  'Quint.Out': t => (t -= 1) * t * t * t * t + 1,
  'Quint.InOut': t => (t *= 2) < 1 ? 0.5 * t * t * t * t * t : 0.5 * ((t -= 2) * t * t * t * t + 2),
  'Expo.In': t => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  'Expo.Out': t => t === 1 ? 1 : -Math.pow(2, -10 * t) + 1,
  'Expo.InOut': t => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return (t *= 2) < 1 ? 0.5 * Math.pow(2, 10 * (t - 1)) : 0.5 * (-Math.pow(2, -10 * --t) + 2);
  },
  'Circ.In': t => -(Math.sqrt(1 - t * t) - 1),
  'Circ.Out': t => Math.sqrt(1 - (t -= 1) * t),
  'Circ.InOut': t => (t *= 2) < 1 ? -0.5 * (Math.sqrt(1 - t * t) - 1) : 0.5 * (Math.sqrt(1 - (t -= 2) * t) + 1),
  'Elastic.In': t => {
    if (t === 0 || t === 1) return t;
    const {a, s} = elastic(PERIOD);
    return -(a * Math.pow(2, 10 * (t -= 1)) * Math.sin((t - s) * TWO_PI / PERIOD));
  },
  'Elastic.Out': t => {
    if (t === 0 || t === 1) return t;
    const {a, s} = elastic(PERIOD);
    return a * Math.pow(2, -10 * t) * Math.sin((t - s) * TWO_PI / PERIOD) + 1;
  },
  'Elastic.InOut': t => {
    if (t === 0) return 0;
    if ((t *= 2) === 2) return 1;
    const period = PERIOD * 1.5;
    const {a, s} = elastic(period);
    if (t < 1) return -0.5 * (a * Math.pow(2, 10 * (t -= 1)) * Math.sin((t - s) * TWO_PI / period));
    return a * Math.pow(2, -10 * (t -= 1)) * Math.sin((t - s) * TWO_PI / period) * 0.5 + 1;
  },
  'Back.In': t => t * t * ((OVERSHOOT + 1) * t - OVERSHOOT),
  'Back.Out': t => (t -= 1) * t * ((OVERSHOOT + 1) * t + OVERSHOOT) + 1,
  'Back.InOut': t => {
    const s = OVERSHOOT * 1.525;
    return (t *= 2) < 1 ? 0.5 * (t * t * ((s + 1) * t - s)) : 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
  },
  'Bounce.In': bounceIn,
  'Bounce.Out': bounceOut,
  'Bounce.InOut': t => t < 0.5 ? bounceIn(t * 2) * 0.5 : bounceOut(t * 2 - 1) * 0.5 + 0.5
};

/** 缓动名对不对（运行时再查一遍：JS 里写错了 TypeScript 查不出来）。 */
export function isEase(name: unknown): name is Ease {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(eases, name);
}
