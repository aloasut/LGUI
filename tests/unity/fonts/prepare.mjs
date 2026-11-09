import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {esbuild} from '../../../plugin/tools/lib/vendor.mjs';
import {essentialsCandidates} from '../../../plugin/tools/lib/commands/unity-export.mjs';
import {readUnityPackage, writeUnityPackage} from '../../../plugin/tools/lib/unitypackage.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(here, '../../fixtures/fonts/NotoSansSC-Sample.otf');

/** 在已有的开发 Unity 工程里只准备这个探针：游戏脚本、字体样本（放在 lgui unity export 写的位置）、测试读数；
 *  工程里没有 TMP Settings 时，和 lgui unity export 一样从 com.unity.ugui 自带的资源包导入 TMP Essential Resources。 */
export async function prepareFontProbe({project, evidenceDir}) {
  project = path.resolve(project); evidenceDir = path.resolve(evidenceDir);
  if (!fs.existsSync(path.join(project, 'Packages/manifest.json')) || !fs.existsSync(path.join(project, 'Assets'))) throw new Error('LGUI-RT-001 Select an existing development Unity project.');
  const output = path.join(project, 'Assets/LGUI/Resources/Game/game.js.txt');
  const fonts = path.join(project, 'Assets/LGUI/Resources/UI/fonts');
  fs.mkdirSync(path.dirname(output), {recursive: true}); fs.mkdirSync(fonts, {recursive: true}); fs.mkdirSync(evidenceDir, {recursive: true});
  await esbuild().build({entryPoints: [path.join(here, 'probe.ts')], outfile: output, bundle: true, format: 'iife', target: 'es2020', platform: 'neutral', keepNames: true, logLevel: 'silent'});
  fs.copyFileSync(sample, path.join(fonts, 'Noto.otf'));
  fs.copyFileSync(path.join(here, 'FontProbeMetrics.cs'), path.join(project, 'Assets/FontProbeMetrics.cs'));
  let tmpEssentials = 'present';
  const hasSettings = dir => fs.readdirSync(dir, {withFileTypes: true}).some(e => e.isDirectory() ? hasSettings(path.join(dir, e.name)) : e.name === 'TMP Settings.asset');
  if (!hasSettings(path.join(project, 'Assets'))) {
    const version = /^m_EditorVersion:[ \t]*(\S+)/m.exec(fs.readFileSync(path.join(project, 'ProjectSettings/ProjectVersion.txt'), 'utf8'))?.[1] ?? '';
    const candidates = essentialsCandidates(project, version);
    const file = candidates.find(c => fs.existsSync(c));
    if (!file) throw new Error('LGUI-CLI-143 找不到 TMP Essential Resources 资源包，找过：\n' + candidates.join('\n'));
    tmpEssentials = {from: file, ...writeUnityPackage(readUnityPackage(file), project)};
  }
  return {project, tmpEssentials, result: path.join(evidenceDir, 'result.json'), log: path.join(evidenceDir, 'unity.log')};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => process.argv[process.argv.indexOf(name) + 1];
  for (const name of ['--project', '--evidence']) if (!process.argv.includes(name) || !argument(name)) throw new Error(`LGUI-RT-001 Missing ${name}.`);
  console.log(JSON.stringify(await prepareFontProbe({project: argument('--project'), evidenceDir: argument('--evidence')})));
}
