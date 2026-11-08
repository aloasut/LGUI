// 动效验收（dev 脚本）：验证 <transition> 在 cocos 端真的在动。
// 证据 1（enter 淡入）：开背包瞬间抓一帧（中途 alpha<1），等淡入结束再抓一帧，两帧像素必须不同。
// 证据 2（coinPulse yoyo 循环）：稳定后对 coinFx 区域（Bag n4，1440,104 300,48）每 350ms 连拍三张，
//   循环动效在动的话三张两两不同；PNG 编码对相同像素是确定的，字节比较即像素比较。
// 用法：node verify-tween.mjs（先 node sync.mjs + Creator CLI 构建）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {playwright} from '../../plugin/tools/lib/vendor.mjs';

const project = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(project, 'build', 'web-mobile');
const outDir = '/tmp/lgui-tween';
fs.mkdirSync(outDir, {recursive: true});

const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream', '.xml': 'text/xml', '.mp3': 'audio/mpeg'};
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { console.log('[404]', req.url); res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': mime[path.extname(file)] ?? 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(4191, '127.0.0.1', resolve));

const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await playwright().chromium.launch({executablePath: exe, headless: true});
// hasTouch + 触屏点按：touchHint 绑了 visibleOn: ['touch']（提示只对触屏显示），鼠标输入下它按设计隐藏。
// 用触屏驱动还能顺带覆盖真触屏输入链（pointerType 判 touch）。
const page = await browser.newPage({viewport: {width: 1920, height: 1080}, hasTouch: true});
const problems = [];
page.on('pageerror', e => problems.push(`[pageerror] ${String(e.stack ?? e).slice(0, 300)}`));
page.on('console', m => {
  const text = m.text();
  if (/LGUI-RT-\d+|failed|失败|Uncaught/i.test(text) && !/favicon/.test(text)) problems.push(`[console] ${text.slice(0, 300)}`);
});

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
const shot = (name, clip) => page.screenshot({path: path.join(outDir, name), ...(clip ? {clip} : {})});

await page.goto('http://127.0.0.1:4191/index.html');
await page.waitForFunction(() => globalThis.__lgui, null, {timeout: 30000});

// —— enter 淡入：开背包瞬间抓中途帧 ——
const rect = await page.evaluate(() => globalThis.__lgui.ui.find('Main/MainView.bagEntry'));
if (!rect) throw new Error('找不到 bagEntry');
await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
await page.waitForFunction(() => JSON.stringify(globalThis.__lgui.debug.snapshot()).includes('BagView'), null, {timeout: 10000});
await shot('tween-1-mid-fade.png');
await page.waitForTimeout(1200); // enter 全程 667ms（0+10、4+8、8+8 帧 @24fps），留足余量
await shot('tween-2-settled.png');
console.log('[enter] 中途帧', sha(path.join(outDir, 'tween-1-mid-fade.png')), 'vs 稳定帧', sha(path.join(outDir, 'tween-2-settled.png')));

// —— hintPulse 循环：touchHint 区域连拍三张 ——
// Bag n33 touchHint：xy=1140,950 size=720,40；留点余量取 1120,930 760,80。
const clip = {x: 1120, y: 930, width: 760, height: 80};
const pulses = [];
for (let i = 0; i < 3; i++) {
  const name = `tween-3-pulse-${i}.png`;
  await shot(name, clip);
  pulses.push(sha(path.join(outDir, name)));
  if (i < 2) await page.waitForTimeout(350); // pulse 单程 0.5s（12 帧），350ms 必落在不同 alpha 上
}
console.log('[pulse] 三张哈希：', pulses.join(' '));

const [mid, settled] = [sha(path.join(outDir, 'tween-1-mid-fade.png')), sha(path.join(outDir, 'tween-2-settled.png'))];
const results = {
  'enter 淡入中途≠稳定': mid !== settled,
  'pulse 三张两两不同（循环在动）': pulses[0] !== pulses[1] && pulses[1] !== pulses[2] && pulses[0] !== pulses[2]
};
let bad = false;
for (const [name, ok] of Object.entries(results)) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) bad = true;
}
if (bad) problems.push('动效像素证据不成立');
console.log(problems.length ? `❌ 问题 ${problems.length} 个：\n${problems.join('\n')}` : '✅ 动效验收全过');
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
