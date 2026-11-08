// 根节点缩放：保证整个设计区域完整显示，多出来的空间交给关联（与 h5 的 scale.ts 同一策略）。
// cocos 上直接用 GRoot 的 setScale + setSize；fork 自带的 UIContentScaler 是给 GRoot.create() 流程用的，
// 本后端自己挂载根节点，不走它（T007 实测确认没有双缩放）。
import type {Rect} from '../../core/index';

/** 当前的缩放比，指针坐标换算成设计尺寸时用。 */
export const stage = {scale: 1};

/** 屏幕尺寸 + 设计尺寸 → 缩放比和设计尺寸下的可见区域。 */
export function fitDesign(screen: {width: number; height: number}, design: {width: number; height: number}): {scale: number; visible: Rect} {
  const scale = Math.min(screen.width / design.width, screen.height / design.height);
  return {scale, visible: {x: 0, y: 0, width: screen.width / scale, height: screen.height / scale}};
}

/** 设计坐标 → 引擎世界坐标（y 向上）。GRoot 按 vanilla 挂载（世界尺寸、scale 1，screenHeight 传 GRoot.height），
 * 设计区域由内层 stage 缩放并贴在 GRoot 左上角（T007 校准渲染；T008 校准输入——本体被缩放会打偏命中测试）。 */
export function toWorld(x: number, y: number, screenHeight: number): {x: number; y: number} {
  return {x: x * stage.scale, y: screenHeight - y * stage.scale};
}
