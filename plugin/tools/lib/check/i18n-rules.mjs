// 多语言检查（LGUI-UI-030～032、062、063）：缺失的键、没用到的键、各语言的占位符是否一致、还没翻的、横竖两版的字不一样。
import path from 'node:path';
import {finding} from './program.mjs';
import {extractTexts} from '../generate/i18n.mjs';

// 框架自己用到的文本键。
const FRAMEWORK_KEYS = ['lgui.back', 'lgui.requestFailed', 'lgui.time.day', 'lgui.time.hour', 'lgui.time.minute', 'lgui.time.second'];

const placeholders = value => {
  const texts = typeof value === 'string' ? [value] : Object.values(value ?? {}).filter(v => typeof v === 'string');
  return [...new Set(texts.flatMap(t => [...t.matchAll(/\{(\w+)\}/g)].map(m => m[1])))].sort().join(',');
};

export function i18nRules({root, model, tables, defaultLanguage, usedKeys}) {
  const out = [];
  const entries = extractTexts(model);
  const uiKeys = entries.map(e => e.key);
  const codeKeys = new Map();
  for (const u of usedKeys) if (u.key !== undefined && !codeKeys.has(u.key)) codeKeys.set(u.key, u.loc);
  // 模板字符串拼出来的键：只用来判断「有没有用到」，缺了查不出来。
  const patterns = usedKeys.filter(u => u.pattern).map(u => u.pattern);
  const required = new Set([...uiKeys, ...codeKeys.keys(), ...FRAMEWORK_KEYS]);
  for (const [language, table] of Object.entries(tables)) {
    const file = `i18n/${language}.json`;
    for (const key of required) {
      if (key in table) continue;
      const loc = codeKeys.get(key);
      out.push(finding('LGUI-UI-030', `${file} 里缺少键 ${key}${loc ? `（${loc.file}:${loc.line} 用到了）` : uiKeys.includes(key) ? '（ui/ 里的固定文字）' : '（框架用到）'}。`, `在 ${file} 里加上 ${key}；ui/ 里的固定文字先运行 lgui i18n extract。`, {file, line: 1, col: 1}));
    }
    for (const key of Object.keys(table)) {
      if (!required.has(key) && !patterns.some(p => p.test(key))) out.push(finding('LGUI-UI-031', `${file} 里的键 ${key} 没有用到。`, '确认不要了就删掉。用模板字符串拼的键（lgui.t(`item.${kind}.name`)）算用到了；用变量传进来的键查不出来，可以忽略这条。', {file, line: 1, col: 1, level: 'warning'}));
    }
  }
  const base = tables[defaultLanguage] ?? {};
  for (const [language, table] of Object.entries(tables)) {
    if (language === defaultLanguage) continue;
    for (const [key, value] of Object.entries(table)) {
      if (!(key in base)) continue;
      const a = placeholders(base[key]), b = placeholders(value);
      if (a !== b) out.push(finding('LGUI-UI-032', `键 ${key} 的占位符不一致：${defaultLanguage} 是 {${a}}，${language} 是 {${b}}。`, '各语言用同样的占位符名字。', {file: `i18n/${language}.json`, line: 1, col: 1}));
    }
  }
  // UI-062 别的语言里和原文一字不差（含字母或文字的才算）：多半是还没翻
  const source = {...Object.fromEntries(entries.map(e => [e.key, e.text])), ...base};
  const hasWords = value => (typeof value === 'string' ? [value] : Object.values(value ?? {})).some(t => typeof t === 'string' && /\p{L}/u.test(t.replace(/\{\w+\}/g, '')));
  for (const [language, table] of Object.entries(tables)) {
    if (language === defaultLanguage) continue;
    for (const [key, value] of Object.entries(table)) {
      if (key in source && JSON.stringify(value) === JSON.stringify(source[key]) && hasWords(value)) out.push(finding('LGUI-UI-062', `i18n/${language}.json 的 ${key} 和 ${defaultLanguage} 的原文一字不差，还没翻。`, `翻成 ${language}；确实不用翻（比如专有名词）可以忽略这条。`, {file: `i18n/${language}.json`, line: 1, col: 1, level: 'warning'}));
    }
  }
  // UI-063 横竖两版的固定文字不一样：翻译只认横版的字，默认语言下两版却各显示各的
  for (const e of entries.filter(x => x.portrait)) {
    out.push(finding('LGUI-UI-063', `${e.key} 横竖两版的固定文字不一样：横版「${e.portrait.landscapeText}」，竖版「${e.portrait.text}」。翻译只按横版的字，换了语言竖版也显示横版的翻译。`, '两版写成一样的字；两版确实要说不一样的话，改用绑定表 + lgui.t。', {file: path.relative(root, e.portrait.file).split(path.sep).join('/'), line: 1, col: 1, level: 'warning'}));
  }
  return out;
}
