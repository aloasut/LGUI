// 补丁 9：按钮 downEffect="scale" 的按压只是视觉效果，不改布局。
// 上游在 GButton.constructExtension 里把轴心改成 (0.5, 0.5)，按下时改 GObject 的 scale。轴心一变，按钮被关联拉宽
// （比如宽屏下跟兄弟控件一起变宽）时 FairyGUI 按轴心修正位置，按钮就往左跑；scale 还会被 GearSize 记进当前页、被
// 改 scale 的动效（呼吸）每帧盖掉。
// 改成：轴心保持 XML 里写的；上游的 _downEffect 置 0，按压由 LGUI 接管：框架的补间引擎在按下、松开时带缓动地写
// 按钮的 pressScale（mvc/tween/press.ts），h5 后端把它设成元素的 CSS scale 属性（和 FairyGUI 自己写的 transform 叠加），
// GObject 的尺寸、位置、scale 都不变。
// 框架没接管的按钮（加载器加载出来的组件里的，框架走不到）保持 FairyGUI 原来的效果：setState 按下时一下子设成
// downEffectValue、松开时清掉（也只改 CSS scale），和 Unity 上这类按钮一样。
import * as fgui from '../vendor/fairygui.module.js';
import {after, around, field} from './hook';

const PATCH = 9;

type Button = fgui.GButton & {_downEffect: number; _downEffectValue: number; pivotX: number; pivotY: number; pivotAsAnchor: boolean; setPivot(x: number, y: number, asAnchor?: boolean): void};
export const buttonFields = ['_downEffect', '_downEffectValue'] as const;

/** 我们接管的按压缩放倍数（downEffectValue）。 */
const pressScale = new WeakMap<fgui.GButton, number>();

/** 框架接管了按压的按钮（h5 后端第一次写 pressScale 时登记）。 */
const driven = new WeakSet<fgui.GButton>();
const pressedStates = new Set(['down', 'selectedOver', 'selectedDisabled']);

/** 按钮写了 downEffect="scale" 时是按下时的缩放（downEffectValue），否则是 undefined。 */
export function scaleDownEffect(button: fgui.GButton): number | undefined { return pressScale.get(button); }

/** 内部用：框架接管了这个按钮的按压（带缓动），setState 不再一下子设缩放。 */
export function drivePress(button: fgui.GButton): void { driven.add(button); }

export function installButtonPress(): void {
  const proto = fgui.GButton.prototype;
  around<Button, {x: number; y: number; anchor: boolean}>(PATCH, proto, 'GButton', 'constructExtension',
    button => ({x: button.pivotX, y: button.pivotY, anchor: button.pivotAsAnchor}),
    (button, pivot) => {
      if (field<number>(button, '_downEffect') !== 2) return;
      pressScale.set(button, field<number>(button, '_downEffectValue'));
      Reflect.set(button, '_downEffect', 0);
      button.setPivot(pivot.x, pivot.y, pivot.anchor);
    });
  after<Button>(PATCH, proto, 'GButton', 'setState', (button, args) => {
    const scale = pressScale.get(button);
    if (scale === undefined || driven.has(button)) return;
    button.element.style.scale = pressedStates.has(String(args[0])) ? String(scale) : '';
  });
}
