// lgui cocos export：把 LGUI 工程的界面产物、框架子集、启动脚本导出成 Cocos Creator 工程的 assets。
// 形态对齐 unity export（--to 目标工程、owned-path 保护、staging 两段式、幂等重导出）；布局按 decisions/003，
// 范围按 decisions/005。目标要求：CC 3.8.x + fairygui-cc@1.2.2（后端 vendor 的官方包运行时依赖）。
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LgCliError} from '../errors.mjs';
import {frameworkDir} from '../paths.mjs';
import {pluginVersion} from '../version.mjs';
import {generateCocos, generateProjectTypes, uiProjectPath} from '../generate/index.mjs';
import {generateTranslations} from '../generate/i18n.mjs';
import {runtimeConfig, readTexts} from '../dev/bundle.mjs';

const error = (code, message, file, fix) => new LgCliError(code, message, {file, fix});
const generatedNotice = '这里是生成物，不要在 Cocos Creator 里改。\n';

function readJson(file, code, message, fix) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (cause) { throw error(code, message + '：' + cause.message, file, fix); }
}

function inside(base, file) {
  const relative = path.relative(base, file);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// 导出目录整目录替换：管理路径不能通过链接重定向到其他用户资源（unity export 同款保护）。
function assertOwnedPath(root, file, kind = 'directory') {
  let current = root;
  const segments = path.relative(root, file).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const info = fs.lstatSync(current, {throwIfNoEntry: false});
    if (!info) break;
    if (info.isSymbolicLink()) {
      throw error('LGUI-CLI-054', 'LGUI 管理路径不能使用文件或目录链接，不会覆盖链接指向的用户资源。', current, '移除管理路径上的链接，使用工程内的实际目录和文件。');
    }
    const expected = index === segments.length - 1 ? kind : 'directory';
    if ((expected === 'file' && !info.isFile()) || (expected === 'directory' && !info.isDirectory())) {
      throw error('LGUI-CLI-054', '导出路径类型不对，应该是' + (expected === 'file' ? '文件' : '目录') + '。', current, '移走同名的错误类型条目，再重新导出；不会覆盖它。');
    }
  }
  let existing = file;
  while (!fs.lstatSync(existing, {throwIfNoEntry: false})) existing = path.dirname(existing);
  let real;
  try { real = fs.realpathSync(existing); }
  catch (cause) { throw error('LGUI-CLI-054', '导出路径无法解析：' + cause.message, file, '修好目录链接，使用工程内可读写的实际目录。'); }
  if (!inside(root, file) || !inside(fs.realpathSync(root), real)) {
    throw error('LGUI-CLI-054', '导出路径通过目录链接逃出了工程，不会写入或删除它。', file, '移除生成物目录的链接，使用工程内的实际目录。');
  }
}

// lgui-ui 目录必须配置成 CC bundle（backend 的 bundleReady 按 bundle 名 `lgui-ui` 加载）。
// bundle 配置写在文件夹 meta 的 userData 里；没有它，构建产物里没有 bundle 脚本入口，运行时加载 404（实机构建实测）。
// uuid 每次随机生成，避免多个导出工程之间撞 uuid。
function writeBundleMeta(uiDir) {
  const meta = {
    ver: '1.2.0',
    importer: 'directory',
    imported: true,
    uuid: crypto.randomUUID(),
    files: [],
    subMetas: {},
    userData: {isBundle: true, bundleName: 'lgui-ui'}
  };
  fs.writeFileSync(path.join(uiDir + '.meta'), JSON.stringify(meta, null, 2) + '\n');
}

// 用户工程 src → assets/app-src：'lgui'/'lgui/ui' 是 LGUI 工程的 esbuild 别名，CC 工程没有 alias，
// 按文件到 app-src 根的深度重写成对 assets/ 的相对路径（testbed/example 的 sync.mjs 同款规则）。
function stageAppSource(root, stage) {
  const target = path.join(stage, 'app-src');
  fs.cpSync(path.join(root, 'src'), target, {recursive: true});
  let rewritten = 0;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      const relFull = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(full, relFull); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const source = fs.readFileSync(full, 'utf8');
      const toAssets = '../'.repeat(relFull.split('/').length);
      const next = source
        .replace(/from 'lgui\/ui'/g, `from '${toAssets}ui-types/index'`)
        .replace(/from 'lgui'/g, `from '${toAssets}lgui-framework/index'`);
      if (next !== source) { fs.writeFileSync(full, next); rewritten++; }
    }
  };
  walk(target, '');
  return {target, rewritten};
}

export async function cocosExport({args, flags, cwd, projectRoot, project}) {
  if (!flags.to || !flags.to.trim() || args.length) {
    throw error('LGUI-CLI-006', '用法：lgui cocos export --to <Cocos Creator 工程路径>，不接受额外位置参数。', undefined, '提供 --to 和已经创建的 Cocos Creator 3.8 工程目录。');
  }
  const target = path.resolve(cwd, flags.to);
  const manifest = path.join(target, 'package.json');
  let pkg;
  try {
    pkg = readJson(manifest, 'LGUI-CLI-053', '读不了 Cocos Creator 工程清单', '先用 Cocos Creator 3.8 创建空工程，再把 --to 指向工程根目录。');
  } catch (cause) {
    throw error('LGUI-CLI-053', '目标不是 Cocos Creator 工程：' + cause.message, manifest, '先用 Cocos Creator 3.8 创建空工程，再把 --to 指向工程根目录。');
  }
  const creator = pkg.creator?.version ?? '';
  if (!/^3\.8\.\d+$/.test(creator)) {
    throw error('LGUI-CLI-053', `目标工程必须使用 Cocos Creator 3.8.x，当前 ${creator || '（未标注）'}。`, manifest, '用 Cocos Creator 3.8 创建或打开该工程后再导出。');
  }
  const fairy = pkg.dependencies?.['fairygui-cc'];
  if (fairy !== '1.2.2') {
    throw error('LGUI-CLI-053', `目标工程缺少 fairygui-cc@1.2.2 依赖（当前 ${fairy ?? '无'}）。`, manifest, '在目标工程里运行 npm install fairygui-cc@1.2.2 后再导出。');
  }

  const template = path.join(frameworkDir, 'backends/cocos/project-template');
  const bootTemplate = path.join(template, 'Boot.ts');
  const sceneTemplate = path.join(template, 'main.scene');
  try { fs.accessSync(bootTemplate); fs.accessSync(sceneTemplate); }
  catch (cause) { throw error('LGUI-CLI-011', '插件缺少 Cocos 工程模板（Boot/场景）：' + cause.message, template, '重新安装完整的 LGUI 插件。'); }

  // 写入面：五个生成物目录整目录替换 + 场景只在缺失时创建。
  const ui = path.join(target, 'assets', 'lgui-ui');
  const framework = path.join(target, 'assets', 'lgui-framework');
  const types = path.join(target, 'assets', 'ui-types');
  const bootDir = path.join(target, 'assets', 'lgui-boot');
  const appDir = path.join(target, 'assets', 'app-src');
  const scene = path.join(target, 'assets', 'main.scene');
  for (const file of [ui, framework, types, bootDir, appDir]) assertOwnedPath(target, file);
  assertOwnedPath(target, scene, 'file');

  // 已装框架版本核对（重导出 = 更新生成物；框架版本跟插件走）。VERSION 在框架子集根目录。
  const versionFile = path.join(framework, 'VERSION');
  if (fs.existsSync(versionFile)) {
    const installed = fs.readFileSync(versionFile, 'utf8').trim();
    if (installed !== pluginVersion()) {
      throw error('LGUI-CLI-003', `Cocos 工程里的 LGUI 框架版本是 ${installed || '未知'}，插件是 ${pluginVersion()}，请先运行 lgui upgrade。`, versionFile, '运行 lgui upgrade 后再导出。');
    }
  }

  // 所有已知前提通过，构建仍只发生在 LGUI 自己的缓存里，全量成功后一次性替换。
  const stage = path.join(projectRoot, '.lgui/build/cocos/export');
  assertOwnedPath(projectRoot, stage);
  fs.rmSync(stage, {recursive: true, force: true});
  fs.mkdirSync(stage, {recursive: true});
  const texts = readTexts(projectRoot, project.languages);
  const stageUi = path.join(stage, 'lgui-ui');
  await generateCocos(uiProjectPath(projectRoot), stageUi);
  const {model, deps} = await generateProjectTypes(projectRoot, {validated: true});
  generateTranslations(projectRoot, model, project.languages, path.join(stageUi, 'i18n'), project.defaultLanguage);
  const stageFramework = path.join(stage, 'lgui-framework');
  fs.cpSync(path.join(frameworkDir, 'index.ts'), path.join(stageFramework, 'index.ts'));
  for (const part of ['env.d.ts', 'core', 'mvc', path.join('backends', 'cocos')]) {
    // project-template 是导出模板（Boot/场景），不是框架源码——混进去会在 CC 编译时报模块解析错误（实机构建实测）。
    fs.cpSync(path.join(frameworkDir, part), path.join(stageFramework, part), {recursive: true, filter: src => !src.includes('project-template')});
  }
  const stageBoot = path.join(stage, 'lgui-boot');
  fs.mkdirSync(stageBoot, {recursive: true});
  fs.copyFileSync(bootTemplate, path.join(stageBoot, 'Boot.ts'));
  const app = stageAppSource(projectRoot, stage);
  fs.writeFileSync(path.join(stageBoot, 'lgui-config.ts'), '// 由 lgui cocos export 生成，不要手改。\n' +
    `export const config = ${JSON.stringify(runtimeConfig(project), null, 2)};\n` +
    `export const deps = ${JSON.stringify(deps, null, 2)};\n` +
    `export const components = ${JSON.stringify(Object.fromEntries(model.packages.map(item => [item.name, item.components.map(child => child.name)])), null, 2)};\n` +
    `export const texts = ${JSON.stringify(texts, null, 2)};\n`);
  fs.writeFileSync(path.join(stageFramework, 'VERSION'), pluginVersion());
  for (const directory of [stageUi, stageFramework, stageBoot, app.target]) {
    fs.writeFileSync(path.join(directory, 'README.txt'), generatedNotice);
  }

  // ui-types 直接来自 generateProjectTypes 的产物目录（.lgui/build/types）。
  const stageTypes = path.join(projectRoot, '.lgui', 'build', 'types');
  if (!fs.existsSync(stageTypes)) throw error('LGUI-CLI-011', '类型产物缺失（.lgui/build/types）。', stageTypes, '重新导出；仍缺失就重新安装完整的 LGUI 插件。');
  for (const [from, to] of [[stageUi, ui], [stageFramework, framework], [stageTypes, types], [stageBoot, bootDir], [app.target, appDir]]) {
    assertOwnedPath(target, to);
    fs.rmSync(to, {recursive: true, force: true});
    fs.cpSync(from, to, {recursive: true});
  }
  writeBundleMeta(ui);
  const sceneCreated = !fs.existsSync(scene);
  if (sceneCreated) fs.copyFileSync(sceneTemplate, scene);
  const configFile = path.join(projectRoot, '.lgui/project.json');
  const raw = readJson(configFile, 'LGUI-CLI-003', '工程配置读不了', '用 lgui init 生成的工程配置，不要手改结构。');
  raw.cocosProject = path.relative(projectRoot, target).split(path.sep).join('/') || '.';
  fs.writeFileSync(configFile, JSON.stringify(raw, null, 2) + '\n');
  return {
    data: {cocosProject: target, ui, bundleMeta: ui + '.meta', framework, types, boot: path.join(bootDir, 'Boot.ts'), app: appDir, scene, sceneCreated, appFilesRewritten: app.rewritten},
    summary: [
      `已生成 Cocos Creator 界面包、翻译、框架子集和启动脚本：${target}（app-src 重写 ${app.rewritten} 个文件的 lgui 别名）。`,
      sceneCreated ? '已创建启动场景 assets/main.scene（模板场景，缺失才创建；已有场景保持不变）。' : '已有启动场景 assets/main.scene 保持不变。',
      '在 Cocos Creator 里打开工程即可预览；启动入口 assets/lgui-boot/Boot.ts 在第一个场景加载后自动启动。'
    ]
  };
}
