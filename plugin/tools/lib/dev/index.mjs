// lgui dev：生成界面包和类型 → 打包 → 本地服务（只监听 127.0.0.1）→ 监听 ui/、src/、i18n/ 和工程配置 devWatch 里的路径，有改动就自动刷新页面。
// 生成物放在 .lgui/build/dev/（lgui verify、lgui test 各用各的目录，同时跑不会互相删文件）。
// 不提供任何写文件的接口；Host 头不是 127.0.0.1:<端口> 的请求一律 403（挡住 DNS 重绑定）。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LgCliError, LgCliErrors} from '../errors.mjs';
import {toErrors} from '../output.mjs';
import {generateProjectTypes, generateWeb, uiProjectPath} from '../generate/index.mjs';
import {buildDir} from '../paths.mjs';
import {readUiModel} from '../generate/model.mjs';
import {generateTranslations} from '../generate/i18n.mjs';
import {generateFonts} from '../generate/fonts.mjs';
import {bundleErrors, createWebContext, writeWebBootstrap} from './bundle.mjs';
import {openInBrowser} from '../browser.mjs';
import {copyFramework} from '../commands/init.mjs';

// shell.html 是页面本身（scripts/build-demo.mjs 的静态构建原样用它）；开发服务另外加上自动刷新和错误推送。
const liveReload = `<script>
  const events = new EventSource('/__lgui/events');
  events.addEventListener('reload', () => location.reload());
  events.addEventListener('errors', e => window.__lguiShowErrors(JSON.parse(e.data)));
</script>
`;
const shell = fs.readFileSync(fileURLToPath(new URL('./shell.html', import.meta.url)), 'utf8').replace('</body>', `${liveReload}</body>`);
const types = {'.js': 'text/javascript; charset=utf-8', '.map': 'application/json', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/octet-stream', '.mp3': 'audio/mpeg'};

/** 返回 base（命令自己的生成目录，比如 .lgui/build/dev/）下的生成物（/ui/ 是界面包）；只读，不在里面就 404。 */
export function serveBuilt(base, url, res) {
  if (url === '/' || url === '/index.html') { res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}).end(shell); return; }
  const file = path.join(base, url.slice(1));
  const inside = file.startsWith(base + path.sep);
  if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, {'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
  res.end(fs.readFileSync(file));
}

/** 启动开发服务。返回 { url, close, rebuild }。 */
export async function startDev(root, project, {port = project.devPort, log = () => {}} = {}) {
  const clients = new Set();
  let lastErrors = [];
  const send = (event, data) => { for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const report = errors => {
    lastErrors = errors.map(e => e.toJSON());
    for (const e of errors) log(`${e.file ? `${e.file}${e.line ? `:${e.line}` : ''}  ` : ''}${e.code}  ${e.message}${e.fix ? `  → ${e.fix}` : ''}`);
    send('errors', lastErrors);
  };

  // 额外监视的路径（工程配置 devWatch，相对工程根目录）：不存在就报错，不悄悄不监视
  const extra = project.devWatch.map(p => ({path: p, dir: path.resolve(root, p)}));
  const missing = extra.filter(e => !fs.existsSync(e.dir));
  if (missing.length) throw new LgCliErrors(missing.map(e => new LgCliError('LGUI-CLI-116', `工程配置 devWatch 里的 ${e.path} 不存在（${e.dir}）。`, {file: '.lgui/project.json', fix: '写相对工程根目录的路径（比如 ../Config），或者从 devWatch 里删掉它。'})));

  // 1. 生成界面包、类型、包依赖；2. 写启动入口；3. 打包。都放在 .lgui/build/dev/。
  const site = buildDir(root, 'dev');
  // 项目字体的子集（ui/fonts/）：字集来自 ui/ 和 i18n/，所以两边改了都重新生成。
  const fonts = () => generateFonts(root, project, readUiModel(uiProjectPath(root)), path.join(site, 'ui', 'fonts'), 'woff2');
  const generateUi = async () => {
    await generateWeb(uiProjectPath(root), path.join(site, 'ui'));
    await generateProjectTypes(root, {validated: true});
    translations();
    await fonts();
  };
  const translations = () => generateTranslations(root, readUiModel(uiProjectPath(root)), project.languages, path.join(site, 'i18n'), project.defaultLanguage);
  let context = null;
  const bundle = async () => {
    translations();
    const entry = writeWebBootstrap(root, project, {dir: site});
    if (!context) context = await createWebContext(root, entry, {outfile: path.join(site, 'app.js')});
    try {
      await context.rebuild();
    } catch (error) {
      throw bundleErrors(error, root);
    }
  };
  const run = async (step, label) => {
    try {
      await step();
      lastErrors = [];
      log(`已${label}，刷新页面。`);
      send('reload', {});
      return true;
    } catch (error) {
      report(toErrors(error));
      return false;
    }
  };

  // 工程里的框架副本和插件版本一致时才会走到这里（版本检查在命令入口）；先确认它在。
  if (!fs.existsSync(path.join(root, '.lgui', 'framework', 'index.ts'))) copyFramework(path.join(root, '.lgui', 'framework'));
  try {
    await generateUi();
    await bundle();
  } catch (error) {
    report(toErrors(error));
  }

  // 本地服务
  let host = ''; // 127.0.0.1:<端口>，开始监听后才知道
  const server = http.createServer((req, res) => {
    if (req.headers.host !== host) { res.writeHead(403).end('forbidden'); return; }
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/__lgui/events') {
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'});
      res.write(': lgui\n\n');
      if (lastErrors.length) res.write(`event: errors\ndata: ${JSON.stringify(lastErrors)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (url === '/favicon.ico') { res.writeHead(204).end(); return; }
    serveBuilt(site, url, res);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', error => {
        if (error.code === 'EADDRINUSE') reject(new LgCliError('LGUI-CLI-030', `端口 ${port} 已经被占用了。`, {fix: '在 .lgui/project.json 里改 devPort，或者加 --port <端口>。'}));
        else reject(error);
      });
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    await context?.dispose();
    throw error;
  }
  host = `127.0.0.1:${server.address().port}`;
  const url = `http://${host}/`;

  // 监听文件：ui/ 的改动等 200 毫秒合成一次再重新生成；src/、i18n/ 和 devWatch 里的路径改了就重新打包。
  const watchers = [];
  let timer = null;
  let closed = false;
  let inflight = Promise.resolve();
  let pending = {ui: false, text: false, code: false};
  const flush = () => { inflight = inflight.then(flushNow); return inflight; };
  const flushNow = async () => {
    timer = null;
    if (closed) return;
    const {ui, text, code} = pending;
    pending = {ui: false, text: false, code: false};
    if (ui) await run(async () => { await generateUi(); await bundle(); }, '重新生成界面');
    else if (text) await run(async () => { await fonts(); await bundle(); }, '重新打包');
    else if (code) await run(bundle, '重新打包');
  };
  // 生成物都在 .lgui/build/ 里：devWatch 写成工程根目录或它的上级时会监视到这里，不跳过的话打包写盘又触发打包，一直循环。
  const output = path.join(root, '.lgui', 'build');
  const watch = (dir, kind) => {
    if (!fs.existsSync(dir)) return;
    watchers.push(fs.watch(dir, {recursive: fs.statSync(dir).isDirectory()}, (_, name) => {
      const changed = name ? path.resolve(dir, name.toString()) : null;
      if (changed && (changed === output || changed.startsWith(output + path.sep))) return;
      pending[kind] = true;
      clearTimeout(timer);
      timer = setTimeout(flush, kind === 'ui' ? 200 : 50);
    }));
  };
  watch(path.join(root, 'ui'), 'ui');
  watch(path.join(root, 'src'), 'code');
  watch(path.join(root, 'i18n'), 'text');
  for (const e of extra) watch(e.dir, 'code');

  return {
    url,
    errors: () => lastErrors,
    async close() {
      closed = true;
      clearTimeout(timer);
      await inflight;
      for (const w of watchers) w.close();
      for (const res of clients) res.end();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await context?.dispose();
    }
  };
}

/** lgui dev 命令。 */
export async function dev({projectRoot, project, flags}) {
  let port = project.devPort;
  if (flags.port !== undefined) {
    port = Number(flags.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new LgCliError('LGUI-CLI-006', `--port ${flags.port} 不是合法的端口号。`, {fix: '写 1–65535 之间的整数。'});
  }
  const server = await startDev(projectRoot, project, {port, log: line => process.stderr.write(line + '\n')});
  const opened = flags['no-open'] ? false : openInBrowser(server.url);
  const summary = [`预览地址：${server.url}`, opened ? '已经用 Chrome / Edge 打开。' : (flags['no-open'] ? '没有自动打开浏览器（--no-open）。' : '没找到 Chrome 或 Edge，请手动打开上面的地址。'), `改 ${['ui/', 'src/', 'i18n/', ...project.devWatch].join('、')} 会自动刷新；按 Ctrl+C 停止。`];
  const errors = server.errors();
  if (errors.length) summary.push(`现在有 ${errors.length} 个错误，页面上也会显示。`);
  // 命令一直运行到 Ctrl+C；摘要先打印出来。
  return {data: {url: server.url, opened}, summary, errors: []};
}

export {LgCliErrors};
