// 背包的数据和规则（业务规则从旧示例（tag v0.2.0-final 的 examples/inventory/legacy/ts/model.ts）迁过来）。只放数据和规则，不碰界面、服务、平台。
import { lgui } from 'lgui';
import { CATALOG, EQUIPMENT_SLOTS, RARITIES, STAT_NAMES, definition, iconOf, maxStack } from './CatalogModel';
import type { EquipmentSlot, ItemType, Rarity, StatName } from './CatalogModel';

export type Category = 'all' | ItemType;
export type Sort = 'default' | 'name' | 'rarity' | 'price' | 'quantity';
export const SORTS: readonly Sort[] = ['default', 'rarity', 'price', 'quantity', 'name'];
export const CATEGORIES: readonly Category[] = ['all', 'equipment', 'consumable', 'material', 'quest'];

export interface StoredItem { id: string; kind: string; quantity: number }

/** 列表和详情里显示的一项。 */
export interface BagItem {
  id: string;
  kind: string;
  quantity: number;
  icon: string;
  rarity: Rarity;
  type: ItemType;
  price: number;
  isNew: boolean;
  equipped: boolean;
}

export interface BagState {
  coins: number;
  capacity: number;
  items: StoredItem[];
  equipment: Record<EquipmentSlot, StoredItem | null>;
  newIds: string[];
  selectedId: string | null;
  category: Category;
  sort: Sort;
  nextId: number;
}

/** 规则不通过时的原因（Controller 用它取提示文字 bag.error.<code>）。 */
export type BagError = 'notFound' | 'notConsumable' | 'notEquipment' | 'questItem' | 'bagFull' | 'slotEmpty' | 'badQuantity' | 'notEnoughCoins' | 'invalidSave';
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: BagError };

const emptyEquipment = (): Record<EquipmentSlot, StoredItem | null> =>
  Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, null])) as Record<EquipmentSlot, StoredItem | null>;

/** 新存档：每种道具一份（和旧示例一样），再多一把剑、一枚戒指。 */
export function initialState(): BagState {
  const items: StoredItem[] = CATALOG.map(item => ({
    id: `${item.kind}-1`, kind: item.kind,
    quantity: item.type === 'equipment' ? 1 : item.type === 'quest' ? 2 : item.type === 'consumable' ? 5 : 12,
  }));
  items.push({ id: 'sword-2', kind: 'sword', quantity: 1 }, { id: 'ring-2', kind: 'ring', quantity: 1 });
  return { coins: 12480, capacity: 30, items, equipment: emptyEquipment(), newIds: [], selectedId: 'sword-1', category: 'all', sort: 'default', nextId: 1 };
}

const expand = (s: BagState, item: StoredItem, equipped: boolean): BagItem => {
  const def = definition(item.kind);
  return { id: item.id, kind: item.kind, quantity: item.quantity, icon: iconOf(item.kind), rarity: def.rarity, type: def.type, price: def.price, isNew: s.newIds.includes(item.id), equipped };
};

// ---- 给界面读的（配合 pick 用）----

/** 当前分类、排序下的道具。 */
export function visibleItems(s: BagState): BagItem[] {
  const list = s.items.map(item => expand(s, item, false)).filter(item => s.category === 'all' || item.type === s.category);
  const order = (a: BagItem, b: BagItem): number => {
    switch (s.sort) {
      case 'rarity': return RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity);
      case 'price': return b.price - a.price;
      case 'quantity': return b.quantity - a.quantity;
      case 'name': return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
      default: return 0;
    }
  };
  return list.sort((a, b) => order(a, b) || definition(a.kind).iconIndex - definition(b.kind).iconIndex || (a.id < b.id ? -1 : 1));
}

/** 选中的道具（背包里或已装备的），没有就是 null。 */
export function selectedItem(s: BagState): BagItem | null {
  const inBag = s.items.find(item => item.id === s.selectedId);
  if (inBag) return expand(s, inBag, false);
  const worn = EQUIPMENT_SLOTS.map(slot => s.equipment[slot]).find(item => item?.id === s.selectedId);
  return worn ? expand(s, worn, true) : null;
}

/** 某个装备槽能换上的装备。 */
export function itemsForSlot(s: BagState, slot: EquipmentSlot): BagItem[] {
  return s.items.filter(item => definition(item.kind).slot === slot).map(item => expand(s, item, false));
}

export const equippedIn = (s: BagState, slot: EquipmentSlot): BagItem | null => {
  const item = s.equipment[slot];
  return item ? expand(s, item, true) : null;
};

/** 属性：名字和显示的数值，比如 { name: 'attack', value: '+48' }；暴击带 %，耐久不带 +。名字的文字是 stat.<名字>。 */
export function statLines(kind: string): { name: StatName; value: string }[] {
  const stats = definition(kind).stats;
  return STAT_NAMES.filter(name => stats[name] !== undefined).map(name => {
    const n = stats[name] ?? 0;
    return { name, value: name === 'durability' ? String(n) : `+${n}${name === 'crit' ? '%' : ''}` };
  });
}

// ---- 规则 ----

export const bagModel = lgui.Model(initialState(), (set, get) => {
  const find = (id: string): StoredItem | undefined => get().items.find(item => item.id === id);
  /** 减少一个格子的数量，减到 0 就移走。 */
  const take = (s: BagState, id: string, quantity: number): Partial<BagState> => {
    const items = s.items.flatMap(item => item.id !== id ? [item] : item.quantity > quantity ? [{ ...item, quantity: item.quantity - quantity }] : []);
    const gone = !items.some(item => item.id === id);
    return { items, selectedId: gone && s.selectedId === id ? null : s.selectedId, newIds: gone ? s.newIds.filter(x => x !== id) : s.newIds };
  };
  return {
    select(id: string | null) {
      const s = get();
      set({ selectedId: id, newIds: s.newIds.filter(x => x !== id) });
    },
    setCategory(category: Category) { set({ category }); },
    nextSort() {
      const sort = SORTS[(SORTS.indexOf(get().sort) + 1) % SORTS.length];
      set({ sort });
    },
    use(id: string): Result<{ kind: string }> {
      const item = find(id);
      if (!item) return { ok: false, error: 'notFound' };
      if (definition(item.kind).type !== 'consumable') return { ok: false, error: 'notConsumable' };
      set(take(get(), id, 1));
      return { ok: true, kind: item.kind };
    },
    equip(id: string): Result<{ kind: string; slot: EquipmentSlot }> {
      const s = get();
      const item = find(id);
      if (!item) return { ok: false, error: 'notFound' };
      const slot = definition(item.kind).slot;
      if (!slot) return { ok: false, error: 'notEquipment' };
      const previous = s.equipment[slot];
      const items = s.items.filter(x => x.id !== id).concat(previous ? [previous] : []);
      set({ items, equipment: { ...s.equipment, [slot]: item }, selectedId: id });
      return { ok: true, kind: item.kind, slot };
    },
    unequip(slot: EquipmentSlot): Result {
      const s = get();
      const item = s.equipment[slot];
      if (!item) return { ok: false, error: 'slotEmpty' };
      if (s.items.length >= s.capacity) return { ok: false, error: 'bagFull' };
      set({ items: [...s.items, item], equipment: { ...s.equipment, [slot]: null } });
      return { ok: true };
    },
    /** 出售前检查（请求成功后再调用 sold 改数据）。 */
    canSell(id: string, quantity: number): Result {
      const item = find(id);
      if (!item) return { ok: false, error: 'notFound' };
      if (definition(item.kind).type === 'quest') return { ok: false, error: 'questItem' };
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > item.quantity) return { ok: false, error: 'badQuantity' };
      return { ok: true };
    },
    sold(id: string, quantity: number, earned: number) {
      const s = get();
      set({ ...take(s, id, quantity), coins: s.coins + earned });
    },
    /** 分解装备：装备没了，得到 1 个赤铁矿。 */
    salvage(id: string): Result {
      const item = find(id);
      if (!item) return { ok: false, error: 'notFound' };
      if (definition(item.kind).type !== 'equipment') return { ok: false, error: 'notEquipment' };
      set(take(get(), id, 1));
      this.add('ore', 1, false);
      return { ok: true };
    },
    /** 放进背包：能叠就叠，叠不下就占新格子。markNew：标成新道具（红点）。 */
    add(kind: string, quantity: number, markNew = true): Result<{ ids: string[] }> {
      let s = get();
      const ids: string[] = [];
      let left = quantity;
      const items = s.items.map(item => {
        if (left === 0 || item.kind !== kind || item.quantity >= maxStack(kind)) return item;
        const added = Math.min(left, maxStack(kind) - item.quantity);
        left -= added;
        ids.push(item.id);
        return { ...item, quantity: item.quantity + added };
      });
      let nextId = s.nextId;
      while (left > 0) {
        if (items.length >= s.capacity) return { ok: false, error: 'bagFull' };
        const added = Math.min(left, maxStack(kind));
        const id = `${kind}-n${nextId++}`;
        items.push({ id, kind, quantity: added });
        ids.push(id);
        left -= added;
      }
      s = get();
      // CC babel loose 把 [...set] 编译成 [].concat(set)（整个 Set 变一个元素）——可迭代展开一律 Array.from（h5 的 esbuild 无此问题，cocos 构建必炸）。
      set({ items, nextId, newIds: markNew ? Array.from(new Set([...s.newIds, ...ids])) : s.newIds });
      return { ok: true, ids };
    },
    spend(coins: number): Result {
      if (get().coins < coins) return { ok: false, error: 'notEnoughCoins' };
      set({ coins: get().coins - coins });
      return { ok: true };
    },
    addCoins(coins: number) { set({ coins: get().coins + coins }); },
    /** 存档（只存规则需要的数据）。 */
    save(): string {
      const { coins, capacity, items, equipment, newIds, selectedId, category, sort, nextId } = get();
      return JSON.stringify({ schemaVersion: 1, coins, capacity, items, equipment, newIds, selectedId, category, sort, nextId });
    },
    /** 读档：格式不对就不改数据，返回 invalidSave。 */
    load(text: string): Result {
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { return { ok: false, error: 'invalidSave' }; }
      const data = raw as Partial<BagState> & { schemaVersion?: number };
      const stored = (x: unknown): x is StoredItem => typeof x === 'object' && x !== null
        && typeof (x as StoredItem).id === 'string' && typeof (x as StoredItem).kind === 'string' && CATALOG.some(c => c.kind === (x as StoredItem).kind)
        && Number.isSafeInteger((x as StoredItem).quantity) && (x as StoredItem).quantity > 0 && (x as StoredItem).quantity <= maxStack((x as StoredItem).kind);
      const valid = data.schemaVersion === 1 && Number.isSafeInteger(data.coins) && (data.coins ?? -1) >= 0
        && Number.isInteger(data.capacity) && Array.isArray(data.items) && data.items.length <= (data.capacity ?? 0) && data.items.every(stored)
        && typeof data.equipment === 'object' && data.equipment !== null && EQUIPMENT_SLOTS.every(slot => data.equipment?.[slot] === null || stored(data.equipment?.[slot]))
        && Array.isArray(data.newIds) && CATEGORIES.includes(data.category as Category) && SORTS.includes(data.sort as Sort) && Number.isInteger(data.nextId);
      if (!valid) return { ok: false, error: 'invalidSave' };
      set({ coins: data.coins, capacity: data.capacity, items: data.items, equipment: data.equipment, newIds: data.newIds, selectedId: data.selectedId ?? null, category: data.category, sort: data.sort, nextId: data.nextId });
      return { ok: true };
    },
    reset() { set(initialState()); },
  };
});
