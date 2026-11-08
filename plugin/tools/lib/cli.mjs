// 解析参数，按命令名分发。每条命令的实现放在 commands/ 下，在 registry 里登记。
import {LgCliError} from './errors.mjs';
import {findProjectRoot} from './paths.mjs';
import {readProject} from './project.mjs';
import {assertSameVersion} from './version.mjs';
import {emit, toErrors} from './output.mjs';
import {uiList} from './commands/ui-list.mjs';
import {init} from './commands/init.mjs';
import {dev} from './dev/index.mjs';
import {test} from './commands/test.mjs';
import {i18nExtract} from './commands/i18n-extract.mjs';
import {check} from './commands/check.mjs';
import {verify} from './commands/verify.mjs';
import {doctor} from './commands/doctor.mjs';
import {upgrade} from './commands/upgrade.mjs';
import {artSplit} from './commands/art-split.mjs';
import {artCut} from './commands/art-cut.mjs';
import {newModule, newView} from './commands/new.mjs';
import {editor, editorProps} from './commands/editor.mjs';
import {unityExport} from './commands/unity-export.mjs';
import {cocosExport} from './commands/cocos-export.mjs';

// project：'none' 不需要在工程里；'required' 必须在工程里。
// versionCheck：运行前比对插件和工程的版本（init、doctor、upgrade 不比对）。
// flags：这条命令认识的参数；'string' 后面要跟一个值，'boolean' 是开关。
// run：实现；null 表示还没实现，报 LGUI-CLI-000。
export const registry = [
  {name: 'init', usage: 'init [目录] [--name 名称]', about: '新建工程', project: 'none', versionCheck: false, flags: {name: 'string'}, run: init},
  {name: 'doctor', usage: 'doctor [--paths]', about: '检查环境', project: 'none', versionCheck: false, flags: {paths: 'boolean'}, run: doctor},
  {name: 'dev', usage: 'dev [--port 端口] [--no-open]', about: '打开网页预览，改动后自动刷新', project: 'required', versionCheck: true, flags: {port: 'string', 'no-open': 'boolean'}, run: dev},
  {name: 'editor', usage: 'editor [--no-open]', about: '打开编辑器', project: 'required', versionCheck: true, flags: {'no-open': 'boolean'}, run: editor},
  {name: 'editor props', usage: 'editor props <组件> <控件路径> <属性>=<值> ...', about: '编辑器开着时修改已有控件的属性', project: 'required', versionCheck: true, flags: {}, run: editorProps},
  {name: 'new module', usage: 'new module <名字> [--pattern 模式]', about: '生成一个功能的 Model / View / Controller / 测试骨架', project: 'required', versionCheck: true, flags: {pattern: 'string'}, run: newModule},
  {name: 'new view', usage: 'new view <包>/<组件> --pattern <模式>', about: '按排布模式一次生成横竖两版的界面骨架', project: 'required', versionCheck: true, flags: {pattern: 'string'}, run: newView},
  {name: 'check', usage: 'check', about: '规范检查（包括多语言检查）', project: 'required', versionCheck: true, flags: {}, run: check},
  {name: 'test', usage: 'test [文件或目录...] [--name 名字片段] [--browser]', about: '跑测试：默认用 headless 后端，--browser 在真浏览器里跑', project: 'required', versionCheck: true, flags: {name: 'string', browser: 'boolean'}, run: test},
  {name: 'verify', usage: 'verify [--size 名字] [--view View 名 [--params JSON]] [--lang 语言]', about: '在浏览器里按横竖两种方向的标准尺寸截图验证', project: 'required', versionCheck: true, flags: {size: 'string', view: 'string', params: 'string', lang: 'string'}, run: verify},
  {name: 'ui list', usage: 'ui list', about: '列出 ui/ 里的组件和控件', project: 'required', versionCheck: true, flags: {}, run: uiList},
  {name: 'i18n extract', usage: 'i18n extract', about: '从 ui/ 提取需要翻译的文字', project: 'required', versionCheck: true, flags: {}, run: i18nExtract},
  {name: 'art split', usage: 'art split <大图> --grid 列x行 --size 宽x高 --pkg 包 --names 名字列表或文件', about: '把 AI 生成的网格大图拆成小图，并缩放到指定尺寸', project: 'required', versionCheck: true, flags: {grid: 'string', size: 'string', pkg: 'string', names: 'string'}, run: artSplit},
  {name: 'art cut', usage: 'art cut <整页图> --pkg 包 --names 名字列表或文件 [--size 宽x高] [--scale 比例] [--pad 像素] [--gap 像素] [--speck 像素] [--defringe 像素]', about: '按透明区域把 AI 生成的一页图集拆成小图：统一缩放、去白边、九宫格重拼、出检查图', project: 'required', versionCheck: true, flags: {pkg: 'string', names: 'string', size: 'string', scale: 'string', pad: 'string', gap: 'string', speck: 'string', defringe: 'string'}, run: artCut},
  {name: 'unity export', usage: 'unity export --to <Unity 工程路径>', about: '导出到 Unity', project: 'required', versionCheck: true, flags: {to: 'string'}, run: unityExport},
  {name: 'cocos export', usage: 'cocos export --to <Cocos Creator 工程路径>', about: '导出到 Cocos Creator', project: 'required', versionCheck: true, flags: {to: 'string'}, run: cocosExport},
  {name: 'upgrade', usage: 'upgrade', about: '把插件里的新版框架和 Unity 包复制进工程', project: 'required', versionCheck: false, flags: {}, run: upgrade}
];

const globalFlags = {json: 'boolean', help: 'boolean'};

export function usageText() {
  const width = Math.max(...registry.map(command => command.usage.length));
  return ['用法：lgui <命令> [参数] [--json]（lgui 指 node <插件目录>/tools/lgui.mjs）', '', '命令：',
    ...registry.map(command => `  ${command.usage.padEnd(width)}  ${command.about}`)];
}

function findCommand(argv) {
  const twoWords = argv.length >= 2 ? `${argv[0]} ${argv[1]}` : null;
  const command = registry.find(entry => entry.name === twoWords) ?? registry.find(entry => entry.name === argv[0]);
  return command ? {command, rest: argv.slice(command.name.split(' ').length)} : null;
}

// 把剩下的参数按命令认识的 flags 拆成位置参数和开关。
export function parseArgs(rest, spec, commandName) {
  const all = {...globalFlags, ...spec};
  const args = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) { args.push(token); continue; }
    const [key, inline] = token.slice(2).split(/=(.*)/s, 2);
    const kind = all[key];
    if (!kind) {
      throw new LgCliError('LGUI-CLI-006', `${commandName} 不认识参数 --${key}。`, {fix: `能用的参数：${Object.keys(all).map(name => '--' + name).join('、')}。`});
    }
    if (kind === 'boolean') {
      if (inline !== undefined) throw new LgCliError('LGUI-CLI-006', `--${key} 是开关，不带值。`, {fix: `写成 --${key}。`});
      flags[key] = true;
    } else {
      const value = inline ?? rest[++i];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) {
        throw new LgCliError('LGUI-CLI-006', `--${key} 后面要跟一个值。`, {fix: `写成 --${key} <值>。`});
      }
      flags[key] = value;
    }
  }
  return {args, flags};
}

// 运行一条命令，返回退出码。io 用于测试时替换输出和当前目录。
export async function main(argv, {cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr} = {}) {
  const json = argv.includes('--json');
  const out = {json, stdout, stderr};
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help' || (argv[0] === '--json' && argv.length === 1)) {
    return emit({command: 'help', data: {commands: registry.map(({name, usage, about}) => ({name, usage, about}))}, summary: usageText()}, out);
  }
  const found = findCommand(argv);
  if (!found) {
    const error = new LgCliError('LGUI-CLI-001', `没有这条命令：${argv.filter(arg => !arg.startsWith('--')).slice(0, 2).join(' ')}。`, {
      fix: `全部命令：${registry.map(command => command.name).join('、')}。`
    });
    return emit({command: argv[0], errors: [error], summary: usageText()}, out);
  }
  const {command, rest} = found;
  try {
    const {args, flags} = parseArgs(rest, command.flags, command.name);
    if (flags.help) return emit({command: command.name, data: {usage: command.usage}, summary: [`用法：lgui ${command.usage}`, command.about]}, out);
    let projectRoot = null;
    let project = null;
    if (command.project === 'required') {
      projectRoot = findProjectRoot(cwd);
      project = readProject(projectRoot);
      if (command.versionCheck) assertSameVersion(project);
    }
    if (!command.run) {
      throw new LgCliError('LGUI-CLI-000', `lgui ${command.name} 这条命令还没实现。`, {fix: '这是开发中的功能，换一条已经实现的命令，或者等待新版本。'});
    }
    const result = await command.run({args, flags, cwd, projectRoot, project, json});
    return emit({command: command.name, data: result?.data ?? null, summary: result?.summary ?? [], errors: result?.errors ?? []}, out);
  } catch (thrown) {
    return emit({command: command.name, errors: toErrors(thrown)}, out);
  }
}
