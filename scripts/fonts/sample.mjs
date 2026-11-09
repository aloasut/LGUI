// 开发用：重新生成测试用的字体样本 tests/fixtures/fonts/NotoSansSC-Sample.otf（Noto Sans SC 截出 ASCII 加 noto.mjs 的 SAMPLE_TEXT）。
// 用法：node scripts/fonts/sample.mjs。tests/helpers/fixture.mjs 里的界面文字改了、样本缺字时，把字加进 noto.mjs 的 SAMPLE_TEXT 再跑一次。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {subsetFont} from '../../plugin/tools/lib/generate/fonts.mjs';
import {SAMPLE_TEXT as TEXT, notoSansSC} from './noto.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const codepoints = new Set();
for (let cp = 0x20; cp < 0x7f; cp++) codepoints.add(cp);
for (const ch of TEXT) codepoints.add(ch.codePointAt(0));
const out = path.join(repo, 'tests/fixtures/fonts/NotoSansSC-Sample.otf');
fs.writeFileSync(out, await subsetFont(fs.readFileSync(await notoSansSC()), [...codepoints]));
console.log(`已写入 ${path.relative(repo, out)}：${codepoints.size} 个字，${fs.statSync(out).size} 字节。`);
