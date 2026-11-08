// 动效探针（dev 脚本）：打开背包后读 native fgui.Transition 的真实状态，定位 coinPulse 不动的原因。
// 用法：node probe-tween.mjs。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../../plugin/tools/lib/vendor.mjs';

const project = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(project, 'build', 'web-mobile');
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream', '.xml': 'text/xml', '.mp3': 'audio/mpeg'};
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': mime[path.extname(file)] ?? 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(4193, '127.0.0.1', resolve));

const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await playwright().chromium.launch({executablePath: exe, headless: true});
const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto('http://127.0.0.1:4193/index.html');
await page.waitForFunction(() => globalThis.__lgui, null, {timeout: 30000});
const rect = await page.evaluate(() => globalThis.__lgui.ui.find('Main/MainView.bagEntry'));
await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
await page.waitForFunction(() => JSON.stringify(globalThis.__lgui.debug.snapshot()).includes('BagView'), null, {timeout: 10000});
await page.waitForTimeout(1500); // enter 全程 667ms，等它放完再看 pulse

const probe = () => page.evaluate(() => {
  const bag = globalThis.__lgui.ui.list('page').find(v => v.__component && v.__component.allTransitions().length);
  if (!bag) return '找不到带动效的界面';
  const native = bag.__component.native;
  return ['enter', 'hintPulse'].map(name => {
    const t = native.getTransition(name);
    if (!t) return `${name}: 不存在`;
    const coin = native.getChild('touchHint');
    return `${name}: playing=${t._playing} totalTimes=${t._totalTimes} autoPlayTimes=${t._autoPlayTimes} options=${t._options ?? '-'} touchHint.alpha=${coin ? Number(coin.alpha).toFixed(3) : '无'}`;
  }).join(' | ');
});
console.log('[t=1.5s] ', await probe());
await page.waitForTimeout(400);
console.log('[t=1.9s] ', await probe());
await page.waitForTimeout(400);
console.log('[t=2.3s] ', await probe());
await browser.close();
server.close();
process.exit(0);
