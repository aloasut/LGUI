// 打字机（chars）：文字本身照旧由绑定表的 text 决定，这里只管露出前几个字。
// 绑定写文字都经过 writeText：有 chars 补间在走时记下全文、只写露出的部分；没有补间在走时文字换了，恢复全部显示。
import type {UIButton, UIObject, UIText} from '../../core/index';

/** 全文（只在「只露出一部分」时记）。 */
const fullTexts = new WeakMap<UIObject, string>();
/** 露出几个字（只在「只露出一部分」时记）。 */
const limits = new WeakMap<UIObject, number>();
/** 现在有 chars 补间在走的控件（引擎登记）。 */
const typing = new WeakSet<UIObject>();

// FairyGUI 的 UBB 标签：整段带上、不拆开，不算字数。
const UBB = /^\[\/?(?:b|i|u|s|color|size|font|url|img|align|sup|sub)(?:=[^\]]*)?\]/i;
// 图片 [img]地址[/img]：整段算一个看得见的单位，不在地址中间截断（没有结束标签的照普通标签处理）。
const IMAGE = /^\[img\][\s\S]*?\[\/img\]/i;

/** 从 i 开始的一个看得见的单位有多长（图片整段，否则一个 Unicode 码位）。 */
function unit(text: string, i: number): number {
  const image = IMAGE.exec(text.slice(i));
  if (image) return image[0].length;
  return (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
}

/** 能不能补 chars：文字、富文本、输入框，按钮、标签（标题）。 */
export function hasText(object: UIObject): boolean { return 'title' in object || 'text' in object && 'color' in object; }

function rawText(object: UIObject): string { return 'title' in object ? (object as UIButton).title : (object as UIText).text; }
function setRaw(object: UIObject, text: string): void {
  if ('title' in object) (object as UIButton).title = text;
  else (object as UIText).text = text;
}

/** 看得见的字数（UBB 标签不算；一个字是一个 Unicode 码位，一张 [img] 图片算一个）。 */
export function visibleCount(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length;) {
    const size = IMAGE.test(text.slice(i)) ? 0 : UBB.exec(text.slice(i))?.[0].length ?? 0;
    if (size) { i += size; continue; }
    i += unit(text, i);
    count++;
  }
  return count;
}

/** 前 n 个看得见的字（中间的 UBB 标签整段带上，图片整张带上或整张不带）。 */
export function firstChars(text: string, n: number): string {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const size = IMAGE.test(text.slice(i)) ? 0 : UBB.exec(text.slice(i))?.[0].length ?? 0;
    if (size) { i += size; continue; }
    if (count >= n) break;
    i += unit(text, i);
    count++;
  }
  return text.slice(0, i);
}

/** 全文：只露出一部分时是记下的全文，否则是控件上的文字。 */
export function fullText(object: UIObject): string { return fullTexts.get(object) ?? rawText(object); }

/** 现在露出几个字。 */
export function shownChars(object: UIObject): number { return limits.get(object) ?? visibleCount(fullText(object)); }

/** 补间写 chars：露出前 n 个字。 */
export function showChars(object: UIObject, n: number): void {
  const full = fullText(object);
  fullTexts.set(object, full);
  limits.set(object, n);
  const shown = firstChars(full, n);
  if (rawText(object) !== shown) setRaw(object, shown);
}

/** 恢复全部显示。 */
export function showAll(object: UIObject): void {
  const full = fullTexts.get(object);
  limits.delete(object);
  fullTexts.delete(object);
  if (full !== undefined && rawText(object) !== full) setRaw(object, full);
}

/** 引擎登记、取消「有 chars 补间在走」。 */
export function setTyping(object: UIObject, on: boolean): void { if (on) typing.add(object); else typing.delete(object); }

/** 绑定写文字：有 chars 补间在走时只写露出的部分；只露出一部分、又没有补间在走时恢复全部显示。返回 true 表示已经写好了。 */
export function writeText(object: UIObject, text: string): boolean {
  if (!limits.has(object)) return false;
  if (typing.has(object)) {
    fullTexts.set(object, text);
    const shown = firstChars(text, limits.get(object) ?? 0);
    if (rawText(object) !== shown) setRaw(object, shown);
  } else {
    limits.delete(object);
    fullTexts.delete(object);
    setRaw(object, text);
  }
  return true;
}
