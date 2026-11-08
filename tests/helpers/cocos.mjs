// 造假的最小 Cocos Creator 工程（cocos export 的测试目标）：package.json 带 creator 版本与
// fairygui-cc 依赖、settings 目录、assets 目录。不放 node_modules（export 不跑 npm）。
import fs from 'node:fs';
import path from 'node:path';

export function createCocosProject(root, {creator = '3.8.8', fairy = '1.2.2'} = {}) {
  fs.mkdirSync(path.join(root, 'settings', 'v2', 'packages'), {recursive: true});
  fs.mkdirSync(path.join(root, 'assets'), {recursive: true});
  fs.writeFileSync(path.join(root, 'settings', 'v2', 'packages', 'project.json'), JSON.stringify({
    general: {designResolution: {width: 1920, height: 1080, fitHeight: true}}
  }, null, 2));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fake-cocos', uuid: '11111111-2222-3333-4444-555555555555',
    creator: {version: creator},
    ...(fairy === null ? {} : {dependencies: {['fairygui-cc']: fairy}})
  }, null, 2));
  return root;
}
