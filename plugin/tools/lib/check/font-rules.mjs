// 项目字体的检查：XML 的 font、富文本的 [font=…] 只能写 ui/fonts/ 里的字体名（LGUI-UI-080）；
// 字体文件、defaultFont、缺字由生成字体子集的同一套代码查（LGUI-CLI-140、141、142），lgui check 也报出来。
import path from 'node:path';
import {finding} from './program.mjs';
import {checkFonts, listFonts} from '../generate/fonts.mjs';

const UBB_FONT = /\[font=([^\]]*)\]/gi;

export async function fontRules({root, project, model, tables}) {
  const out = [];
  const rel = file => path.relative(root, file).split(path.sep).join('/');
  let names = null;
  try {
    names = listFonts(root).map(f => f.name);
  } catch (error) {
    for (const e of error.errors ?? [error]) out.push(finding(e.code, e.message, e.fix, {file: e.file, line: e.line}));
  }
  if (names) {
    const known = names.length ? `ui/fonts/ 里有：${names.join('、')}` : 'ui/fonts/ 里现在没有字体';
    const fix = `字体文件放进 ui/fonts/<名字>.ttf（或 .otf），这里写那个名字（${known}）；用默认字体就删掉这个属性。系统字体名各平台不一样，不能写。`;
    const problem = value => {
      if (value.startsWith('ui://')) return `写成了包里的资源地址 ${value}：项目字体不放在界面包里`;
      return names.includes(value) ? null : `${value} 不是项目字体`;
    };
    for (const pkg of model.packages) {
      for (const component of pkg.components) {
        // 控件和它里面的节点（按钮实例的 <Button>、齿轮等）：行号用控件的
        const visit = (node, owner) => {
          const at = {file: rel(component.file), line: owner.line, col: 1};
          if (typeof node.attrs?.font === 'string' && node.attrs.font) {
            const why = problem(node.attrs.font);
            if (why) out.push(finding('LGUI-UI-080', `组件 ${component.fullName} 的 ${owner.name ?? owner.id} 的 font="${node.attrs.font}"：${why}。`, fix, at));
          }
          for (const value of Object.values(node.attrs ?? {})) {
            for (const [, font] of String(value).matchAll(UBB_FONT)) {
              const why = problem(font);
              if (why) out.push(finding('LGUI-UI-080', `组件 ${component.fullName} 的 ${owner.name ?? owner.id} 的文字里写了 [font=${font}]：${why}。`, fix, at));
            }
          }
          for (const child of node.children ?? []) visit(child, owner);
        };
        for (const child of component.children) visit(child, child);
      }
    }
    for (const [language, table] of Object.entries(tables)) {
      for (const [key, value] of Object.entries(table)) {
        for (const text of typeof value === 'string' ? [value] : Object.values(value ?? {})) {
          for (const [, font] of String(text).matchAll(UBB_FONT)) {
            const why = problem(font);
            if (why) out.push(finding('LGUI-UI-080', `文本表 i18n/${language}.json 的 ${key} 里写了 [font=${font}]：${why}。`, fix, {file: `i18n/${language}.json`}));
          }
        }
      }
    }
  }
  if (!names) return out; // 文件名的问题上面已经报了，checkFonts 会报同样的
  try {
    await checkFonts(root, project, model);
  } catch (error) {
    for (const e of error.errors ?? [error]) out.push(finding(e.code, e.message, e.fix, {file: e.file, line: e.line}));
  }
  return out;
}
