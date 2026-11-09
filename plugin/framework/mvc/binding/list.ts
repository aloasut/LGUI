// 列表：items + item（子项 View）+ key + selected + select。能滚动的列表开虚拟列表，不滚动的按普通列表；用 key 认出同一项，数据变化时保留滚动位置。
import type {UIComponent, UIList} from '../../core/index';
import {LgRuntimeError} from '../../core/index';
import {asActor} from '../actor';
import type {ItemKey} from '../types';
import type {BindContext} from './index';
import {adoptChild, watch} from './index';
import {completeTweensUnder} from '../tween/engine';

/** 列表子项 View 的内部接口（ItemView 实现它）。 */
export interface ItemViewInstance {
  __render(component: UIComponent, data: unknown, isActive: () => boolean, owner: object): void;
  __dispose(): void;
}

type ItemViewConstructor = (new () => ItemViewInstance) & {component?: string};

export function bindList(list: UIList, binding: Record<string, unknown>, ctx: BindContext, key: string): void {
  const ItemClass = binding.item as ItemViewConstructor | undefined;
  if ('items' in binding && !ItemClass) throw new LgRuntimeError('LGUI-RT-064', `${ctx.where} 的列表 ${key} 写了 items，但没写 item（子项用的 ItemView）。`, '加上 item: XxxItemView。');
  const keyOf = binding.key as ((item: unknown) => ItemKey) | undefined;
  let items: readonly unknown[] = [];
  let selectedKey: ItemKey | null = null;
  const views = new Map<UIComponent, ItemViewInstance>();
  const adopted: (() => void)[] = [];
  // 只有能滚动的列表（ui/ 里 overflow="scroll"）才用虚拟列表：FairyGUI 的虚拟列表要有滚动面板，不滚动的列表开了会报错。
  // 不滚动的列表（顶栏几个货币、固定几个页签、7 日签到格子）按普通列表，每一项都创建。各个后端按同一条规则。
  if (list.scrollable && !list.virtual) list.virtual = true;
  list.itemRenderer = (index, component) => {
    if (!ItemClass) return;
    if (ItemClass.component && component.componentName && ItemClass.component !== component.componentName) {
      throw new LgRuntimeError('LGUI-RT-064', `${ctx.where} 的列表 ${key} 的子项是 ${component.componentName}，但 item 写的是 ${ItemClass.name}（${ItemClass.component}）。`, '让 ItemView 的 static component 和列表的 defaultItem 一致。');
    }
    let view = views.get(component);
    if (!view) { view = new ItemClass(); views.set(component, view); adopted.push(adoptChild(ctx.owner, view)); }
    view.__render(component, items[index], ctx.isActive, ctx.owner);
  };
  ctx.scope.add(() => {
    list.itemRenderer = null;
    for (const view of views.values()) view.__dispose();
    views.clear();
    for (const off of adopted.splice(0)) off();
  });
  const indexOf = (k: ItemKey | null): number => k === null ? -1 : items.findIndex((item, i) => (keyOf ? keyOf(item) : i) === k);
  const applySelected = (): void => { list.selectedIndex = indexOf(selectedKey); };
  if ('items' in binding) {
    watch<readonly unknown[]>(binding.items, ctx, value => {
      const position = list.scrollPosition;
      // 子项会重新分配：子项上的代码补间先跳到终值（算放完）。
      completeTweensUnder(list);
      items = value;
      list.numItems = items.length;
      list.scrollPosition = position;
      applySelected();
    });
  }
  if ('selected' in binding) watch<ItemKey | null>(binding.selected, ctx, k => { selectedKey = k; applySelected(); });
  if (binding.select) {
    const select = binding.select as (key: ItemKey) => unknown;
    ctx.scope.add(list.onClickItem(index => {
      if (!ctx.isActive() || index < 0 || index >= items.length) return;
      asActor(ctx.owner, () => select(keyOf ? keyOf(items[index]) : index));
    }));
  }
}
