// 按钮的按下与回弹：ui/ 里写了 downEffect="scale" 的按钮，FairyGUI 原来「一下子缩小」的效果由后端关掉，
// 按下、松开由框架的手势识别报（mvc/input/gestures.ts），这里用同一个补间引擎补缩放（按下 50 毫秒 Quad.Out 缩到 downEffectValue，松开 100 毫秒 Back.Out 弹回）。
// 不用写代码、不用进绑定表（没绑 click 的按钮照样有）；盖住暂停、关闭停掉和代码补间一样。
import type {UIButton, UIComponent, UIList, UIObject} from '../../core/index';
import type {Scope} from '../scope';
import {runtime} from '../runtime';
import type {TweenGroup} from './engine';
import {press} from './index';
import {recognize} from '../input/gestures';

/** 已经接上的按钮（View、PartView、ItemView 各自挂载时都会走一遍组件，接过的不再接）。 */
const attached = new WeakSet<UIObject>();

/** 组件里（含子组件、列表子项）的每个控件。 */
function each(object: UIObject, visit: (o: UIObject) => void): void {
  visit(object);
  if ('numItems' in object && 'itemAt' in object) {
    const list = object as UIList;
    for (let i = 0; i < list.numItems; i++) { const item = list.itemAt(i); if (item) each(item, visit); }
    return;
  }
  if (!('childNames' in object)) return;
  const component = object as UIComponent;
  for (const name of component.childNames()) { const child = component.child(name); if (child) each(child, visit); }
}

/** 挂载组件时调用：找出组件里所有 downEffect="scale" 的按钮，接上按下、松开；解绑时（scope 清理）取消。 */
export function attachPress(component: UIComponent, group: TweenGroup, scope: Scope): void {
  const {input, time} = runtime().backend.platform;
  each(component, object => {
    if (attached.has(object) || !('downEffect' in object)) return;
    const button = object as UIButton;
    if (button.downEffect.type !== 'scale') return;
    attached.add(button);
    // 先写一次原样：后端从此知道按压归框架管（h5 不再按 FairyGUI 的状态一下子缩小）。
    button.pressScale = 1;
    // 按下、松开来自框架的手势识别：手指移出点击的范围（在可滚动列表里按住按钮开始拖动）就算松开，按钮弹回。
    const stop = recognize(button, input, time, {press: down => {
      if (down && !button.enabled) return;
      if (!button.disposed) press(group, button, down);
    }});
    scope.add(() => { stop(); attached.delete(button); });
  });
}
