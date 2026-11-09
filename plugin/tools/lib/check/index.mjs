// lgui check：类型检查 + MVC 规范 + UI 规范 + 多语言 + 横竖屏。报错格式：文件:行:列  错误码  说明  → 怎么改。
import {buildProgram, finding, sourceFiles} from './program.mjs';
import {mvcRules, redDotBindings, wordBindings, usedTextKeys, fullScreenViews} from './mvc-rules.mjs';
import {uiRules} from './ui-rules.mjs';
import {i18nRules} from './i18n-rules.mjs';
import {fontRules} from './font-rules.mjs';
import {readUiProject} from '../generate/read.mjs';
import {readUiModel} from '../generate/model.mjs';
import {generateProjectTypes, uiProjectPath} from '../generate/index.mjs';
import {readTable} from '../generate/i18n.mjs';

export async function runCheck(root, project) {
  // OpenFairyGUI 的校验问题也报出来，但不停下：后面的规则能给出更具体的错误码和改法。
  const validation = [];
  try {
    await readUiProject(uiProjectPath(root));
  } catch (error) {
    for (const e of error.errors ?? [error]) validation.push(finding(e.code, e.message, e.fix, {file: e.file, line: e.line}));
  }
  const model = readUiModel(uiProjectPath(root));
  let typesError = null;
  try {
    await generateProjectTypes(root, {validated: true});
  } catch (error) {
    typesError = error; // 控件重名、横竖不一致：下面的 UI 规则会逐条报出来
  }
  void typesError;
  const {ts, program, findings} = buildProgram(root);
  const out = [...validation, ...findings];
  if (program) {
    const files = sourceFiles(root, program);
    out.push(...mvcRules({ts, checker: program.getTypeChecker(), root, files, model}));
    out.push(...uiRules({root, model, languages: project.languages, redDots: redDotBindings({ts, root, files}), texts: wordBindings({ts, root, files}, 'text'), items: wordBindings({ts, root, files}, 'items'), fullScreens: fullScreenViews({ts, root, files}), sounds: project.sounds}));
    const tables = Object.fromEntries(project.languages.map(l => [l, readTable(root, l)]));
    out.push(...i18nRules({root, model, tables, defaultLanguage: project.defaultLanguage, usedKeys: usedTextKeys({ts, root, files})}));
    out.push(...await fontRules({root, project, model, tables}));
  }
  return out;
}
