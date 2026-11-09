// 多语言：文本表、lgui.t、格式化。文本表是 i18n/<语言>.json，扁平的「键 → 文字」；
// 要按数量变化的文字写成按复数形式分开的对象：{"one": "…", "other": "…"}，用参数 count 选。
import {LgRuntimeError} from '../core/index';
import {hasRuntime} from './runtime';
import {fault} from './log';
import {compactUnits} from './fixed-text';

/** 一种语言的文本表。 */
export type TextTable = Record<string, string | Partial<Record<PluralForm, string>>>;
/** 复数形式（和 Intl.PluralRules 的名字一致）。 */
export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

interface I18nState {
  language: string;
  tables: Record<string, TextTable>;
}

let state: I18nState = {language: 'zh-CN', tables: {}};

/** 内部用：设置全部文本表和当前语言（启动时调用）。 */
export function setTexts(tables: Record<string, TextTable>, language: string): void {
  state = {language, tables};
}

/** 内部用：切换当前语言（S2-F3 的 lgui.setLanguage 在这之上重建界面）。 */
export function setCurrentLanguage(language: string): void { state = {...state, language}; }

/** 当前语言。 */
export function currentLanguage(): string { return state.language; }

/** 启动时选语言：系统语言里第一个工程支持的；都不支持就用默认语言。 */
export function pickLanguage(system: readonly string[], supported: readonly string[], fallback: string): string {
  for (const lang of system) {
    if (supported.includes(lang)) return lang;
    const base = lang.split('-')[0];
    const match = supported.find(s => s === base || s.split('-')[0] === base);
    if (match) return match;
  }
  return fallback;
}

// 没有 Intl.PluralRules 时的内置规则：中文、日文、韩文不分单复数，其余按英文（1 和其他）。
function pluralForm(language: string, count: number): PluralForm {
  const Rules = (globalThis as {Intl?: {PluralRules?: new (lang: string) => {select(n: number): string}}}).Intl?.PluralRules;
  if (Rules) return new Rules(language).select(count) as PluralForm;
  if (/^(zh|ja|ko)\b/.test(language)) return 'other';
  return count === 1 ? 'one' : 'other';
}

/** 取文本，占位符写成 {count}。找不到键是写错了（LGUI-RT-090）：开发和测试里抛错；正式构建里记一条 error（同一个键只记一次），显示键名。 */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const table = state.tables[state.language] ?? {};
  let entry = table[key];
  if (entry === undefined) {
    if (!hasRuntime()) return key; // 框架没启动（纯 Model 单测）：还没有文本表，只返回键名
    fault(new LgRuntimeError('LGUI-RT-090', `文本表 i18n/${state.language}.json 里没有键 ${key}。`, '在每种语言的文本表里加上它（lgui check 会列出缺的键）。'), {key, language: state.language}, `${state.language}:${key}`);
    return key;
  }
  if (typeof entry !== 'string') {
    const count = Number(params.count ?? 0);
    entry = entry[pluralForm(state.language, count)] ?? entry.other ?? '';
  }
  return entry.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

type IntlLike = {
  NumberFormat?: new (lang: string, options?: Record<string, unknown>) => {format(n: number): string};
  DateTimeFormat?: new (lang: string, options?: Record<string, unknown>) => {format(d: Date): string};
};
const intl = (): IntlLike | undefined => (globalThis as {Intl?: IntlLike}).Intl;

const groups = (n: number): string => {
  const [int, frac] = Math.abs(n).toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + grouped + (frac ? '.' + frac : '');
};
const pad = (n: number): string => String(n).padStart(2, '0');

// 数字缩写的规则（三端都用这一套，不用 Intl：各浏览器、Unity 的脚本环境的 Intl 不一样，同一个数要各端显示一样）：
// 单位见 fixed-text.ts 的 compactUnits（生成字体子集时要收这些字），最多一位小数。
const oneDecimal = (n: number): number => Math.round(n * 10) / 10;
function compact(value: number, language: string): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const units = compactUnits(language);
  let index = units.findIndex(([size]) => abs >= size);
  if (index < 0) {
    // 不到最小的单位：四舍五入后够到了就进位（999.95 → 1K，中文 9999.95 → 1万），否则原样（中文 9999、英文 999）。
    const rounded = oneDecimal(abs);
    if (rounded < units[units.length - 1][0]) return sign + String(rounded);
    index = units.length - 1;
  }
  let [size, suffix] = units[index];
  let shown = oneDecimal(abs / size);
  // 进位到上一个单位：999950 → 1M，不写成 1000K。
  if (index > 0 && shown * size >= units[index - 1][0]) { [size, suffix] = units[index - 1]; shown = oneDecimal(abs / size); }
  return sign + String(shown) + suffix;
}

// 时长：向上取整到秒，负数当 0。clock 是 05:09，满 1 小时是 1:02:03；units 取最大的两个单位（第二个是 0 就不写），
// 单位的写法是框架文本键 lgui.time.day / hour / minute / second（和 lgui.back 一样放在每种语言的文本表里），三端一样，不用 Intl。
const TIME_UNITS: [number, string][] = [[86400, 'lgui.time.day'], [3600, 'lgui.time.hour'], [60, 'lgui.time.minute'], [1, 'lgui.time.second']];
function duration(ms: number, style: 'clock' | 'units'): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  if (style === 'clock') {
    const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  const first = TIME_UNITS.findIndex(([size]) => total >= size);
  const parts: string[] = [];
  if (first < 0) parts.push(t('lgui.time.second', {n: 0}));
  else {
    const [size, key] = TIME_UNITS[first];
    parts.push(t(key, {n: Math.floor(total / size)}));
    const next = TIME_UNITS[first + 1];
    const rest = next ? Math.floor(total % size / next[0]) : 0;
    if (next && rest > 0) parts.push(t(next[1], {n: rest}));
  }
  // 中文、日文、韩文连着写（1天2小时），其余用空格隔开（1d 2h）。
  return parts.join(/^(zh|ja|ko)\b/i.test(state.language) ? '' : ' ');
}

/** 按当前语言格式化数字、数字缩写、日期、货币。数字、日期、货币有 Intl 时用它，没有时用内置实现（千分位、固定的日期格式）；数字缩写三端都用内置规则。 */
export const format = {
  /** 数字，带千分位。 */
  number(value: number): string {
    const NumberFormat = intl()?.NumberFormat;
    return NumberFormat ? new NumberFormat(state.language).format(value) : groups(value);
  },
  /** 日期（年-月-日 时:分）。参数是毫秒时间戳或 Date。 */
  date(value: number | Date): string {
    const d = typeof value === 'number' ? new Date(value) : value;
    const DateTimeFormat = intl()?.DateTimeFormat;
    if (DateTimeFormat) return new DateTimeFormat(state.language, {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}).format(d);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
  /** 数字缩写，按当前语言：中文 1.6万、1.2亿，英文 16.3K、1.2M；最多一位小数，不到缩写的单位时原样显示（中文 9999、英文 999）。三端都用内置规则，不用 Intl。 */
  compact(value: number): string { return compact(value, state.language); },
  /** 时长（毫秒，向上取整到秒，负数当 0）：'clock'（默认）是 05:09，满 1 小时是 1:02:03；'units' 取最大的两个单位，比如 1天2小时、5分9秒（单位按当前语言的文本键 lgui.time.*）。 */
  duration(ms: number, style: 'clock' | 'units' = 'clock'): string {
    // 写法不认识：开发模式抛出；正式构建记 error 日志，按 clock 显示。
    if (style !== 'clock' && style !== 'units') {
      fault(new LgRuntimeError('LGUI-RT-285', `format.duration 的写法 ${String(style)} 不认识。`, "写 'clock'（05:09）或 'units'（1天2小时）。"), {style}, `duration:${String(style)}`);
      return duration(ms, 'clock');
    }
    return duration(ms, style);
  },
  /** 货币，currency 是 ISO 代码（CNY、USD）。 */
  currency(value: number, currency: string): string {
    const NumberFormat = intl()?.NumberFormat;
    return NumberFormat ? new NumberFormat(state.language, {style: 'currency', currency}).format(value) : `${currency} ${groups(Math.round(value * 100) / 100)}`;
  }
};
