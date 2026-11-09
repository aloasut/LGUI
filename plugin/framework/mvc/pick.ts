// pick(数据, 取字段, 格式化?)：告诉框架监听哪个数据源、取哪个字段。取出的值没变（Object.is）就不通知。
import type {Picked, Readable} from './types';

/** 内部用：pick 的取值（格式化之前）和格式化函数。 */
const parts = new WeakMap<object, {raw: () => unknown; format: ((value: unknown) => unknown) | null}>();

export function pick<S, T>(source: Readable<S>, select: (state: S) => T): Picked<T>;
export function pick<S, T, U>(source: Readable<S>, select: (state: S) => T, format: (value: T) => U): Picked<U>;
export function pick(source: Readable<unknown>, select: (state: unknown) => unknown, format?: (value: unknown) => unknown): Picked<unknown> {
  const read = (): unknown => {
    const value = select(source.get());
    return format ? format(value) : value;
  };
  const picked = {
    __picked: true as const,
    get: read,
    subscribe(listener: () => void): () => void {
      // 每个订阅各记各的上一个值。只比较 select 取出的值，格式化之前比较，避免格式化函数每次返回新对象。
      let last = select(source.get());
      return source.subscribe(() => {
        const next = select(source.get());
        if (Object.is(next, last)) return;
        last = next;
        listener();
      });
    }
  };
  // 绑定的 roll 要拿到格式化之前的值（滚动中的数字每帧再交给格式化函数）。
  parts.set(picked, {raw: () => select(source.get()), format: format ?? null});
  return picked;
}

/** 内部用：一个 pick 格式化之前的取值和格式化函数；不是 pick 返回 null。 */
export function pickParts(value: unknown): {raw: () => unknown; format: ((value: unknown) => unknown) | null} | null {
  return typeof value === 'object' && value !== null ? parts.get(value) ?? null : null;
}

/** 内部用：一个值是不是 pick 的结果。 */
export function isPicked(value: unknown): value is Picked<unknown> {
  return typeof value === 'object' && value !== null && (value as {__picked?: unknown}).__picked === true;
}
