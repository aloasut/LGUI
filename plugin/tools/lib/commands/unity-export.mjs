// lgui unity export：先核对本地 Unity/PuerTS，再暂存构建，最后写入 Unity 的生成物目录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {LgCliError} from '../errors.mjs';
import {frameworkDir} from '../paths.mjs';
import {pluginVersion} from '../version.mjs';
import {esbuild} from '../vendor.mjs';
import {generateUnity, generateProjectTypes, uiProjectPath} from '../generate/index.mjs';
import {generateTranslations} from '../generate/i18n.mjs';
import {fontNames, generateFonts} from '../generate/fonts.mjs';
import {runtimeConfig, readTexts, bundleErrors, webBuildOptions} from '../dev/bundle.mjs';
import {readUnityPackage, writeUnityPackage} from '../unitypackage.mjs';

const originalHash = '318425f7f5eb857b5fc1f664e77b68ff569a99a62641c02ae4819261b0f03aaf';
const patchedHash = '3e3b479159fdd56c94ed08f4a7e756dbbfa36b9b4c714e99a40e5fc8f6ec9b83';
const cppPath = 'Editor/Resources/puerts/xil2cpp/Puerts_il2cpp.cpp.txt';
const packageName = 'com.lumiogames.lgui';
const generatedNotice = '这里是生成物，不要在 Unity 里改。\n';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const codePath = file => JSON.stringify(file.split(path.sep).join('/'));
const error = (code, message, file, fix) => new LgCliError(code, message, {file, fix});
const localPackageFix = '把官方 PuerTS_Core_3.0.3.tar.gz 和 PuerTS_V8_3.0.3.tar.gz 分别解压到 Unity 工程 Packages/com.tencent.puerts.core/ 和 Packages/com.tencent.puerts.v8/，不要使用 Library/PackageCache 或目录链接。';

function readJson(file, code, message, fix) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('包清单必须是 JSON 对象。');
    return value;
  }
  catch (cause) { throw error(code, message + '：' + cause.message, file, fix); }
}

function inside(base, file) {
  const relative = path.relative(base, file);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// 生成物目录会整目录替换：管理路径不能通过链接重定向到其他用户资源。
function assertOwnedPath(root, file, code = 'LGUI-CLI-052', kind = 'directory') {
  let current = root;
  const segments = path.relative(root, file).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const info = fs.lstatSync(current, {throwIfNoEntry: false});
    if (!info) break;
    if (info.isSymbolicLink()) {
      throw error(code, 'LGUI 管理路径不能使用文件或目录链接，不会覆盖链接指向的用户资源。', current, '移除管理路径上的链接，使用工程内的实际目录和文件。');
    }
    const expected = index === segments.length - 1 ? kind : 'directory';
    if ((expected === 'file' && !info.isFile()) || (expected === 'directory' && !info.isDirectory())) {
      throw error(code, '导出路径类型不对，应该是' + (expected === 'file' ? '文件' : '目录') + '。', current, '移走同名的错误类型条目，再重新导出；不会覆盖它。');
    }
  }
  let existing = file;
  while (!fs.lstatSync(existing, {throwIfNoEntry: false})) existing = path.dirname(existing);
  let real;
  try { real = fs.realpathSync(existing); }
  catch (cause) { throw error(code, '导出路径无法解析：' + cause.message, file, '修好目录链接，使用工程内可读写的实际目录。'); }
  if (!inside(root, file) || !inside(fs.realpathSync(root), real)) {
    throw error(code, '导出路径通过目录链接逃出了工程，不会写入或删除它。', file, '移除生成物目录的链接，使用工程内的实际目录。');
  }
}

// TextMesh Pro 的必需资源（TMP Essential Resources）：项目字体在 Unity 上是 TMP 字体，TMP 建字体时要读工程里的 TMP Settings。
// 工程里没有 TMP Settings 时，用 com.unity.ugui 自带的资源包补上（不联网），只写工程里还没有的文件。
const tmpMenuFix = '在 Unity 里点 Window → TextMeshPro → Import TMP Essential Resources 导入一次，再运行 lgui unity export。';

/** 工程 Assets/ 下有没有 TMP Settings.asset（不跟链接）。 */
function hasTmpSettings(target) {
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).some(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.isFile() && entry.name === 'TMP Settings.asset');
  const assets = path.join(target, 'Assets');
  return fs.existsSync(assets) && walk(assets);
}

/** com.unity.ugui 自带资源包可能在的位置，按顺序：工程的包缓存、工程里的本地包、Unity Hub 默认安装位置里这个版本的内置包。 */
export function essentialsCandidates(target, editorVersion, platform = process.platform, home = os.homedir()) {
  const dirs = [];
  const cache = path.join(target, 'Library', 'PackageCache');
  if (fs.existsSync(cache)) for (const name of fs.readdirSync(cache).sort()) if (name === 'com.unity.ugui' || name.startsWith('com.unity.ugui@')) dirs.push(path.join(cache, name));
  dirs.push(path.join(target, 'Packages', 'com.unity.ugui'));
  const builtIn = ['Resources', 'PackageManager', 'BuiltInPackages', 'com.unity.ugui'];
  if (editorVersion) {
    if (platform === 'win32') dirs.push(path.win32.join('C:\\Program Files\\Unity\\Hub\\Editor', editorVersion, 'Editor', 'Data', ...builtIn));
    else if (platform === 'darwin') dirs.push(path.posix.join('/Applications/Unity/Hub/Editor', editorVersion, 'Unity.app', 'Contents', ...builtIn));
    else dirs.push(path.join(home, 'Unity', 'Hub', 'Editor', editorVersion, 'Editor', 'Data', ...builtIn));
  }
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return dirs.map(dir => join(dir, 'Package Resources', 'TMP Essential Resources.unitypackage'));
}

/** 要补就找到资源包并读出来（写盘在后面，所有检查都过了以后）；不用补返回 null。找不到、读不了报 LGUI-CLI-143。 */
function prepareTmpEssentials(target, editorVersion, fonts) {
  if (!fonts.length || hasTmpSettings(target)) return null;
  const candidates = essentialsCandidates(target, editorVersion);
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) throw error('LGUI-CLI-143', '工程用了项目字体（Unity 上是 TextMesh Pro 字体），但 Unity 工程里没有 TMP Settings，也没找到 com.unity.ugui 自带的 TMP Essential Resources 资源包。找过：\n' + candidates.map(c => '  ' + c).join('\n'), path.join(target, 'Assets'), '用 Unity ' + (editorVersion || '6000.6') + ' 打开一次这个工程（让它准备好包），再运行 lgui unity export；或者' + tmpMenuFix);
  let items;
  try { items = readUnityPackage(file); }
  catch (cause) { throw error('LGUI-CLI-143', '读不了 TMP Essential Resources 资源包：' + cause.message, file, tmpMenuFix); }
  if (!items.some(item => item.asset && path.posix.basename(item.pathname) === 'TMP Settings.asset')) throw error('LGUI-CLI-143', 'TMP Essential Resources 资源包里没有 TMP Settings.asset。', file, tmpMenuFix);
  return {file, items};
}

function assertEmbeddedPackage(root, name) {
  const directory = path.join(root, 'Packages', name);
  // 包缓存或工程外的链接即使碰巧是 3.0.3，也不是可持久打补丁的 embedded 包。
  let current = root;
  for (const segment of path.relative(root, directory).split(path.sep)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current, {throwIfNoEntry: false})?.isSymbolicLink()) {
      throw error('LGUI-CLI-051', name + ' 是目录链接，必须使用工程 Packages/ 下的实际本地包。', current, localPackageFix);
    }
  }
  const file = path.join(directory, 'package.json');
  const pkg = readJson(file, 'LGUI-CLI-051', '读不了本地 PuerTS 包 ' + name, localPackageFix);
  if (pkg.name !== name || pkg.version !== '3.0.3') {
    throw error('LGUI-CLI-051', name + ' 必须是官方 3.0.3 本地包，当前名称/版本为 ' + pkg.name + '/' + pkg.version + '。', file, localPackageFix);
  }
  assertOwnedPath(root, directory, 'LGUI-CLI-051');
  return directory;
}

function puertsPatch(core) {
  const file = path.join(core, cppPath);
  assertOwnedPath(core, file, 'LGUI-CLI-051', 'file');
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch (cause) { throw error('LGUI-CLI-051', '读不了 PuerTS 3.0.3 的补丁目标：' + cause.message, file, localPackageFix); }
  const current = digest(bytes);
  if (current === patchedHash) return {file, bytes: null, status: 'already-applied'};
  if (current !== originalHash) {
    throw error('LGUI-CLI-051', 'PuerTS 补丁目标的 SHA256 不属于官方 3.0.3 原文件或已补文件（实际 ' + current + '），不会硬打。', file, '保留自己的修改后，重新解压官方 PuerTS 3.0.3 本地包，再导出。');
  }
  const patchFile = path.join(frameworkDir, 'backends/unity/patches/puerts-3.0.3-unity-6.6-unbox.patch');
  let patch;
  try { patch = fs.readFileSync(patchFile, 'utf8'); }
  catch (cause) { throw error('LGUI-CLI-011', '插件缺少 PuerTS 固定补丁：' + cause.message, patchFile, '重新安装完整的 LGUI 插件。'); }
  const removed = patch.split(/\r?\n/).filter(line => line.startsWith('-') && !line.startsWith('---')).map(line => line.slice(1));
  const added = patch.split(/\r?\n/).filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1));
  let text = bytes.toString('utf8');
  if (removed.length !== 4 || added.length !== 4) throw error('LGUI-CLI-011', '插件里的 PuerTS 补丁不是固定四处修改。', patchFile, '重新安装完整的 LGUI 插件。');
  for (let i = 0; i < removed.length; i++) {
    if (text.split(removed[i]).length !== 2) throw error('LGUI-CLI-011', '固定补丁的目标行不唯一。', patchFile, '重新安装完整的 LGUI 插件。');
    text = text.replace(removed[i], added[i]);
  }
  const patched = Buffer.from(text, 'utf8'); // 保留官方 UTF-8 BOM 和 LF。
  if (digest(patched) !== patchedHash) throw error('LGUI-CLI-011', '固定补丁的结果摘要不符。', patchFile, '重新安装完整的 LGUI 插件。');
  return {file, bytes: patched, status: 'applied'};
}

function bootScene(guid) {
  return '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n' +
    '--- !u!1 &100000\nGameObject:\n  m_ObjectHideFlags: 0\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n  serializedVersion: 6\n  m_Component:\n  - component: {fileID: 100001}\n  - component: {fileID: 100002}\n  m_Layer: 0\n  m_Name: LGUIBoot\n  m_TagString: Untagged\n  m_Icon: {fileID: 0}\n  m_NavMeshLayer: 0\n  m_StaticEditorFlags: 0\n  m_IsActive: 1\n' +
    '--- !u!4 &100001\nTransform:\n  m_ObjectHideFlags: 0\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n  m_GameObject: {fileID: 100000}\n  serializedVersion: 2\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_ConstrainProportionsScale: 0\n  m_Children: []\n  m_Father: {fileID: 0}\n  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}\n' +
    '--- !u!114 &100002\nMonoBehaviour:\n  m_ObjectHideFlags: 0\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n  m_GameObject: {fileID: 100000}\n  m_Enabled: 1\n  m_EditorHideFlags: 0\n  m_Script: {fileID: 11500000, guid: ' + guid + ', type: 3}\n  m_Name: \n  m_EditorClassIdentifier: \n' +
    '--- !u!1660057539 &9223372036854775807\nSceneRoots:\n  m_ObjectHideFlags: 0\n  m_Roots:\n  - {fileID: 100001}\n';
}

function writeBootstrap(root, stage, project, deps, texts) {
  const fw = relative => codePath(path.join(root, '.lgui/framework', relative));
  const entry = path.join(stage, 'boot.ts');
  fs.writeFileSync(entry, '// 由 lgui unity export 生成，不要手改。\n' +
    'import app from ' + codePath(path.join(root, 'src/main.ts')) + ';\n' +
    'import {createUnityBackend} from ' + fw('backends/unity/adapter/index.ts') + ';\n' +
    'import {boot} from ' + fw('mvc/boot.ts') + ';\n' +
    'declare const CS: {LGUI: {Platform: {Log(level: string, message: string): void}}};\n' +
    'const globals = globalThis as unknown as {__lguiStart: () => Promise<void>; __lguiReady?: boolean; __lguiDispose?: () => void};\n' +
    'globals.__lguiStart = async () => {\n  try {\n' +
    '    const backend = createUnityBackend();\n' +
    '    await backend.init({projectName: ' + JSON.stringify(project.name) + ', defaultFont: ' + JSON.stringify(project.defaultFont) + ', fonts: ' + JSON.stringify(fontNames(root)) + ', uiBase: "UI", i18nBase: "UI/i18n"});\n' +
    '    await boot(backend, app, ' + JSON.stringify(runtimeConfig(project)) + ', ' + JSON.stringify(deps) + ', {texts: ' + JSON.stringify(texts) + '});\n' +
    '    globals.__lguiReady = true;\n' +
    '  } catch (error) {\n    const e = error as {code?: string; message?: string};\n' +
    '    CS.LGUI.Platform.Log("error", (e.code ?? "LGUI-RT-160") + " Unity start failed: " + String(e.message ?? error) + " → Run lgui unity export and check the generated resources.");\n' +
    '    globals.__lguiDispose?.();\n  }\n};\n');
  return entry;
}

export async function unityExport({args, flags, cwd, projectRoot, project}) {
  if (!flags.to || !flags.to.trim() || args.length) {
    throw error('LGUI-CLI-006', '用法：lgui unity export --to <Unity 工程路径>，不接受额外位置参数。', undefined, '提供 --to 和已经创建的 Unity 6000.6 工程目录。');
  }
  const target = path.resolve(cwd, flags.to);
  const versionFile = path.join(target, 'ProjectSettings/ProjectVersion.txt');
  let version;
  try { version = fs.readFileSync(versionFile, 'utf8'); }
  catch (cause) { throw error('LGUI-CLI-052', '读不了 Unity 工程版本：' + cause.message, versionFile, '先用 Unity 6000.6 创建空工程，再把 --to 指向工程根目录。'); }
  if (!/^m_EditorVersion:[ \t]*6000\.6\.\d+[a-z0-9]*[ \t]*\r?$/m.test(version)) {
    throw error('LGUI-CLI-052', '目标工程必须使用 Unity 6000.6.x，当前 ' + version.trim() + '。', versionFile, '用 Unity 6000.6 创建或打开该工程后再导出。');
  }
  const editorVersion = /^m_EditorVersion:[ \t]*(\S+)/m.exec(version)?.[1] ?? '';
  const core = assertEmbeddedPackage(target, 'com.tencent.puerts.core');
  assertEmbeddedPackage(target, 'com.tencent.puerts.v8');
  const patch = puertsPatch(core);
  const source = path.join(frameworkDir, 'backends/unity/package');
  const sourceJson = path.join(source, 'package.json');
  const sourcePackage = readJson(sourceJson, 'LGUI-CLI-011', '插件的 Unity 包模板不完整', '重新安装完整的 LGUI 插件。');
  if (sourcePackage.name !== packageName || sourcePackage.version !== pluginVersion()) {
    throw error('LGUI-CLI-011', '插件的 Unity 包模板名称或版本不符。', sourceJson, '重新安装完整的 LGUI 插件。');
  }
  const packageDir = path.join(target, 'Packages', packageName);
  const ui = path.join(target, 'Assets/LGUI/Resources/UI');
  const game = path.join(target, 'Assets/LGUI/Resources/Game');
  const scene = path.join(target, 'Assets/LGUI/LGUIBoot.unity');
  const link = path.join(target, 'Assets/LGUI/link.xml');
  for (const file of [packageDir, ui, game]) assertOwnedPath(target, file);
  for (const file of [scene, link]) assertOwnedPath(target, file, 'LGUI-CLI-052', 'file');
  const installed = fs.existsSync(packageDir);
  if (installed) {
    const file = path.join(packageDir, 'package.json');
    const pkg = readJson(file, 'LGUI-CLI-003', 'Unity 工程里的 LGUI 包版本读不了', '运行 lgui upgrade 后再导出。');
    if (pkg.name !== packageName || pkg.version !== pluginVersion()) throw error('LGUI-CLI-003', 'Unity 工程里的 LGUI 包版本是 ' + pkg.version + '，插件是 ' + pluginVersion() + '，请先运行 lgui upgrade。', file, '运行 lgui upgrade 后再导出。');
  }
  const meta = path.join(source, 'Runtime/LGUIBoot.cs.meta');
  const linker = path.join(source, 'Runtime/link.xml');
  let guid;
  try { guid = /^guid: ([a-f0-9]{32})\r?$/m.exec(fs.readFileSync(meta, 'utf8'))?.[1]; fs.accessSync(linker); }
  catch (cause) { throw error('LGUI-CLI-011', 'Unity 包缺少 Boot metadata 或裁剪保留模板：' + cause.message, source, '重新安装完整的 LGUI 插件。'); }
  if (!guid) throw error('LGUI-CLI-011', 'Unity Boot metadata 缺少稳定的脚本 GUID。', meta, '重新安装完整的 LGUI 插件。');

  // 项目字体要 TMP 的必需资源：缺了就先找到、读好资源包（写盘在后面）。
  const tmp = prepareTmpEssentials(target, editorVersion, fontNames(projectRoot));

  // 所有已知前提通过，构建仍只发生在 LGUI 自己的缓存里。
  const stage = path.join(projectRoot, '.lgui/build/unity/export');
  assertOwnedPath(projectRoot, stage);
  fs.rmSync(stage, {recursive: true, force: true});
  fs.mkdirSync(stage, {recursive: true});
  const texts = readTexts(projectRoot, project.languages);
  const stageUi = path.join(stage, 'UI');
  const stageGame = path.join(stage, 'Game');
  await generateUnity(uiProjectPath(projectRoot), stageUi);
  const {model, deps} = await generateProjectTypes(projectRoot, {validated: true});
  generateTranslations(projectRoot, model, project.languages, path.join(stageUi, 'i18n'), project.defaultLanguage);
  await generateFonts(projectRoot, project, model, path.join(stageUi, 'fonts'), 'sfnt'); // Unity 导入成动态字体，适配层按 UI/fonts/<名字> 注册
  fs.mkdirSync(stageGame, {recursive: true});
  const entry = writeBootstrap(projectRoot, stage, project, deps, texts);
  try {
    await esbuild().build({...webBuildOptions(projectRoot, entry, {dev: false, outfile: path.join(stageGame, 'game.js.txt')}), format: 'iife', platform: 'neutral', sourcemap: false});
  } catch (cause) { throw bundleErrors(cause, projectRoot); }
  for (const directory of [stageUi, stageGame]) fs.writeFileSync(path.join(directory, 'README.txt'), generatedNotice);

  // 只替换两个明确归属 LGUI 的生成物目录；用户场景和其余 Assets 不覆盖。
  let tmpResult = null;
  if (tmp) {
    try { tmpResult = writeUnityPackage(tmp.items, target, file => assertOwnedPath(target, file, 'LGUI-CLI-143', 'file')); }
    catch (cause) { throw cause instanceof LgCliError ? cause : error('LGUI-CLI-143', '写入 TMP Essential Resources 失败：' + cause.message, path.join(target, 'Assets'), tmpMenuFix); }
    if (!hasTmpSettings(target)) throw error('LGUI-CLI-143', '导入 TMP Essential Resources 以后工程里还是没有 TMP Settings.asset。', path.join(target, 'Assets'), tmpMenuFix);
  }
  if (patch.bytes) fs.writeFileSync(patch.file, patch.bytes);
  if (!installed) fs.cpSync(source, packageDir, {recursive: true});
  for (const [from, to] of [[stageUi, ui], [stageGame, game]]) {
    assertOwnedPath(target, to);
    fs.rmSync(to, {recursive: true, force: true});
    fs.cpSync(from, to, {recursive: true});
  }
  const sceneCreated = !fs.existsSync(scene);
  if (sceneCreated) fs.writeFileSync(scene, bootScene(guid), {flag: 'wx'});
  fs.copyFileSync(linker, link); // Unity 不处理 UPM 包内部的 link.xml。
  const configFile = path.join(projectRoot, '.lgui/project.json');
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  raw.unityProject = path.relative(projectRoot, target).split(path.sep).join('/') || '.';
  fs.writeFileSync(configFile, JSON.stringify(raw, null, 2) + '\n');
  return {
    data: {unityProject: target, package: packageDir, installed: !installed, patch: patch.status, scene, sceneCreated, ui, game: path.join(game, 'game.js.txt'), linker: link,
      tmpEssentials: tmpResult ? {imported: tmpResult.written, kept: tmpResult.kept, from: tmp.file} : null},
    summary: [
      (!installed ? '已安装' : '已核对') + ' Unity 包 ' + packageName + ' ' + pluginVersion() + '。',
      patch.bytes ? '已对本地 PuerTS 3.0.3 应用四处 Unity 6.6 兼容补丁。' : 'PuerTS 四处补丁已经应用，明确跳过，文件不变。',
      '已生成 Unity 界面包、翻译和游戏脚本：' + target,
      sceneCreated ? '已生成启动场景 Assets/LGUI/LGUIBoot.unity。' : '已有启动场景保持不变。',
      ...(tmpResult ? ['已从 com.unity.ugui 自带的资源包导入 TMP Essential Resources（' + tmpResult.written + ' 个文件，没联网；工程里已有的 ' + tmpResult.kept + ' 个没动）：' + tmp.file] : []),
      '已复制 Assets/LGUI/link.xml 保留动态调用需要的程序集；在 Unity 打开启动场景并点 Play。'
    ]
  };
}
