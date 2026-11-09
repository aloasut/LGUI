// MVC 开发规范的检查规则（LGUI-MVC-xxx），用语法树实现，不用字符串匹配。规则表见 references/mvc-spec.md 第 13 节。
import path from 'node:path';
import {finding, where, viewClasses, literalValue, objectProps} from './program.mjs';
import {members} from '../generate/types.mjs';
import {findComponent} from '../generate/model.mjs';
import {soundProblem} from './ui-rules.mjs';

const VIEW_STATICS = ['component', 'layer', 'fullScreen', 'params', 'result', 'inputMode', 'bothOrientations', 'music'];
const LAYERS = ['hud', 'page', 'popup', 'modal', 'toast'];
const DISPLAY = ['text', 'visible', 'enabled', 'icon', 'progress', 'page', 'redDot', 'value', 'playing', 'play', 'dragData', 'dragIcon'];
const ACTIONS = ['click', 'doubleClick', 'hold', 'drag', 'swipe', 'pinch', 'wheel', 'hover', 'change', 'select', 'input', 'drop', 'done'];
const TRANSITION_WORDS = ['playing', 'play', 'done'];
const LIST = ['items', 'item', 'key', 'selected'];
const OTHER = ['view', 'lockWhilePending', 'visibleOn', 'placeholder', 'roll', 'tick'];
const WORDS = [...DISPLAY, ...ACTIONS, ...LIST, ...OTHER];
const FORBIDDEN_GLOBALS = ['document', 'window', 'globalThis', 'CS', 'puer', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'navigator', 'location', 'setTimeout', 'setInterval', 'requestAnimationFrame'];
const LAYOUT_PROPS = ['x', 'y', 'width', 'height', 'rect'];
const TEXT_KEY = /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$|^[A-Z][A-Za-z0-9]*\/[A-Z][A-Za-z0-9@]*\/[A-Za-z0-9.@]+$/;

/** 文件在 MVC 里的角色：按文件名的后缀判断。 */
function roleOf(file) {
  const base = path.basename(file, '.ts');
  for (const role of ['Model', 'View', 'Controller', 'Service']) if (base.endsWith(role)) return role;
  return null;
}

/** this.ui 开头的写法：this.ui.title、this.ui['header.count'].text。 */
function fromThisUi(ts, expr) {
  for (let e = expr; ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e); e = e.expression) {
    if (ts.isPropertyAccessExpression(e) && e.name.text === 'ui' && e.expression.kind === ts.SyntaxKind.ThisKeyword) return true;
  }
  return false;
}

export function mvcRules({ts, checker, root, files, model}) {
  const out = [];
  const add = (code, node, message, fix, level) => out.push(finding(code, message, fix, {...where(root, node), level}));
  // 标识符指向工程自己（src/、tests/）里的声明就不是平台全局对象：同名的变量、参数、import 都不算。
  const own = new Set(files);
  const isGlobal = node => {
    const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    return !(symbol?.declarations ?? []).some(d => own.has(d.getSourceFile()));
  };

  for (const sf of files) {
    const rel = path.relative(root, sf.fileName).split(path.sep).join('/');
    const inSrc = rel.startsWith('src/');
    if (!inSrc) continue;
    const role = roleOf(rel);

    // MVC-017 文件位置和命名
    if (rel !== 'src/main.ts') {
      if (!/^src\/modules\/[a-z][a-z0-9-]*\/[A-Z][A-Za-z0-9]*\.ts$/.test(rel) || !role) {
        out.push(finding('LGUI-MVC-017', `${rel} 的位置或文件名不合规范：功能代码放在 src/modules/<功能>/，文件名以 Model、View、Controller、Service 结尾。`, '照 mvc-spec.md 第 2 节放文件、起名字。', {file: rel, line: 1, col: 1}));
      }
    }
    const views = viewClasses(ts, sf);
    if (views.length > 1) add('LGUI-MVC-017', views[1].node, `${rel} 里写了 ${views.length} 个 View，一个文件只写一个。`, '把每个 View 放进自己的文件。');

    // 逐个节点检查
    const viewNodes = new Set(views.map(v => v.node));
    const inView = node => { for (let n = node.parent; n; n = n.parent) if (viewNodes.has(n)) return true; return false; };
    const visit = node => {
      // MVC-001 平台全局对象
      if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.includes(node.text)) {
        const parent = node.parent;
        const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent) && parent.right === node);
        if (!isMemberName && isGlobal(node)) add('LGUI-MVC-001', node, `用了平台全局对象 ${node.text}。游戏代码不直接用浏览器或引擎的 API。`, '改用 lgui 提供的接口：网络用 lgui.platform.net，存储用 lgui.platform.storage，定时器写在 View 里用 this.after / this.every。');
      }
      // MVC-001 import
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (!(spec === 'lgui' || spec === 'lgui/ui' || spec.startsWith('.'))) add('LGUI-MVC-001', node, `import 了 ${spec}。游戏代码只 import lgui、lgui/ui 和工程里的相对路径。`, '去掉这个 import，改用 lgui 提供的接口。');
        if (role === 'Model' && spec.startsWith('.') && /(View|Controller|Service)$/.test(spec)) add('LGUI-MVC-012', node, `Model 依赖了 ${spec}。Model 只放数据和规则，不依赖界面、服务。`, '把这部分逻辑挪到 Controller。');
      }
      if (ts.isPropertyAccessExpression(node)) {
        const text = node.getText(sf);
        // MVC-010 View 访问服务和网络
        if (role === 'View' && /^lgui\.(service|platform\.net)\b/.test(text)) add('LGUI-MVC-010', node, `View 里用了 ${text}。View 不访问服务和网络。`, '把请求放到 Controller 里，View 只调用 Controller 的方法。');
        // MVC-012 Model 依赖界面、平台
        if (role === 'Model' && /^lgui\.(ui|platform|toast|confirm|loading|service)\b/.test(text)) add('LGUI-MVC-012', node, `Model 里用了 ${text}。Model 只放数据和规则。`, '把这部分挪到 Controller 或 Service。');
        // MVC-013 Service 操作界面
        if (role === 'Service' && /^lgui\.(ui|toast|confirm|loading)\b/.test(text)) add('LGUI-MVC-013', node, `Service 里用了 ${text}。Service 不操作界面。`, '用 lgui.defineEvent 广播事件，由 Controller 收听后改 Model。');
        // MVC-011 Controller 碰控件；MVC-018 跨界面改控件
        if ((node.name.text === 'ui' || node.name.text === '__component') && ts.isCallExpression(node.expression) && /^lgui\.ui\.get\b/.test(node.expression.expression.getText(sf))) {
          if (role === 'Controller') add('LGUI-MVC-011', node, 'Controller 不能碰控件。', '改 Model，让界面通过绑定表刷新。');
          else add('LGUI-MVC-018', node, '一个模块在改另一个界面的控件。', '改它监听的 Model。', 'warning');
        }
      }
      // MVC-009 View 改 Model
      if (role === 'View' && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression.expression.getText(sf);
        const method = node.expression.name.text;
        if (/Model$/.test(target) && !['get', 'subscribe'].includes(method)) add('LGUI-MVC-009', node, `View 里调用了 ${target}.${method}()。View 不改 Model。`, '在绑定表的动作里调用 Controller 的方法，由 Controller 改 Model。');
      }
      // MVC-014 lgui.toast / lgui.confirm 写死文字
      if (ts.isCallExpression(node) && /^lgui\.(toast|confirm)$/.test(node.expression.getText(sf))) {
        const literals = [];
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) literals.push(first);
        if (first && ts.isObjectLiteralExpression(first)) for (const p of first.properties) if (ts.isPropertyAssignment(p) && ['title', 'message', 'ok', 'cancel'].includes(p.name.getText(sf)) && ts.isStringLiteral(p.initializer)) literals.push(p.initializer);
        for (const lit of literals) if (!TEXT_KEY.test(lit.text)) add('LGUI-MVC-014', lit, `写死了用户能看到的文字「${lit.text}」。这里要写文本键。`, '在 i18n/<语言>.json 里加一个键（比如 bag.sold），这里写这个键。');
      }
      // MVC-015 代码里写坐标和尺寸
      if ((ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && LAYOUT_PROPS.includes(node.left.name.text))
        || (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['setXY', 'setSize', 'setPosition'].includes(node.expression.name.text))) {
        add('LGUI-MVC-015', node, '代码里写了坐标或尺寸。布局只在 ui/ 里定义。', '在 ui/ 里用关联、列表的自动排布来适配，代码里不改位置和大小。');
      }
      // MVC-020 View 里直接改控件属性（坐标尺寸归 MVC-015）：旋转、换语言重建组件后就丢了
      else if (inView(node) && ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) && fromThisUi(ts, node.left.expression) && !(ts.isPropertyAccessExpression(node.left) && LAYOUT_PROPS.includes(node.left.name.text))) {
        add('LGUI-MVC-020', node, `View 里直接改了控件属性 ${node.left.getText(sf)}。旋转屏幕、换语言时组件会重建，这样改的值会丢。`, '写进绑定表（比如 visible: pick(…)），由 Model 驱动。', 'warning');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    // View 类
    for (const view of views) {
      const isView = view.kind === 'View';
      const allowed = isView ? VIEW_STATICS : ['component'];
      for (const [name, decl] of view.statics) {
        if (!allowed.includes(name)) add('LGUI-MVC-003', decl, `${view.name} 写了清单以外的 static ${name}。`, `能写的只有：${allowed.join('、')}。`);
      }
      const componentDecl = view.statics.get('component');
      const componentName = componentDecl ? literalValue(ts, componentDecl.initializer) : undefined;
      if (!componentDecl) add('LGUI-MVC-002', view.node, `${view.name} 缺少必填的 static component。`, "写 static component = '<包>/<组件>';");
      if (isView && !view.statics.has('layer')) add('LGUI-MVC-002', view.node, `${view.name} 缺少必填的 static layer。`, "写 static layer = 'page' as const;");
      if (isView && view.statics.has('layer')) {
        const layer = literalValue(ts, view.statics.get('layer').initializer);
        if (!LAYERS.includes(layer)) add('LGUI-MVC-004', view.statics.get('layer'), `${view.name} 的 static layer 不是 5 层之一。`, `用 ${LAYERS.join('、')} 之一。`);
      }
      if (isView && view.statics.has('inputMode') && !['ui', 'game', 'all'].includes(literalValue(ts, view.statics.get('inputMode').initializer))) add('LGUI-MVC-004', view.statics.get('inputMode'), `${view.name} 的 static inputMode 只能是 ui、game、all。`, '改成其中一个，或者不写。');
      if (isView && view.statics.has('music')) {
        const music = literalValue(ts, view.statics.get('music').initializer);
        const problem = typeof music === 'string' ? soundProblem(model, music) : '要写成字符串 ui://包名/音效名';
        if (problem) add('LGUI-MVC-004', view.statics.get('music'), `${view.name} 的 static music 不对：${problem}。`, "写成 static music = 'ui://<包>/<音效名>';，音效是 mp3，登记在那个包的 package.xml 里。");
      }
      const component = typeof componentName === 'string' ? findComponent(model, componentName) : null;
      if (typeof componentName === 'string' && (!component || !component.exported)) {
        add(component ? 'LGUI-UI-019' : 'LGUI-MVC-004', componentDecl, component ? `${view.name} 用的组件 ${componentName} 没有导出。` : `${view.name} 的 static component 是 ${componentName}，ui/ 里没有这个组件。`, component ? '在 package.xml 里给它写 exported="true"。' : '用 lgui ui list 查看组件名。');
      }
      // MVC-016 全屏界面要么有竖版、要么写 bothOrientations
      if (isView && literalValue(ts, view.statics.get('fullScreen')?.initializer) === true && component && literalValue(ts, view.statics.get('bothOrientations')?.initializer) !== true) {
        if (!findComponent(model, `${componentName}@portrait`)) add('LGUI-MVC-016', view.node, `${view.name} 是全屏界面，但没有 ${componentName}@portrait 竖版，也没写 static bothOrientations = true。`, '在 ui/ 里做竖版（lgui new view --pattern 会一起生成），或者确实两种方向共用时写 static bothOrientations = true。');
      }
      // 绑定表
      const binds = objectProps(ts, view.bind) ?? [];
      const memberMap = component ? members(component).result : new Map();
      // 动效名也能当键（和控制器一样）
      const transitions = new Set((component?.transitions ?? []).map(t => typeof t === 'string' ? t : t?.name));
      for (const entry of binds) {
        const isTransition = transitions.has(entry.key) || memberMap.get(entry.key)?.kind === 'transition';
        // MVC-005 键在组件里存在
        if (component && !memberMap.has(entry.key) && !isTransition) add('LGUI-MVC-005', entry.node, `${view.name} 的绑定表里写了 ${entry.key}，但 ${componentName} 里没有这个控件、控制器或动效。`, '用 lgui ui list 查看真实的名字。');
        const member = memberMap.get(entry.key);
        const words = objectProps(ts, entry.value);
        if (!words) continue;
        for (const w of words) {
          // MVC-006 词表
          if (!WORDS.includes(w.key)) { add('LGUI-MVC-006', w.node, `${view.name} 的 ${entry.key} 用了词表以外的词 ${w.key}。`, '能用的词见 mvc-spec.md 第 6.4 节。'); continue; }
          if (member?.kind === 'controller' && !['page', 'change'].includes(w.key)) add('LGUI-MVC-006', w.node, `${entry.key} 是控制器，只能用 page 和 change，不能用 ${w.key}。`, '控制器只写 page 和 change。');
          if (isTransition && !TRANSITION_WORDS.includes(w.key)) add('LGUI-MVC-006', w.node, `${entry.key} 是动效，只能用 ${TRANSITION_WORDS.join('、')}，不能用 ${w.key}。`, '动效写 playing: pick(…)、play: pick(…) 或 done: () => xxxController.方法()。');
          if (member && !isTransition && member.kind !== 'movieclip' && TRANSITION_WORDS.includes(w.key)) add('LGUI-MVC-006', w.node, `${entry.key} 不是动效，不能用 ${w.key}。`, 'playing、play、done 只写在动效名（ui/ 里的 transition）上；序列帧动画只用 playing。');
          // MVC-007 显示类的值
          if (DISPLAY.includes(w.key) && w.key !== 'redDot' && w.value) {
            const v = w.value;
            const isPick = ts.isCallExpression(v) && v.expression.getText(sf) === 'pick';
            const isLiteral = ts.isStringLiteral(v) || ts.isNumericLiteral(v) || v.kind === ts.SyntaxKind.TrueKeyword || v.kind === ts.SyntaxKind.FalseKeyword || ts.isNoSubstitutionTemplateLiteral(v);
            const isFn = ts.isArrowFunction(v) || ts.isFunctionExpression(v);
            if (view.kind === 'ItemView' ? !(isFn || isLiteral) : !(isPick || isLiteral)) add('LGUI-MVC-007', v, `${view.name} 的 ${entry.key}.${w.key} 要写固定值或 pick(…)${view.kind === 'ItemView' ? '，ItemView 里写成函数' : ''}。`, '写成 pick(数据, s => s.字段)。');
            // MVC-014 绑定表里写死文字
            if (w.key === 'text' && (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) && v.text !== '') add('LGUI-MVC-014', v, `${view.name} 的 ${entry.key} 写死了文字「${v.text}」。`, '固定文字放在 ui/ 里；动态文字用 pick(…, lgui.t(键))。');
          }
          // MVC-008 动作只调用一个 Controller 方法
          if (ACTIONS.includes(w.key) && w.value) {
            let fn = w.value;
            if (w.key === 'hold') { const action = (objectProps(ts, w.value) ?? []).find(p => p.key === 'action'); fn = action?.value ?? null; }
            if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
              const body = fn.body;
              const call = ts.isCallExpression(body) ? body : (ts.isBlock(body) && body.statements.length === 1 && ts.isExpressionStatement(body.statements[0]) && ts.isCallExpression(body.statements[0].expression) ? body.statements[0].expression : null);
              const target = call && ts.isPropertyAccessExpression(call.expression) ? call.expression.expression.getText(sf) : '';
              if (!call || !/[cC]ontroller$/.test(target)) add('LGUI-MVC-008', fn, `${view.name} 的 ${entry.key}.${w.key} 只能调用一个 Controller 方法。`, '写成 () => xxxController.方法()，业务逻辑放进 Controller。');
            }
          }
        }
      }
      // MVC-019 keys 表
      for (const k of objectProps(ts, view.keys) ?? []) {
        const v = k.value;
        if (!v) continue;
        if (k.key === 'back') {
          const lit = literalValue(ts, v);
          if (!(lit === 'close' || lit === 'none' || ts.isArrowFunction(v) || ts.isFunctionExpression(v))) add('LGUI-MVC-019', k.node, 'keys.back 只能是 \'close\'、\'none\' 或函数。', "写成 back: 'close'。");
        } else {
          const props = objectProps(ts, v);
          const ok = props && props.some(p => p.key === 'do') && props.every(p => p.key === 'do' || (p.key === 'hint' && p.value && ts.isStringLiteral(p.value) && TEXT_KEY.test(p.value.text)));
          if (!ok) add('LGUI-MVC-019', k.node, `keys.${k.key} 要写成 { do: () => …, hint?: '文本键' }。`, `写成 ${k.key}: { do: () => xxxController.方法(), hint: 'bag.sell' }。`);
        }
      }
    }
  }
  return out;
}

/** 绑定了 redDot 的控件（给 UI-012 用）：[{ component, key, node }]。 */
export function redDotBindings({ts, root, files}) {
  return wordBindings({ts, root, files}, 'redDot');
}

/** 绑定表里写了某个绑定词（比如 text）的控件：[{ component, key, loc }]。只认 static component 写成字符串的界面。 */
export function wordBindings({ts, root, files}, name) {
  const out = [];
  for (const sf of files) {
    for (const view of viewClasses(ts, sf)) {
      const component = literalValue(ts, view.statics.get('component')?.initializer);
      for (const entry of objectProps(ts, view.bind) ?? []) {
        const word = (objectProps(ts, entry.value) ?? []).find(w => w.key === name);
        if (word && typeof component === 'string') out.push({component, key: entry.key, loc: where(root, word.node)});
      }
    }
  }
  return out;
}

/** 代码里 lgui.t(…) 用到的文本键（字符串字面量）：[{ key, loc }]。 */
export function usedTextKeys({ts, root, files}) {
  const out = [];
  // 键的写法：字符串 → 一个键；条件表达式 → 两边各自的键；模板字符串（`item.${kind}.name`）→ 一个匹配规则（只用来判断「有没有用到」）。
  const keysIn = expr => {
    if (ts.isParenthesizedExpression(expr)) return keysIn(expr.expression);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [{key: expr.text, loc: where(root, expr)}];
    if (ts.isConditionalExpression(expr)) return [...keysIn(expr.whenTrue), ...keysIn(expr.whenFalse)];
    if (ts.isTemplateExpression(expr)) {
      const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = escape(expr.head.text) + expr.templateSpans.map(span => '.+' + escape(span.literal.text)).join('');
      return [{pattern: new RegExp(`^${source}$`), loc: where(root, expr)}];
    }
    return [];
  };
  for (const sf of files) {
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        const first = node.arguments[0];
        if ((callee === 'lgui.t' || callee === 'lgui.toast') && first) out.push(...keysIn(first));
        if (callee === 'lgui.confirm' && first && ts.isObjectLiteralExpression(first)) for (const p of first.properties) if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) out.push({key: p.initializer.text, loc: where(root, p.initializer)});
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    // View 的 keys 表里的 hint（别处的 hint 字段不是文本键）
    for (const view of viewClasses(ts, sf)) {
      for (const k of objectProps(ts, view.keys) ?? []) {
        const hint = (objectProps(ts, k.value) ?? []).find(p => p.key === 'hint');
        if (hint?.value && ts.isStringLiteral(hint.value)) out.push({key: hint.value.text, loc: where(root, hint.value)});
      }
    }
  }
  return out;
}

/** 写了 static fullScreen = true 的 View 用的组件（给 UI-064 用）：[{ component, loc }]。 */
export function fullScreenViews({ts, root, files}) {
  const out = [];
  for (const sf of files) {
    for (const view of viewClasses(ts, sf)) {
      const component = literalValue(ts, view.statics.get('component')?.initializer);
      if (view.kind === 'View' && typeof component === 'string' && literalValue(ts, view.statics.get('fullScreen')?.initializer) === true) out.push({component, loc: where(root, view.node)});
    }
  }
  return out;
}
