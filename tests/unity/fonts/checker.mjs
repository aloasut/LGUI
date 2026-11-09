import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DRAWS = ['first', 'second', 'inFont', 'notInFont', 'en', 'boldZh', 'boldEn'];

/** 检查 probe.ts 的结果（见同目录 README.md）。 */
export function checkFontResult(report) {
  assert.equal(report.fatal, undefined, report.fatal);
  assert.equal(report.missing.rejected, true, '找不到的项目字体要报错');
  assert.equal(report.missing.code, 'LGUI-RT-181');
  assert.match(report.missing.message, /Resources\/UI\/fonts\/Missing/);
  assert.equal(report.registered, 'ProjectTMPFont:Noto', '项目字体按名字注册成 FairyGUI 的 TMPFont（LGUI 的只查 Regular 字重的子类）');
  assert.match(report.atlas, /^Dynamic,True,\d+$/, '动态图集、开多图集');
  assert.equal(report.drawnWith, 'ProjectTMPFont:Noto', '没写 font 的文字按 defaultFont 用项目 TMP 字体画');
  assert.notEqual(report.fallbackName, '', `这台机器上要找到系统回退字体（试过：${report.fallbackCandidates}）`);
  // 每段字（中文、英文、普通、粗体）都要真的排出来：字宽 > 0，每个字 4 个顶点。字宽 0、0 个顶点就是屏幕上什么都没有
  for (const key of DRAWS) {
    const d = report.draws?.[key];
    assert.ok(d, `缺少 draws.${key}`);
    const label = `draws.${key}（${d.bold ? '粗体' : '普通'}「${d.text}」）`;
    assert.ok(d.width > 0, `${label} 字宽是 ${d.width}：字没排出来`);
    assert.ok(d.vertices >= 4 * [...d.text].length, `${label} 只有 ${d.vertices} 个顶点，${[...d.text].length} 个字至少要 ${4 * [...d.text].length} 个：有字没画出来`);
    assert.ok(d.ms >= 0, `${label} 没有耗时`);
  }
  assert.ok(report.draws.boldZh.bold && report.draws.boldEn.bold && !report.draws.en.bold, '粗体那两段要按粗体排');
  // 顶点用的是哪个字体的图集：项目字体里有的字由它自己出，没有的字由系统回退字体出
  const fonts = (key, expected, message) => assert.deepEqual([...report.draws[key].fonts].sort(), [...expected].sort(), message);
  fonts('inFont', ['Noto'], '项目字体里有的字由它自己出');
  fonts('notInFont', [report.fallbackName], '项目字体里没有的字由系统回退字体出');
  for (const key of ['first', 'second', 'boldZh']) fonts(key, ['Noto', report.fallbackName], `draws.${key} 要同时用到项目字体和系统回退字体`);
  for (const key of ['en', 'boldEn']) fonts(key, ['Noto'], `draws.${key} 由项目字体出`);
  // 耗时只在确认排出字之后才算数
  return {...report, firstLayoutMs: report.draws.first.ms, secondLayoutMs: report.draws.second.ms};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const report = checkFontResult(JSON.parse(fs.readFileSync(file, 'utf8')));
  const draws = Object.fromEntries(DRAWS.map(key => [key, {width: report.draws[key].width, vertices: report.draws[key].vertices, ms: report.draws[key].ms}]));
  console.log(JSON.stringify({ok: true, file, fallback: report.fallbackName, firstLayoutMs: report.firstLayoutMs, secondLayoutMs: report.secondLayoutMs, draws}));
}
