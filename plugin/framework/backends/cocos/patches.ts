// 运行库补丁（cocos 端）。philosophy 同 h5 的 fairygui-patches：运行库行为和 LGUI 的约定冲突、
// 又必须在库外修的，在这里包一层；每处补丁注明实测场景与上游行为。补丁只兜明显是缺陷的路径，
// 能在上游修的回上游修（本仓库的 fairygui fork 或官方包升级）后删除对应补丁。
import * as fgui from 'fairygui-cc';

let installed = false;

/** 补丁 1：GObject.findParent 对已销毁对象返回 null，不抛错。
 * 上游：GObject.findParent 直接读 this._node.parent——对象销毁后 _node 是 null，读 parent 抛
 * TypeError。InputProcessor.clickTest / handleRollOver 在 down/up 之间目标被销毁时会沿链调它
 * （关闭中的对话框、重渲染的列表项），整个触摸流跟着断（T014 example 实测、T008c stack-keys 阻塞验收）。
 * 上游 while (obj) 的循环条件本来就接受 null，返回 null 让链正常终止。 */
export function installFindParentGuard(): void {
  if (installed) return;
  installed = true;
  const proto = fgui.GObject.prototype as {findParent?: (...args: unknown[]) => unknown};
  const original = proto.findParent;
  if (typeof original !== 'function') throw new Error('[lgui] fairygui-cc 的 GObject.findParent 不存在，补丁不适用（运行库版本不匹配？）');
  proto.findParent = function (...args: unknown[]) {
    try {
      return original.apply(this, args);
    } catch {
      return null;
    }
  };
}
