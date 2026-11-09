# FairyGUI-dom 补丁台账

上游：FairyGUI-dom 提交 `fade49fc33bdcd5673351e04637d4cc08d2297f3` 的 `dist/fairygui.module.js`（版本和 SHA-256 见同目录 `VERSION.md`）。**上游文件一个字节不改**，我们的改动都在 `../fairygui-patches/`：

- **钩子**：H5 后端启动时由 `../fairygui-patches/index.ts` 的 `installFairyGuiPatches()` 装上。先调上游原方法，再补我们的改动，不整段替换。装的时候（装钩子之前）检查要挂的方法、属性还在不在、上游有没有已经加了同名的；钩子读的上游字段，构造函数里设的建一个对象查，不在构造函数里设的（比如 `_src`、`_options`）查上游设它的 setter 或方法里还写着 `this.字段 =`。不在就报 `LGUI-RT-230`（上游已经有同名的报 `LGUI-RT-231`），错误里写着补丁编号，回到这张表重看。装不上以后再调用，原样再报同一个错，不会把已经装上的钩子再包一层。
- **.patch**：挂不上钩子的（改的是模块内部的函数、没导出的类、模块加载时就执行的代码），写成 `../fairygui-patches/<编号>-<名字>.patch`，由仓库的 `node scripts/fairygui-dom/build.mjs` 按文件名顺序打到上游原文件上，生成同目录的 `fairygui.module.js`（生成文件，不手改）。每一段都要在原位置逐行对上，上游改了就停下报错。`npm run check` 会比较生成文件和「上游 + 补丁」。

测试在仓库的 `tests/e2e/dom-patches.test.mjs`、`tests/e2e/dom-render.test.mjs`（Chrome 或 Edge）和 `tests/unit/fairygui-patches.test.mjs`。凡是「复现」的测试，都先在不装钩子的页面上证明问题存在，再验证修好了。

## 怎么升级上游

1. 改 `VERSION.md` 的提交，运行 `node scripts/fairygui-dom/build.mjs --fetch`，把它打印的 SHA-256 写进 `VERSION.md`。
2. 再运行一次 `node scripts/fairygui-dom/build.mjs`：.patch 对不上的，按报错找到上游现在的写法，在新的上游原文件上重新做这个补丁。
3. 跑上面的测试：钩子的目标不在了会报 `LGUI-RT-230`；上游自己修了的问题，「复现」那一步会失败——这时去掉对应的补丁。
4. 第 5 条要在 Safari（iPhone 模拟器）里看一遍。

## 补丁

| 编号 | 原因 | 方式 | 测试 |
|---|---|---|---|
| 1 | 图片 fill：`Image` 的 `fillMethod`、`fillOrigin`、`fillClockwise`、`fillAmount` 是空实现，进度条、长按进度显示不出来 | 钩子 `image-fill.ts`：4 个属性的 setter 先调上游再存值、刷新裁剪（水平、垂直用 `clip-path: inset(…)`，径向 90/180/360 用 `conic-gradient` 做 `mask-image`）；getter 换成读存下的值（上游的只返回常量） | `dom-patches`：XML 里水平 50%，代码改成 0、1；径向 360 的起点、顺逆时针；改回 None 时清掉 |
| 2 | 散图映射：生成的网页界面包里图片是按资源 ID 命名的散图，要按 `manifest.json` 找文件 | 钩子 `image-manifest.ts`：加 `UIPackage.setImageManifest` / `loadImageManifest`；`UIPackage` 实例的 `loadPackage`（读包）之后把每张图片的 `file` 改成「包目录 + 散图文件名」；包或图片不在映射里报 `LGUI-RT-010` | `dom-patches`：两张图片都指向 `ui/Test/<资源ID>.png` 且能加载、尺寸对；包不在映射里报 `LGUI-RT-010` |
| 3 | 文字颜色（方案里说「有问题」） | **未复现，没有补丁。** 最小样例里 `color="#ff0000"` 的文字网页上算出来就是 `rgb(255, 0, 0)` | `dom-patches` 里保留这一项检查 |
| 4 | 文字阴影：`shadowColor`、`shadowOffset` 读进来了但从来不用 | 钩子 `text-format.ts`：`TextField.applyFormat` 之后，偏移不为 0 时设 `text-shadow` | `dom-patches`：`shadowOffset="2,3"` → `rgb(255, 0, 0) 2px 3px 0px` |
| 5 | Safari（iPhone 上所有浏览器、微信、Mac Safari）不支持扩展内置元素（`extends: "div"` + `is`），打开就报 `ele.init is not a function` | `.patch` `5-safari-custom-elements.patch`：`UIElement` 改继承 `HTMLElement`，七种元素改成独立自定义元素（`<fgui-div>` 等），`document.createElement(tagName)` 创建；舞台样式表按 `div` 写的规则加上这七个元素名，并设 `display: block`。类声明和模块内部函数 `createUIElement` 挂不上钩子 | Chrome 里全部 e2e；Safari 要在 iPhone 模拟器里打开背包示例的静态构建（`scripts/build-demo.mjs`）看一遍 |
| 6 | 读包失败时 Promise 永远不结束（原来是第 2 条的附带改动） | `.patch` `6-load-package-reject.patch`：`UIPackage.loadPackage` 请求失败时 reject 并报 `LGUI-RT-011`，读包出错（包括第 2 条的 `LGUI-RT-010`）时 reject，包不登记。发请求的 `HttpRequest` 类没有导出，挂不上钩子 | `dom-patches`：地址错误的包报 `LGUI-RT-011`；包不在映射里报 `LGUI-RT-010` |
| 7 | 粗描边吃笔画：`-webkit-text-stroke` 骑在字形边缘、一半压进笔画，手机上 3–5 像素的描边把笔画吃空 | 钩子 `text-format.ts`：`TextField.applyFormat` 之后设 `paint-order: stroke fill`（先描边再画字），描边宽度改成 `2 × outline`，露在字外的正好是 outline，和 Unity 端（字形往四周偏移 outline 再画一遍）一致 | `dom-render`：复现（outline 10）描边一半压进笔画，字面只剩不到一半、每边露在字外 ≤ outline / 2 + 2；修后字面 > 没描边时的 90%，每一边露在字外 ≥ outline − 2。「露在字外多宽」逐行（逐列）数紧挨着字的那段描边，左、上、右、下各取中位数，不用外接框：外接框只看最远的一个像素，落在字形尖角的斜接上，看字体和系统（本机 13 种字体没修时 outline 8 量出 3–6；outline 6 时 Windows 没修量出 5，和本机修好后的最小值一样），分不开。允许差 2 像素（取整 1、各系统栅格化约 1），两个门槛不重叠 |
| 8 | `autoSize="shrink"` 没实现，超长文字只是被裁掉（Unity 端会缩小字号） | 钩子 `text-shrink.ts`：挂在 `TextField` 的 `applyText`、`applyFormat`、`onSizeChanged` 和 `autoSize`、`singleLine` 的 setter 之后，只在这些变化时测量，不每帧测。规则同 Unity 的 `DoShrink`：不换行的按宽度缩，多行且高度超出时按整数字号二分；只缩不放大。宽度按实际字面（`actualBoundingBox`）加两边描边算，缩完字和描边都在控件框里，所以缩放的文字 `overflow` 改成 `visible`；垂直对齐按缩完的行框高度重算。不换行的纯文字用 Canvas `measureText`（不读 DOM 布局）；会换行或带 UBB 的在页面外单独的测量元素上排版 | `dom-render`：复现裁切；修后字号变小、内容宽度不超过框、黑字和红色描边的像素都在控件框内；放得下的不缩；多行缩到放得下；空等 10 帧不测量，改文字测一次、改尺寸不测、改字号测一次；改回别的 autoSize 时字号复原 |
| 9 | `downEffect="scale"` 的按钮被关联拉宽时跑位：上游在 `GButton.constructExtension` 里把轴心改成 0.5，按钮变宽时按轴心修正位置；按压改 GObject 的 scale，还会被 GearSize 记住、被改 scale 的动效盖掉 | 钩子 `button-press.ts`：`constructExtension` 之后把轴心改回原来的，由我们接管按压（上游的 `_downEffect` 置 0，记下 `downEffectValue`）；按下、松开由框架的补间引擎带缓动地写按钮的 `pressScale`（`mvc/tween/press.ts`：按下 50 毫秒 `Quad.Out`、松开 100 毫秒 `Back.Out`），h5 后端把它设成元素的 CSS `scale`，GObject 的位置、尺寸、scale 都不变。框架没接管的按钮（加载器加载出来的组件里的）`setState` 之后按下时一下子设成 `downEffectValue`、松开清掉，也只改 CSS `scale`（和 Unity 上这类按钮一样是 FairyGUI 原来的效果）。按压以元素的 `transform-origin` 为中心：按钮自己没有缩放、旋转时是中心；有时是 XML 里的轴心 | `dom-render`：复现兄弟控件变宽 200 时按钮往左跑 100；修后位置不变；没接管时按下视觉宽度 × 0.8、GObject 不变，松开复原。`h5-tween`：框架接管的按下缩到 0.8（CSS `scale`）、GObject 不变，松开弹回；加载器里的按钮一下子缩到 0.8 |
| 10 | 还开着的界面离开舞台再回来（控制器的显示齿轮把它藏起来又显示）时，上游把在放的动效 `stop(false)`：停在当前帧，回来只重放自动播放的；代码放的动效停在半路，循环停了也不恢复 | 钩子 `transition-stage.ts`：`onOwnerRemovedFromStage` 时把在放、没暂停的动效暂停并记下（不调上游的 stop）；`onOwnerAddedToStage` 之前恢复记下的，再走上游。ui/ 里写了 `options` 2（离开舞台不停）或 4（停止时跳到结束）的照上游。钩子读的 `_options`、`_paused` 不在构造函数里设，装的时候查上游 `Transition.setup()`、`setPaused()` 里还在设它们 | `dom-render`：动效一放就离开舞台再回来（不按墙上时间等），复现金币停在离开时的位置没放完、循环停了；修后等到 fly 放完，金币到终点，循环在之后 60 帧里还在动；`options="4"` 仍跳到结束 |
| 11 | 动效目标是组时不动 | **不是运行时问题，没有补丁。** 普通组（没写 `advanced="true"`）只在编辑器里有，生成界面包时被去掉，指向它的动效条目也一起去掉；高级组在浏览器里正常 | `dom-render`：普通组和指向它的条目运行时都没有；高级组带着组里的控件动 |
| 12 | 九宫格在分数缩放下出细线（原生 GImage 和 Loader 两种 DOM 形式都有）。只在 Blink（Chrome、Edge、安卓 WebView）出现：上游用一个元素的 `border-image` 画，根节点 `transform: scale()` 缩放后 Blink 分 9 块画，块边落在设备像素的小数位置上各自抗锯齿，接缝透出背景。WebKit（iOS Safari）没有 | 钩子 `nine-slice.ts`：`Image.refresh` 之后，把九宫格改成 9 个子元素各画一块（取消上游下一帧的 `border-image`）。下面的块往上面的块底下多伸 1 个设备像素（中间在最下面、四边在中间、四角在最上面），伸出的部分用 `padding` + `background-origin: content-box` 画原图紧挨着的像素。**只在上面那块挨着接缝的 2 列（行）像素全部不透明时才伸**（每张图解码后看一次，按「图片 + 九宫格」记下）：半透明处叠两层会出现更深的线。一处都不能伸（整张半透明、跨域读不了像素、解码失败）和九宫格平铺（`gridTile`）的照旧用上游的 `border-image`。每种「图片 + 九宫格」生成一组共用的样式规则，每个九宫格只加一个类名和 9 个空 `<i>`；伸出的宽度在根元素的 CSS 变量 `--lgui-nine-overlap` 里，由 H5 后端在 `applyDesignSize` 之后按 `1 / (缩放 × devicePixelRatio)` 更新。没采用的办法：根节点改用 `zoom`（Blink 下没细线，但 WebKit 会把缩放后不到 9 CSS 像素的字放大到 9 像素，手机上 30 号以下的字都变宽）；逐个 `will-change`（每个一层，DPR 3 更差）；`image-rendering`、`border-image-repeat`、`backface-visibility`（无效） | `dom-render` 补丁 12：复现（把这个钩子换成空的）5 种尺寸纯色、外框面板都有细线；修后为 0，不透明面板分成 9 块，不叠出深线；整张半透明、平铺的仍是一个元素的 `border-image`，结果和不装一样 |
