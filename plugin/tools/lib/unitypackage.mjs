// 读 Unity 的 .unitypackage，把里面的资源写进 Unity 工程（lgui unity export 补 TMP Essential Resources 用）。
// .unitypackage 是 gzip 压缩的 tar：每个资源一个以 GUID 命名的目录，里面有 pathname（第一行是工程里的路径）、
// asset.meta（带这个 GUID 的 meta）、asset（文件内容；文件夹没有）、可能还有 preview.png。
// Unity 导入时做的，就是按 pathname 把 asset 和 asset.meta 写进工程；这里做同样的事，只写工程里还没有的文件，已有的一个都不碰。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const field = (block, start, length) => block.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');

/** tar 里的普通文件：[{ name, data }]。认 ustar 头、PAX 扩展头（x / g）和 GNU 长文件名（L）；读不了时抛 Error。 */
function readTar(buffer) {
  const entries = [];
  let offset = 0, longName = null, paxPath = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`tar 头里的大小不对（位置 ${offset}）`);
    const type = String.fromCharCode(header[156] || 0x30);
    const start = offset + 512;
    if (start + size > buffer.length) throw new Error('文件被截断了');
    const data = buffer.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'x' || type === 'g') {
      for (const record of data.toString('utf8').split('\n')) {
        const m = /^\d+ path=(.*)$/.exec(record);
        if (m && type === 'x') paxPath = m[1];
      }
      continue;
    }
    const prefix = field(header, 345, 155);
    const name = longName ?? paxPath ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = paxPath = null;
    if (type === '0' || type === '\0' || type === '7') entries.push({name: name.replace(/^\.\//, ''), data});
  }
  return entries;
}

/** 读 .unitypackage：[{ guid, pathname, asset?: Buffer, meta: Buffer }]，按 pathname 排好（文件夹在它里面的文件前面）。格式不对时抛 Error（说明原因）。 */
export function readUnityPackage(file) {
  let tar;
  try { tar = zlib.gunzipSync(fs.readFileSync(file)); } catch (error) { throw new Error(`不是 gzip 压缩的 .unitypackage：${error.message}`); }
  const byGuid = new Map();
  for (const {name, data} of readTar(tar)) {
    const m = /^([0-9a-f]{32})\/(pathname|asset|asset\.meta)$/.exec(name);
    if (!m) continue; // preview.png 之类
    if (!byGuid.has(m[1])) byGuid.set(m[1], {guid: m[1]});
    const item = byGuid.get(m[1]);
    if (m[2] === 'pathname') item.pathname = data.toString('utf8').split('\n')[0].replace(/\r$/, '').trim();
    else if (m[2] === 'asset') item.asset = data;
    else item.meta = data;
  }
  const items = [...byGuid.values()];
  if (!items.length) throw new Error('包里一个资源都没有');
  for (const item of items) {
    if (!item.pathname || !item.meta) throw new Error(`资源 ${item.guid} 缺 pathname 或 asset.meta`);
    const parts = item.pathname.split('/');
    if (parts[0] !== 'Assets' || parts.some(p => p === '' || p === '.' || p === '..') || item.pathname.includes('\\')) throw new Error(`资源 ${item.guid} 的路径 ${item.pathname} 不在 Assets/ 下，或者写法不对`);
  }
  return items.sort((a, b) => a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0);
}

/**
 * 把读出来的资源写进 Unity 工程：文件写 asset 和 .meta，文件夹建目录和 .meta。工程里已经有的文件（或 .meta）不碰。
 * check(file, kind)：写之前检查目标路径（不能是链接、不能逃出工程），由调用方给。返回 { written: 写了的文件数, kept: 已经有、没动的文件数 }。
 */
export function writeUnityPackage(items, unityProject, check = () => {}) {
  let written = 0, kept = 0;
  const put = (file, data) => {
    if (fs.existsSync(file)) { kept++; return; }
    check(file, 'file');
    fs.writeFileSync(file, data, {flag: 'wx'});
    written++;
  };
  for (const item of items) {
    const target = path.join(unityProject, ...item.pathname.split('/'));
    if (item.asset) {
      fs.mkdirSync(path.dirname(target), {recursive: true});
      put(target, item.asset);
    } else {
      fs.mkdirSync(target, {recursive: true});
    }
    put(target + '.meta', item.meta);
  }
  return {written, kept};
}
