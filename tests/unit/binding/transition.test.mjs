// 动效：动效名当绑定表的键（playing / play / done），自动播放照旧，被盖住时暂停，关闭时停掉。用 headless 后端测。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFixture, bagPanel} from '../../helpers/fixture.mjs';
import {headless, started} from '../../helpers/framework.mjs';
import {typecheck} from '../../helpers/ts.mjs';
import {generateProjectTypes} from '../../../plugin/tools/lib/generate/index.mjs';

const framework = fileURLToPath(new URL('../../../plugin/framework/index.ts', import.meta.url));

// pulse：12 帧（每秒 24 帧）= 500 毫秒；enter：自动播放，250 毫秒；glow：播放次数 -1（一直循环），每遍 6 帧 × 2 = 500 毫秒。
const motion = `  <transition name="pulse">
    <item time="0" type="Alpha" target="n0" tween="true" startValue="1" endValue="0.5" duration="12"/>
  </transition>
  <transition name="enter" autoPlay="true">
    <item time="0" type="Alpha" target="n0" tween="true" startValue="0" endValue="1" duration="6"/>
  </transition>
  <transition name="glow" autoPlayRepeat="-1">
    <item time="0" type="Alpha" target="n0" tween="true" startValue="1" endValue="0.8" duration="6" repeat="1" yoyo="true"/>
  </transition>
`;
const withMotion = xml => xml.replace(/<\/component>\s*$/, `${motion}</component>\n`);

export function motionFixture() {
  const root = writeFixture(undefined, {landscape: withMotion(bagPanel()), portrait: withMotion(bagPanel({size: '1080,1920'}))});
  // 列表子项也带一个动效（ItemView 里用 playing）。
  const slot = path.join(root, 'ui/assets/Bag/ItemSlot.xml');
  fs.writeFileSync(slot, fs.readFileSync(slot, 'utf8').replace(/<\/component>\s*$/, '  <transition name="flash">\n    <item time="0" type="Alpha" target="n1" tween="true" startValue="1" endValue="0" duration="24"/>\n  </transition>\n</component>\n'));
  return root;
}

async function setup() {
  const ctx = await started({root: motionFixture()});
  const {View} = ctx.fw;
  class CoverView extends View { static component = 'Common/Loading'; static layer = 'popup'; static fullScreen = true; static bothOrientations = true; }
  return {...ctx, CoverView};
}

test('headless 描述：动效带上时长（毫秒）、自动播放、播放次数，每一项改哪个控件的哪一类属性', async () => {
  const root = motionFixture();
  await generateProjectTypes(root);
  const bag = JSON.parse(fs.readFileSync(path.join(root, '.lgui/build/headless/Bag.json'), 'utf8'));
  const panel = bag.components.find(c => c.name === 'Bag/BagPanel');
  assert.deepEqual(panel.transitions, [
    {name: 'pulse', ms: 500, autoPlay: false, times: 1, delay: 0, items: [{target: 'gold', what: 'alpha'}]},
    {name: 'enter', ms: 250, autoPlay: true, times: 1, delay: 0, items: [{target: 'gold', what: 'alpha'}]},
    {name: 'glow', ms: 500, autoPlay: false, times: -1, delay: 0, items: [{target: 'gold', what: 'alpha'}]}
  ]);
});

test('生成的类型里有动效；绑定表里动效只能写 playing、play、done', async () => {
  const root = motionFixture();
  await generateProjectTypes(root);
  const file = path.join(root, 'motion.ts');
  const check = body => { fs.writeFileSync(file, `import type { Bind } from 'lgui';\nimport type { BagPanelUI } from './.lgui/build/types/index';\n${body}\nexport {};\n`); return typecheck([file], {baseUrl: root, paths: {lgui: [framework]}, lib: ['es2020', 'dom']}); };
  assert.deepEqual(check("declare const ui: BagPanelUI;\nui.pulse.stop();\nconst b: Bind<BagPanelUI> = { pulse: { play: 1, done: () => 0 }, glow: { playing: true } };"), []);
  assert.notDeepEqual(check("const b: Bind<BagPanelUI> = { pulse: { text: 'x' } };"), []);
});

test('play：值每变一次播一次（打开时的值不播）；放完才调用 done', async () => {
  const {fw, backend, sim} = await setup();
  const {lgui, View, pick} = fw;
  const fx = lgui.Model({hits: 0});
  const done = [];
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {pulse: {play: pick(fx, s => s.hits), done: () => done.push(fx.get().hits)}}; }
  const view = await lgui.ui.open(BagView);
  const pulse = view.__component.transition('pulse');
  await sim.advance(backend, 600);
  assert.deepEqual([pulse.plays, done], [0, []], '打开时的值不播');
  fx.set({hits: 1});
  assert.equal(pulse.playing, true);
  await sim.advance(backend, 400);
  assert.deepEqual(done, [], '还没放完');
  await sim.advance(backend, 100);
  assert.deepEqual([done, pulse.playing], [[1], false]);
  fx.set({hits: 2});
  await sim.advance(backend, 300);
  fx.set({hits: 3});                     // 没放完又播：从头放，前一次不算放完
  await sim.advance(backend, 300);
  assert.deepEqual(done, [1]);
  await sim.advance(backend, 200);
  assert.deepEqual([done, pulse.plays], [[1, 3], 3]);
});

test('playing：为真就播（按 ui/ 里的播放次数，-1 一直循环），为假就停；循环的不会 done', async () => {
  const {fw, backend, sim} = await setup();
  const {lgui, View, pick} = fw;
  const fx = lgui.Model({on: true});
  let done = 0;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {glow: {playing: pick(fx, s => s.on), done: () => done++}}; }
  const view = await lgui.ui.open(BagView);
  const glow = view.__component.transition('glow');
  await sim.advance(backend, 2000);
  assert.deepEqual([glow.playing, done], [true, 0]);
  fx.set({on: false});
  assert.equal(glow.playing, false);
  await sim.advance(backend, 2000);
  assert.equal(done, 0);
});

test('自动播放照旧；写了 done 时放完通知', async () => {
  const {fw, backend, sim} = await setup();
  const {lgui, View} = fw;
  let done = 0;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {enter: {done: () => done++}}; }
  class PlainView extends View { static component = 'Bag/BagPanel'; static layer = 'popup'; }
  const view = await lgui.ui.open(BagView);
  assert.equal(view.__component.transition('enter').playing, true);
  await sim.advance(backend, 200);
  assert.equal(done, 0);
  await sim.advance(backend, 100);
  assert.equal(done, 1);
  const plain = await lgui.ui.open(PlainView);
  assert.equal(plain.__component.transition('enter').playing, true, '没写进绑定表的自动播放也照旧');
  assert.equal(plain.__component.transition('pulse').playing, false);
});

test('写错：只写 done 但不会播放 → LGUI-RT-210；playing 和 play 一起写 → LGUI-RT-211；词表以外的词 → LGUI-RT-063', async () => {
  const {fw, backend} = await headless({root: motionFixture()});
  const {View} = fw;
  await backend.loadPackage('Common');
  await backend.loadPackage('Bag');
  const mount = bind => { class V extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = bind; } new V().__mount(backend.create('Bag', 'BagPanel')); };
  assert.throws(() => mount({pulse: {done: () => 0}}), /LGUI-RT-210/);
  assert.throws(() => mount({pulse: {playing: true, play: 1}}), /LGUI-RT-211/);
  assert.throws(() => mount({pulse: {visible: false}}), /LGUI-RT-063/);
});

test('被全屏界面盖住时动效暂停（绑定的和自动播放的），露出来接着放；盖住期间开始播的也先停着', async () => {
  const {fw, backend, sim, CoverView} = await setup();
  const {lgui, View, pick} = fw;
  const fx = lgui.Model({hits: 0});
  const done = [];
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; static fullScreen = true; static bothOrientations = true; bind = {pulse: {play: pick(fx, s => s.hits), done: () => done.push('pulse')}, enter: {done: () => done.push('enter')}}; }
  const view = await lgui.ui.open(BagView);
  const enter = view.__component.transition('enter');
  fx.set({hits: 1});
  await sim.advance(backend, 100);
  await lgui.ui.open(CoverView);
  assert.equal(enter.paused, true);
  await sim.advance(backend, 2000);
  assert.deepEqual(done, [], '盖住时不走');
  fx.set({hits: 2});                     // 盖住期间重播：也停着
  await sim.advance(backend, 2000);
  assert.deepEqual(done, []);
  lgui.ui.close(CoverView);
  assert.equal(enter.paused, false);
  await sim.advance(backend, 200);
  assert.deepEqual(done, ['enter']);
  await sim.advance(backend, 300);
  assert.deepEqual(done, ['enter', 'pulse']);
});

test('界面关闭时停掉它的动效，不再 done，也不再占用每帧回调', async () => {
  const {fw, backend, sim} = await setup();
  const {lgui, View, pick} = fw;
  const fx = lgui.Model({on: true, hits: 0});
  let done = 0;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {glow: {playing: pick(fx, s => s.on)}, pulse: {play: pick(fx, s => s.hits), done: () => done++}}; }
  const frames = backend.state.handlers.frame.size;
  const view = await lgui.ui.open(BagView);
  const [glow, pulse] = ['glow', 'pulse'].map(name => view.__component.transition(name));
  fx.set({hits: 1});
  lgui.ui.close(BagView);
  assert.deepEqual([glow.playing, pulse.playing], [false, false]);
  await sim.advance(backend, 1000);
  assert.equal(done, 0);
  assert.equal(backend.state.handlers.frame.size, frames);
});

test('界面缓存：缓存起来的组件上的动效也停掉', async () => {
  const {fw} = await started({root: motionFixture(), config: {uiCache: {keepClosedViews: 2}}});
  const {lgui, View} = fw;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {glow: {playing: true}}; }
  const view = await lgui.ui.open(BagView);
  const glow = view.__component.transition('glow');
  lgui.ui.close(BagView);
  assert.equal(glow.playing, false);
});

test('ItemView：playing 写成函数；数据变了重新渲染时接着放，不从头放；play 不能写在 ItemView 里（LGUI-RT-211）', async () => {
  const {fw, backend, sim} = await setup();
  const {lgui, View, ItemView, pick} = fw;
  const bag = lgui.Model({items: [{id: 'a', count: 1, isNew: true}, {id: 'b', count: 1, isNew: false}]});
  class SlotView extends ItemView { static component = 'Bag/ItemSlot'; bind = {flash: {playing: it => it.isNew}, count: {text: it => String(it.count)}}; }
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {list: {items: pick(bag, s => s.items), item: SlotView, key: it => it.id}}; }
  const view = await lgui.ui.open(BagView);
  const list = view.__component.child('list');
  const flash = list.itemAt(0).transition('flash');
  assert.deepEqual([flash.playing, flash.plays, list.itemAt(1).transition('flash').playing], [true, 1, false]);
  await sim.advance(backend, 300);
  bag.set({items: [{id: 'a', count: 2, isNew: true}, {id: 'b', count: 1, isNew: true}]});
  assert.deepEqual([flash.plays, list.itemAt(0).child('count').text, list.itemAt(1).transition('flash').playing], [1, '2', true]);
  class BadSlot extends ItemView { static component = 'Bag/ItemSlot'; bind = {flash: {play: it => it.count}}; }
  class BadView extends View { static component = 'Bag/BagPanel'; static layer = 'popup'; bind = {list: {items: pick(bag, s => s.items), item: BadSlot, key: it => it.id}}; }
  await assert.rejects(lgui.ui.open(BadView), /LGUI-RT-211/);
});

test('换版（旋转）时动效跟着新组件；盖着的界面换版后新组件的动效也停着', async () => {
  const {fw, backend, sim, CoverView} = await setup();
  const {lgui, View} = fw;
  let done = 0;
  class BagView extends View { static component = 'Bag/BagPanel'; static layer = 'page'; bind = {enter: {done: () => done++}}; }
  const view = await lgui.ui.open(BagView);
  await lgui.ui.open(CoverView);
  await sim.setScreen(backend, 1080, 1920);
  await sim.advance(backend, 200);
  assert.equal(view.__component.componentName, 'Bag/BagPanel@portrait');
  assert.equal(view.__component.transition('enter').paused, true);
  await sim.advance(backend, 1000);
  assert.equal(done, 0);
  lgui.ui.close(CoverView);
  await sim.advance(backend, 300);
  assert.equal(done, 1);
});
