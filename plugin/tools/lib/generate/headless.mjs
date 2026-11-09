// 给 headless 后端的界面结构：.lgui/build/headless/<包名>.json。
// 每个组件的控件树：名字、类型、初始属性（按钮带音效）、控制器和页面、列表的子项组件、子组件引用；每个包的图片和声音。
import fs from 'node:fs';
import path from 'node:path';
import {parsePages} from './model.mjs';
import {writeDir} from '../paths.mjs';

const bool = (value, fallback) => value === undefined ? fallback : value === 'true';

// 按钮的音效地址：ui://包ID资源ID 换成 ui://包名/声音名（运行时和测试里都用这种写法），别的写法照写。
function soundUrl(model, url) {
  const m = /^ui:\/\/([a-z0-9]{8})([a-z0-9]{8})$/.exec(url);
  const pkg = m && model?.byId.get(m[1]);
  const sound = pkg?.resources.find(r => r.id === m[2] && r.type === 'sound');
  return sound ? `ui://${pkg.name}/${sound.name}` : url;
}

// <Button sound="…" volume="百分比"/> → {sound, soundVolume}（只放写了的）。
function buttonSound(model, attrs = {}) {
  const p = {};
  if (attrs.sound !== undefined && attrs.sound !== '') p.sound = soundUrl(model, attrs.sound);
  if (attrs.volume !== undefined) p.soundVolume = Number(attrs.volume) / 100;
  return p;
}

// 图片、加载器的填充方式：XML 里写的名字 → 接口层的名字（和 FairyGUI 的 FillMethod 一样）。
const FILL_METHODS = {none: 'none', hz: 'horizontal', vt: 'vertical', radial90: 'radial90', radial180: 'radial180', radial360: 'radial360'};
const pair = (value, fallback) => { const [x, y] = (value ?? '').split(',').map(Number); return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : fallback; };

// 代码补间读写的初始值（只放和默认值不一样的）：轴心、缩放、旋转、透明度；文字的颜色、字号；图片、加载器、序列帧的着色；图片、加载器的填充。
function lookOf(child) {
  const a = child.attrs;
  const p = {};
  if (a.pivot) p.pivot = pair(a.pivot, [0, 0]);
  if (a.scale) p.scale = pair(a.scale, [1, 1]);
  if (a.rotation) p.rotation = Number(a.rotation);
  if (a.alpha !== undefined) p.alpha = Number(a.alpha);
  if (['text', 'richtext', 'input'].includes(child.kind)) { p.color = a.color ?? '#000000'; p.fontSize = Number(a.fontSize ?? 12); }
  if (['image', 'loader', 'movieclip'].includes(child.kind) && a.color) p.color = a.color;
  if (['image', 'loader'].includes(child.kind) && a.fillMethod && a.fillMethod !== 'none') {
    p.fillMethod = FILL_METHODS[a.fillMethod] ?? 'none';
    p.fillAmount = Number(a.fillAmount ?? 100) / 100;
  }
  return p;
}

function props(child, model) {
  const a = child.attrs;
  const p = {visible: bool(a.visible, true), enabled: !bool(a.grayed, false), touchable: bool(a.touchable, true), ...lookOf(child)};
  if (a.customData) p.customData = a.customData;
  if (['text', 'richtext', 'input'].includes(child.kind)) p.text = a.text ?? '';
  // 文字的自动大小：不写是 both（和 FairyGUI 一样），both、height 时尺寸由文字排版决定，headless 不算。
  if (child.kind === 'text' || child.kind === 'richtext') p.autoSize = a.autoSize ?? 'both';
  if (child.kind === 'input') p.promptText = a.prompt ?? '';
  // 输入框最多能输入几个字（UTF-16 长度，和浏览器的 maxlength 一样），0 是不限。
  if (child.kind === 'input' && Number(a.maxLength) > 0) p.maxLength = Number(a.maxLength);
  if (child.kind === 'loader') p.url = a.url ?? '';
  // 加载器的自动大小：尺寸跟着图片（和 FairyGUI 一样），headless 不算。
  if (child.kind === 'loader' && a.autoSize === 'true') p.autoSize = 'true';
  if (child.kind === 'button') {
    const button = child.children.find(node => node.tag === 'Button')?.attrs ?? {};
    // 没写 title 时显示按钮组件里 title 子控件自己的文字（和 FairyGUI 一样），所以不写就不放。
    if (button.title !== undefined) p.title = button.title;
    p.icon = button.icon ?? '';
    p.selected = button.checked === 'true';
    Object.assign(p, buttonSound(model, button));
  }
  if (child.kind === 'progress') {
    const bar = child.children.find(node => node.tag === 'ProgressBar')?.attrs ?? {};
    p.value = Number(bar.value ?? 0);
    p.max = Number(bar.max ?? 100);
  }
  if (child.kind === 'graph') p.color = a.fillColor ?? '#ffffff';
  if (child.kind === 'label') {
    // 没写 title 时显示标签组件里 title 文字自己的内容（和 FairyGUI 一样）。
    const label = child.children.find(node => node.tag === 'Label')?.attrs ?? {};
    if (label.title !== undefined) p.title = label.title;
    p.icon = label.icon ?? '';
  }
  if (child.kind === 'slider') {
    const slider = child.children.find(node => node.tag === 'Slider')?.attrs ?? {};
    p.value = Number(slider.value ?? 50);
    p.max = Number(slider.max ?? 100);
    p.min = Number(slider.min ?? 0);
  }
  if (child.kind === 'combobox') {
    // 和 FairyGUI 一样：写了 title 就选中同名的项，否则有项时选第一项。
    const combo = child.children.find(node => node.tag === 'ComboBox');
    p.items = (combo?.children ?? []).filter(node => node.tag === 'item').map(node => node.attrs.title ?? '');
    p.selectedIndex = combo?.attrs.title !== undefined ? p.items.indexOf(combo.attrs.title) : p.items.length ? 0 : -1;
  }
  if (child.kind === 'movieclip') {
    p.playing = bool(a.playing, true);
    p.frame = Number(a.frame ?? 0);
  }
  if (child.kind === 'tree') p.clickToExpand = Number(a.clickToExpand ?? 0);
  if (child.kind === 'list') p.scrollable = a.overflow === 'scroll'; // 能不能滚动：只有能滚动的列表才用虚拟列表
  return p;
}

// 动效放一遍的时长：每一项的「开始帧 + 时长 × (重复次数 + 1)」取最大，按帧率（不写是每秒 24 帧）换成毫秒。
// headless 后端按它走假时钟，放完才算完，和网页一致。有一项一直重复（repeat=-1）时永远放不完，记成 -1。
// 动效每一项改哪一类属性（查代码补间有没有抢同一个属性用）；别的类型（Visible、Sound、Animation……）不碰补间的属性。
const TOUCHES = {XY: 'xy', Size: 'size', Scale: 'scale', Alpha: 'alpha', Rotation: 'rotation', Color: 'color', Shake: 'shake', Text: 'text'};

function describeTransition(node, names) {
  const a = node.attrs;
  const fps = Number(a.frameRate ?? 24) || 24;
  let frames = 0;
  for (const item of node.children.filter(child => child.tag === 'item')) {
    const i = item.attrs;
    const repeat = Number(i.repeat ?? 0);
    const end = i.tween === 'true' ? (repeat < 0 ? Infinity : Number(i.time ?? 0) + Number(i.duration ?? 0) * (repeat + 1)) : Number(i.time ?? 0);
    frames = Math.max(frames, end);
  }
  return {
    name: a.name, ms: frames === Infinity ? -1 : Math.round((frames / fps) * 1000), autoPlay: a.autoPlay === 'true',
    times: Number(a.autoPlayRepeat ?? a.autoPlayTimes ?? 1), delay: Math.round(Number(a.autoPlayDelay ?? 0) * 1000),
    // target 是控件名，组件自己是 null；目标不在了的项 FairyGUI 跳过，这里也不记。
    items: node.children.filter(child => child.tag === 'item' && TOUCHES[child.attrs.type] && (!child.attrs.target || names.has(child.attrs.target)))
      .map(child => ({target: child.attrs.target ? names.get(child.attrs.target) : null, what: TOUCHES[child.attrs.type]}))
  };
}

// 位置和尺寸由谁决定（headless 不算布局，读到这些控件的位置、尺寸时报不支持）：关联（relation 的 sidePair）、改位置和尺寸的齿轮。
function layoutOf(node) {
  const relations = node.children.filter(n => n.tag === 'relation').flatMap(n => (n.attrs.sidePair ?? '').split(',').filter(Boolean));
  const result = {};
  if (relations.length) result.relations = relations;
  if (node.children.some(n => n.tag === 'gearXY')) result.gearXY = true;
  if (node.children.some(n => n.tag === 'gearSize')) result.gearSize = true;
  return Object.keys(result).length ? result : undefined;
}

// 改属性的齿轮：headless 不模拟，只记下有哪些、跟哪个控制器，读到它们管的属性时报不支持。
const PROP_GEARS = ['gearText', 'gearColor', 'gearIcon', 'gearLook', 'gearFontSize'];

// 齿轮：gearDisplay、gearDisplay2 控制显示（页 ID 换成页名）；改属性的齿轮只记下来；改位置、尺寸的齿轮见 layoutOf；其他齿轮 headless 不模拟。
function gears(node, component) {
  const pageNames = name => new Map(component.controllers.find(c => c.name === name)?.pages.map(page => [page.id, page.name]) ?? []);
  const result = {};
  for (const gear of node.children.filter(n => PROP_GEARS.includes(n.tag))) {
    if (!pageNames(gear.attrs.controller).size) continue; // 控制器不存在时 FairyGUI 也忽略这个齿轮
    (result.props ??= []).push({gear: gear.tag, controller: gear.attrs.controller});
  }
  for (const gear of node.children.filter(n => n.tag === 'gearDisplay' || n.tag === 'gearDisplay2')) {
    const names = pageNames(gear.attrs.controller);
    if (!names.size) continue; // 控制器不存在时 FairyGUI 也忽略这个齿轮
    const pages = (gear.attrs.pages ?? '').split(',').filter(Boolean).map(id => names.get(id) ?? `#${id}`); // 找不到的页 ID 留着：永远对不上，和 FairyGUI 一样
    if (gear.tag === 'gearDisplay') result.display = {controller: gear.attrs.controller, pages};
    else result.display2 = {controller: gear.attrs.controller, pages, condition: Number(gear.attrs.condition ?? 0)};
  }
  return Object.keys(result).length ? result : undefined;
}

// 按钮组件的按下效果：<Button downEffect="scale" downEffectValue="0.9"/>，downEffectValue 不写是 0.8（和 FairyGUI 一样）。
function downEffectOf(component) {
  const button = component.root.children.find(node => node.tag === 'Button')?.attrs ?? {};
  if (button.downEffect !== 'scale' && button.downEffect !== 'dark') return undefined;
  return {type: button.downEffect, value: button.downEffectValue !== undefined ? Number(button.downEffectValue) : 0.8};
}

export function describeComponent(component, model) {
  const names = new Map(component.children.filter(child => child.id && child.name).map(child => [child.id, child.name]));
  return {
    name: component.fullName,
    id: component.id,
    exported: component.exported,
    extension: component.extension,
    buttonMode: component.buttonMode,
    wholeNumbers: component.wholeNumbers ?? undefined,
    ...(component.extension === 'Button' ? buttonSound(model, component.root.children.find(node => node.tag === 'Button')?.attrs) : {}),
    size: component.size.split(',').map(Number),
    controllers: component.controllers.map(c => ({name: c.name, pages: c.pages.map(page => page.name), selected: c.pages[c.selected]?.name ?? c.pages[0]?.name ?? null})),
    ...(component.extension === 'Button' && downEffectOf(component) ? {downEffect: downEffectOf(component)} : {}),
    // 组件自己的轴心（列表子项、界面根节点用它；实例上写的优先）。
    ...(component.root.attrs.pivot ? {pivot: pair(component.root.attrs.pivot, [0, 0])} : {}),
    transitions: component.root.children.filter(child => child.tag === 'transition').map(node => describeTransition(node, names)),
    // 组（group）：不进控件树，只记显示状态，组里的控件跟着它显隐。
    groups: component.children.filter(child => child.tag === 'group').map(group => ({
      id: group.id, name: group.name ?? '', visible: bool(group.attrs.visible, true), group: group.attrs.group ?? null, gears: gears(group, component),
      // 组的自动排布（hz、vt）、组自己的关联和 gearXY 会挪动组里的控件；有排布的组上的 gearSize 会改组里控件的尺寸
      layout: group.attrs.layout && group.attrs.layout !== 'none' ? group.attrs.layout : undefined, ...layoutOf(group)
    })),
    children: component.children.filter(child => child.kind && child.name).map(child => ({
      name: child.name,
      elementId: child.id,
      kind: child.kind,
      ref: child.tag === 'component' ? child.ref?.fullName ?? null : null,
      defaultItem: child.kind === 'list' || child.kind === 'tree' ? child.ref?.fullName ?? null : null,
      rect: [...(child.attrs.xy ?? '0,0').split(',').map(Number), ...(child.attrs.size ?? '0,0').split(',').map(Number)],
      props: props(child, model),
      group: child.attrs.group ?? null,
      gears: gears(child, component),
      layout: layoutOf(child),
      // 按钮自带的 button 控制器、组件实例上覆写的控制器页面
      overrides: child.children.filter(node => node.tag === 'Button' || node.tag === 'ProgressBar').map(node => ({tag: node.tag, attrs: node.attrs}))
    }))
  };
}

// 图片尺寸：package.xml 里写了就用它，否则读 PNG 文件头（JPG 等读不出来时是 0）。
function imageSize(resource) {
  const w = Number(resource.attrs.width), h = Number(resource.attrs.height);
  if (w > 0 && h > 0) return {width: w, height: h};
  try {
    const head = fs.readFileSync(resource.file).subarray(0, 24);
    if (head.subarray(1, 4).toString() === 'PNG') return {width: head.readUInt32BE(16), height: head.readUInt32BE(20)};
  } catch {
    // 文件不在：lgui check 会报 LGUI-UI-018
  }
  return {width: 0, height: 0};
}

export function generateHeadless(model, out) {
  const contents = new Map();
  for (const pkg of model.packages) {
    const images = pkg.resources.filter(r => r.type === 'image').map(r => ({name: r.name, ...imageSize(r)}));
    const sounds = pkg.resources.filter(r => r.type === 'sound').map(r => ({id: r.id, name: r.name}));
    contents.set(`${pkg.name}.json`, JSON.stringify({schemaVersion: 1, package: pkg.name, id: pkg.id, components: pkg.components.map(c => describeComponent(c, model)), images, sounds}, null, 2) + '\n');
  }
  // 几条命令共用这个目录：只写新文件、删多余的（不整个删掉重建）
  return {files: writeDir(out, contents)};
}

export {parsePages};
