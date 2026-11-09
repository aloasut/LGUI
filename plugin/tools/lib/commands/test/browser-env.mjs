// lgui test --browser：在测试页面里装测试环境——h5 后端、真浏览器里的模拟操作、记下日志和声音，每个测试结束时收尾。
// 由 lgui test 生成的入口（.lgui/build/test/browser/env.ts）调用。模拟操作把控件换算成页面坐标，再通过 lgui test 暴露给页面的
// window.__lguiInput 发真实的鼠标、触摸、键盘输入（playwright + CDP），和 headless 的 t.* 同一套写法。
// 和 headless 一样的规则：点不到的控件报 LGUI-RT-032；另外浏览器里真的做命中测试，控件被别的东西挡住也报 LGUI-RT-032。
import {afterEach} from 'node:test';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
// 真实输入发出去以后，等框架在下一帧处理完（手势识别、打开界面都按帧走）。
const settle = async () => { await frame(); await frame(); await wait(0); };

function runtimeError(code, message, next) {
  const error = new Error(`${code}  ${message}  → ${next}`);
  error.code = code;
  error.next = next;
  return error;
}

const input = (op, ...args) => {
  const send = globalThis.__lguiInput;
  if (!send) throw runtimeError('LGUI-RT-263', '页面里没有 __lguiInput，模拟操作发不出去。', '用 lgui test --browser 跑（它负责打开页面并接上真实输入）。');
  return send(op, ...args);
};

// 控件在页面上的中心点；和 headless 一样，点不到的控件、文字和图片报 LGUI-RT-032；再做一次真实的命中测试，被挡住也报。
function pointOf(o) {
  const native = o?.native;
  if (!native?.element) throw runtimeError('LGUI-RT-024', `${o?.name} 不是 h5 后端创建的对象。`, '不要混用不同后端的对象。');
  const isText = 'text' in o && 'color' in o && !('promptText' in o) && !('child' in o);
  if (isText || 'fillMethod' in o || ('frame' in o && 'playing' in o)) {
    throw runtimeError('LGUI-RT-032', `控件 ${o.name} 是文字、图片或序列帧动画，收不到点击和手势（各个后端都一样）。`, '把点击和手势绑在按钮、组件、列表或有填充的图形上。');
  }
  let reachable = o.shown;
  for (let n = native; n && reachable; n = n.parent) if (n.touchable === false) reachable = false;
  if (!reachable) throw runtimeError('LGUI-RT-032', `控件 ${o.name} 现在点不到（自己或上级没显示、被齿轮或组藏起来、不可用或不接收输入）。`, '检查这个控件和它所在的界面是不是显示、可用、激活；齿轮藏起来的控件先切到它显示的页。');
  const r = native.element.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  if (!hit || !native.element.contains(hit)) {
    const outside = x < 0 || y < 0 || x >= innerWidth || y >= innerHeight;
    throw runtimeError('LGUI-RT-032', `控件 ${o.name} 的中心（页面坐标 ${Math.round(x)}, ${Math.round(y)}）${outside ? '在屏幕外面' : '被别的控件挡住了'}，真的点下去不会落到它上面。`, outside ? '先把它滚动或摆到屏幕里。' : '检查上面盖着的界面或控件（遮罩、弹窗、同级控件）；headless 不做命中测试，只有浏览器里查得出来。');
  }
  return {x, y};
}

const wrongControl = (o, what, kind) => {
  throw runtimeError('LGUI-RT-150', `${what}只能用在${kind}上，${o.name} 不是${kind}。`, `换一个${kind}的路径（lgui ui list 里能看到控件类型）。`);
};

/** 浏览器里的模拟操作（和 headless 的 simulate.ts 同名同参数）。stage 是 h5 后端的缩放（设计尺寸 → 页面像素）。 */
function createSim(stage) {
  const sim = {
    async click(_b, o, holdMs = 50, pointerType = 'mouse') { const p = pointOf(o); await input('press', p.x, p.y, holdMs, pointerType); await settle(); },
    async doubleClick(b, o) { await sim.click(b, o); await wait(100); await sim.click(b, o); },
    async hold(b, o, ms) { await sim.click(b, o, ms); },
    async drag(_b, o, dx, dy, durationMs = 400, steps = 10) { const p = pointOf(o); await input('touchDrag', p.x, p.y, dx * stage.scale, dy * stage.scale, durationMs, steps); await settle(); },
    swipe: (b, o, dx, dy) => sim.drag(b, o, dx, dy, 80, 4),
    async pinch(_b, o, scale) { const p = pointOf(o); await input('pinch', p.x, p.y, 50 * stage.scale, scale, 5, 20); await settle(); },
    async wheel(_b, o, dy) { const p = pointOf(o); await input('wheel', p.x, p.y, dy); await settle(); },
    async key(_b, name) { await input('key', name === 'Back' ? 'BrowserBack' : name); await settle(); },
    // 打字：点一下输入框、全选，再用键盘一个字一个字地输入（maxLength 由浏览器管）；空字符串按退格清空。
    async type(b, o, text) {
      if (!('promptText' in o)) wrongControl(o, '打字（t.type）', '输入框');
      await sim.click(b, o);
      const element = o.native.element.htmlInput;
      element.select();
      if (text) await input('type', text);
      else if (element.value) await input('key', 'Backspace');
      await settle();
    },
    // 拖滑动条：按住滑块，一次移到目标位置再松开（和 headless 一样：夹在范围内、按设置取整，值变了才通知）。
    async setValue(_b, o, value) {
      const n = o.native;
      if (!('min' in o && 'onChange' in o && n?._gripObject)) wrongControl(o, '拖滑动条（t.setValue）', '滑动条');
      pointOf(o);
      const grip = n._gripObject.element.getBoundingClientRect();
      const from = {x: grip.x + grip.width / 2, y: grip.y + grip.height / 2};
      const target = (Math.min(n.max, Math.max(n.min, value)) - n.min) / (n.max - n.min);
      const dx = (target - (n.value - n.min) / (n.max - n.min)) * n._barMaxWidth * stage.scale;
      await input('mouseDrag', from.x, from.y, from.x + dx, from.y);
      await settle();
    },
    // 选下拉框：点开，再点弹出列表里的那一项。
    async choose(b, o, index) {
      if (!('items' in o && 'selectedIndex' in o)) wrongControl(o, '选下拉框（t.choose）', '下拉框');
      if (!Number.isInteger(index) || index < 0 || index >= o.items.length) {
        throw runtimeError('LGUI-RT-151', `下拉框 ${o.name} 没有第 ${index} 项（一共 ${o.items.length} 项）。`, '序号从 0 开始，先确认下拉框的 items 已经给好。');
      }
      await sim.click(b, o);
      const item = o.native.dropdown.getChild('list').getChildAt(index);
      const r = item.element.getBoundingClientRect();
      await input('press', r.x + r.width / 2, r.y + r.height / 2, 50, 'mouse');
      await settle();
    },
    // 拖放：和 headless 的 t.dragTo 一样，按住来源，先挪 20 像素，再分 10 步挪到目标中心松手。
    async dragTo(_b, from, to) { const a = pointOf(from), z = pointOf(to); await input('touchPath', a.x, a.y, z.x, z.y, 400, 10); await settle(); },
    async setScreen(_b, width, height) { await input('viewport', width, height); await settle(); },
    // 安全区：和 lgui verify 一样用 __lguiSafeArea 注入（屏幕像素），再发一次 resize 让框架重新摆放。
    async setSafeArea(_b, insets) {
      globalThis.__lguiSafeArea = {top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left};
      dispatchEvent(new Event('resize'));
      await settle();
    },
    // 浏览器里没有假时钟，是真的等；跨天这类长时间用 lgui.time.setServerOffset，等太久直接报错，不会把测试挂住。
    async advance(_b, ms) {
      if (ms > 10_000) throw runtimeError('LGUI-RT-263', `lgui test --browser 里 t.advance(${ms}) 要真的等 ${Math.round(ms / 1000)} 秒。`, '浏览器里一次最多等 10 秒；跨天、几小时这类长时间用 lgui.time.setServerOffset 推，动效、请求按真实时间等。');
      await wait(ms);
      await settle();
    }
  };
  return sim;
}

// 日志：记一份（error 级的让测试失败，和 headless 一样），再交给原来的出口打到控制台。
function recorder(inner, logs, category, context) {
  const write = (level, event, data, error) => {
    const record = {level, category, event};
    if (data !== undefined) record.data = data;
    if (error !== undefined) record.error = error;
    if (Object.keys(context).length) record.context = context;
    logs.push(record);
  };
  const value = data => (typeof data === 'function' ? data() : data);
  return {
    enabled: () => true,
    debug: (event, data) => { const v = value(data); write('debug', event, v); inner.debug(event, v); },
    info: (event, data) => { const v = value(data); write('info', event, v); inner.info(event, v); },
    warn: (event, data, error) => { const v = value(data); write('warn', event, v, error); inner.warn(event, v, error); },
    error: (event, error, data) => { const v = value(data); write('error', event, v, error); inner.error(event, error, v); },
    child: (extra, sub) => recorder(inner.child(extra, sub), logs, sub ? `${category}.${sub}` : category, {...context, ...extra})
  };
}

/**
 * 装测试环境。createH5Backend、stage 来自工程里的框架（.lgui/framework/backends/h5）；sounds 是「ui://包ID资源ID → ui://包名/声音名」，
 * 记下的声音地址和 headless 一样统一成 ui://包名/声音名。
 */
export function installBrowserEnv({createH5Backend, stage, config, deps, texts, defaultFont, fonts, sounds}) {
  const snapshots = {};
  const createBackend = () => {
    const backend = createH5Backend();
    const state = {sounds: [], music: null, logs: []};
    const init = backend.init.bind(backend);
    backend.init = async options => {
      await init({...options, defaultFont, fonts, uiBase: './ui', i18nBase: './i18n'});
      const platform = backend.platform;
      platform.log = recorder(platform.log, state.logs, 'game', {});
      const audio = platform.audio;
      // 没登记的 ui:// 声音不记（真实的出口会报 LGUI-RT-170），和 headless 一样。
      const name = url => (url.startsWith('ui://') ? sounds[url] ?? null : url);
      platform.audio = {
        play(url, volume, onError) { const n = name(url); if (n) state.sounds.push({url: n, volume}); audio.play(url, volume, onError); },
        music(url, volume, fadeMs, onError) {
          if (url === null) state.music = null;
          else { const n = name(url); if (n) state.music = {url: n, volume}; }
          audio.music(url, volume, fadeMs, onError);
        },
        setPaused(paused) { audio.setPaused(paused); }
      };
    };
    backend.state = state;
    return backend;
  };
  const env = {createBackend, sim: createSim(stage), deps, config, texts, current: null};
  globalThis.__lguiTest = env;
  globalThis.__lguiSnapshots = snapshots;
  // 和 headless 的 env.ts 一样：每个测试结束时记下快照，再收尾（没调 t.end() 的补上；失败的只清理，不再加新的错）。
  afterEach(t => {
    const current = env.current;
    env.current = null;
    if (!current) return;
    try { snapshots[t.name] = current.snapshot(); } catch (error) { snapshots[t.name] = String(error); }
    const note = current.finish(t.passed);
    if (note) t.diagnostic(note);
  });
}
