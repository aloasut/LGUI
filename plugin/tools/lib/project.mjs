// 读取并校验 .lgui/project.json。字段表同步写在 references/project-layout.md。
import fs from 'node:fs';
import path from 'node:path';
import {LgCliError, LgCliErrors} from './errors.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = (value, min = 0) => Number.isInteger(value) && value >= min;
const isSize = value => isObject(value) && isInt(value.width, 1) && isInt(value.height, 1) && Object.keys(value).every(key => key === 'width' || key === 'height');
const isInsets = value => isObject(value) && ['top', 'right', 'bottom', 'left'].every(key => isInt(value[key])) && Object.keys(value).length === 4;
const isVerifySize = value => isObject(value) && typeof value.name === 'string' && /^[a-z][a-zA-Z0-9-]*$/.test(value.name) &&
  isInt(value.width, 1) && isInt(value.height, 1) && (value.safeArea === undefined || isInsets(value.safeArea)) &&
  Object.keys(value).every(key => ['name', 'width', 'height', 'safeArea'].includes(key));
const isKeyMap = value => isObject(value) && Object.values(value).every(map => isObject(map) && Object.values(map).every(action => typeof action === 'string' && action.length > 0));

// 标准验证尺寸：电脑 16:9、超宽屏、手机横屏（带刘海）、平板 4:3、手机竖屏、平板竖屏。lgui verify 对每组再横竖各截一张（同一个画面只截一次）。
export const defaultVerifySizes = [
  {name: 'desktop', width: 1920, height: 1080},
  {name: 'ultrawide', width: 2560, height: 1080},
  {name: 'phone-landscape', width: 844, height: 390, safeArea: {top: 0, right: 47, bottom: 21, left: 47}},
  {name: 'tablet', width: 1024, height: 768},
  {name: 'phone-portrait', width: 390, height: 844, safeArea: {top: 47, right: 0, bottom: 34, left: 0}},
  {name: 'tablet-portrait', width: 768, height: 1024}
];

// 每个字段：类型检查、默认值（undefined 表示必填）、给人看的类型说明。
export const fields = {
  name: {check: value => typeof value === 'string' && value.length > 0, type: '非空字符串'},
  lguiVersion: {check: value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value), type: '版本号，如 0.3.0'},
  designSize: {
    check: value => isObject(value) && isSize(value.landscape) && isSize(value.portrait) && Object.keys(value).length === 2,
    type: '{ landscape: {width,height}, portrait: {width,height} }',
    default: {landscape: {width: 1920, height: 1080}, portrait: {width: 1080, height: 1920}}
  },
  orientation: {check: value => ['both', 'landscape', 'portrait'].includes(value), type: '"both" | "landscape" | "portrait"', default: 'both'},
  verifySizes: {check: value => Array.isArray(value) && value.length > 0 && value.every(isVerifySize), type: '[{ name, width, height, safeArea? }]', default: defaultVerifySizes},
  languages: {check: value => Array.isArray(value) && value.length > 0 && value.every(lang => typeof lang === 'string' && lang.length > 0), type: '语言代码数组', default: ['zh-CN', 'en']},
  defaultLanguage: {check: value => typeof value === 'string' && value.length > 0, type: '语言代码，必须在 languages 里', default: 'zh-CN'},
  keyMap: {check: isKeyMap, type: '{ <平台>: { <按键名>: <动作名> } }', default: {}},
  uiCache: {check: value => isObject(value) && isInt(value.keepClosedViews) && Object.keys(value).length === 1, type: '{ keepClosedViews: 非负整数 }', default: {keepClosedViews: 0}},
  requestErrorToast: {check: value => typeof value === 'boolean', type: '布尔值', default: true},
  requestTimeoutMs: {check: value => isInt(value, 1), type: '正整数（毫秒）', default: 10000},
  placeholder: {check: value => typeof value === 'string' && value.startsWith('ui://'), type: '图片地址，ui:// 开头', default: 'ui://Common/placeholder'},
  sounds: {check: value => isObject(value) && (value.click === null || typeof value.click === 'string') && Object.keys(value).length === 1, type: '{ click: 音效地址 | null }', default: {click: null}},
  defaultFont: {check: value => value === null || (typeof value === 'string' && value.length > 0), type: '字体名 | null', default: null},
  devPort: {check: value => isInt(value, 1) && value <= 65535, type: '端口号 1–65535', default: 4173},
  devWatch: {check: value => Array.isArray(value) && value.every(p => typeof p === 'string' && p.length > 0), type: 'lgui dev 额外监视的路径数组（相对工程根目录，比如 ["../Config"]）', default: []},
  editorPort: {check: value => isInt(value, 1) && value <= 65535, type: '端口号 1–65535', default: 4174},
  backend: {check: value => value === 'h5', type: '"h5"', default: 'h5'},
  unityProject: {check: value => value === null || (typeof value === 'string' && value.length > 0), type: 'Unity 工程路径 | null', default: null},
  cocosProject: {check: value => value === null || (typeof value === 'string' && value.length > 0), type: 'Cocos Creator 工程路径 | null', default: null}
};

// 校验一个已解析的 project.json 对象，补上默认值后返回；有问题一次全部报出（LGUI-CLI-004）。
export function validateProject(raw, file = '.lgui/project.json') {
  const fail = (message, fix) => new LgCliError('LGUI-CLI-004', message, {file, fix});
  if (!isObject(raw)) throw new LgCliErrors([fail('工程配置必须是一个 JSON 对象。', '按 references/project-layout.md 的字段表改写。')]);
  const errors = [];
  for (const key of Object.keys(raw)) {
    if (!(key in fields)) errors.push(fail(`工程配置里有不认识的字段 ${key}。`, `删掉 ${key}；所有字段见 references/project-layout.md。`));
  }
  const project = {};
  for (const [key, field] of Object.entries(fields)) {
    if (raw[key] === undefined) {
      if (field.default === undefined) errors.push(fail(`工程配置缺少必填字段 ${key}。`, `加上 ${key}（${field.type}）。`));
      else project[key] = structuredClone(field.default);
    } else if (!field.check(raw[key])) {
      errors.push(fail(`工程配置的 ${key} 不对：应该是 ${field.type}，现在是 ${JSON.stringify(raw[key])}。`, `把 ${key} 改成 ${field.type}。`));
    } else {
      project[key] = raw[key];
    }
  }
  if (!errors.length && !project.languages.includes(project.defaultLanguage)) {
    errors.push(fail(`defaultLanguage ${project.defaultLanguage} 不在 languages ${JSON.stringify(project.languages)} 里。`, '把 defaultLanguage 改成 languages 里的一种，或者把它加进 languages。'));
  }
  if (errors.length) throw new LgCliErrors(errors);
  return project;
}

// 读取工程根目录下的 .lgui/project.json。报错里的文件写相对工程根目录的路径。
export function readProject(root) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, '.lgui', 'project.json'), 'utf8'));
  } catch (error) {
    throw new LgCliError('LGUI-CLI-004', `读不了工程配置：${error.message.replace(root + path.sep, '')}`, {file: '.lgui/project.json', fix: '确认 .lgui/project.json 存在，并且是合法的 JSON。'});
  }
  return validateProject(raw);
}
