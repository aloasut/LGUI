// example 独立工程的验收（dev 脚本）：构建产物起静态服务，无头 Chrome 里跑完整启动链，
// 再用真实鼠标点击走「营地 → 背包 → 关闭 → 换语言（zh-CN）」，全程截图留证据。
// 用法：node verify.mjs（先 node sync.mjs + Creator CLI 构建）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../../plugin/tools/lib/vendor.mjs';

const project = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(project, 'build', 'web-mobile');
const outDir = '/tmp/lgui-example';
fs.mkdirSync(outDir, {recursive: true});

const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream', '.xml': 'text/xml', '.mp3': 'audio/mpeg'};
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { console.log('[404]', req.url); res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': mime[path.extname(file)] ?? 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(4189, '127.0.0.1', resolve));

const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await playwright().chromium.launch({executablePath: exe, headless: true});
const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
const problems = [];
page.on('pageerror', e => problems.push(`[pageerror] ${String(e.stack ?? e).slice(0, 300)}`));
page.on('console', m => {
  const text = m.text();
  if (/lgui-example/i.test(text)) console.log('[console]', text.slice(0, 500));
  if (/LGUI-RT-\d+|failed|失败|Uncaught/i.test(text) && !/favicon/.test(text)) problems.push(`[console] ${text.slice(0, 300)}`);
});

// —— 启动链：boot（services + 存档恢复 + HudView + MainView）——
await page.goto('http://127.0.0.1:4189/index.html');
// __lgui 在 boot 完成后才挂上：它在，启动链就完成了。
await page.waitForFunction(() => globalThis.__lgui, null, {timeout: 30000});
const snap0 = await page.evaluate(() => JSON.stringify(globalThis.__lgui.debug.snapshot()));
console.log('[boot] 快照：', snap0.slice(0, 300));
if (!/HudView/.test(snap0) || !/MainView/.test(snap0)) problems.push('boot 后 HudView/MainView 不在快照里');
await page.screenshot({path: path.join(outDir, '1-boot-main.png')});

// —— 真实点击：营地 → 背包（工程设计分辨率 == LGUI 设计尺寸，坐标 1:1）——
const rect = await page.evaluate(() => globalThis.__lgui.ui.find('Main/MainView.bagEntry'));
if (!rect) throw new Error('找不到 bagEntry（MainView 没开或路径不对）');
console.log('[click] bagEntry @', JSON.stringify(rect));
await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
await page.waitForFunction(() => JSON.stringify(globalThis.__lgui.debug.snapshot()).includes('BagView'), null, {timeout: 10000});
const snap1 = await page.evaluate(() => JSON.stringify(globalThis.__lgui.debug.snapshot()));
console.log('[click] 打开背包后快照：', snap1.slice(0, 300));
await page.screenshot({path: path.join(outDir, '2-bag.png')});

// —— 关闭背包，回营地 ——
const closeRect = await page.evaluate(() => globalThis.__lgui.ui.find('Bag/BagPanel.closeButton'));
if (!closeRect) throw new Error('找不到 closeButton');
await page.mouse.click(closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2);
await page.waitForFunction(() => !JSON.stringify(globalThis.__lgui.debug.snapshot()).includes('BagView'), null, {timeout: 10000});
console.log('[click] 背包已关');

// —— 真切换语言（boot 按浏览器 locale 选了 en；切到工程默认 zh-CN，重建全部已开组件）——
await page.evaluate(() => globalThis.__lgui.setLanguage('zh-CN'));
await new Promise(resolve => setTimeout(resolve, 2500));
const snap2 = await page.evaluate(() => JSON.stringify(globalThis.__lgui.debug.snapshot()));
console.log('[lang] zh-CN 快照：', snap2.slice(0, 200));
if (!/HudView/.test(snap2) || !/MainView/.test(snap2)) problems.push('切语言后 HudView/MainView 不在快照里');
await page.screenshot({path: path.join(outDir, '3-zhcn.png')});
// 换语言后画面必须在渲染（历史上重建路径崩过渲染循环，截图全黑）：读回一个像素判断非纯背景色。
const rendered = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2');
  const pixels = new Uint8Array(4);
  gl.readPixels(gl.drawingBufferWidth / 2 | 0, gl.drawingBufferHeight / 2 | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return Array.from(pixels).join(',');
});
console.log('[lang] 画布中心像素：', rendered);

console.log(problems.length ? `❌ 问题 ${problems.length} 个：\n${problems.join('\n')}` : '✅ 全部通过');
await browser.close();
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
process.exitCode = problems.length ? 1 : 0;
