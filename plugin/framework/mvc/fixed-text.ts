// 框架自己显示的固定文字：不在 ui/ 里，也不在 i18n/ 的文本表里。
// 生成项目字体的子集时（tools/lib/generate/fonts.mjs），工程 languages 里每种语言用到的这些字都收进字集，
// 否则这些字会静默换成系统字体。框架新加一处自己显示的文字（比如 format 的新单位），加进 fixedText。
// 这个文件不 import 任何东西：命令行工具在 Node 里直接 import 它。

/** format.compact 的单位：[多大, 单位]，从大到小。中文、日文、韩文按万、亿、万亿（兆、조），其余按千（K）、百万（M）、十亿（B）、万亿（T）。 */
export function compactUnits(language: string): readonly (readonly [number, string])[] {
  if (/^zh-(TW|HK|MO|Hant)/i.test(language)) return [[1e12, '兆'], [1e8, '億'], [1e4, '萬']];
  if (/^zh\b/i.test(language)) return [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']];
  if (/^ja\b/i.test(language)) return [[1e12, '兆'], [1e8, '億'], [1e4, '万']];
  if (/^ko\b/i.test(language)) return [[1e12, '조'], [1e8, '억'], [1e4, '만'], [1e3, '천']];
  return [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
}

/** 汇总点：框架在这种语言下会显示的全部固定文字，[来源, 文字]。format 加了新的固定文字就并进来。 */
export function fixedText(language: string): [string, string][] {
  return [
    ...compactUnits(language).map(([, unit]): [string, string] => ['format.compact', unit])
  ];
}
