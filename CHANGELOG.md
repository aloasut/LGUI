# 更新记录

## 0.4.2（2026-11-09）

**Unity**

- 修好 Unity 上用项目字体时文字全不显示（0.4.0、0.4.1，TMP 必需资源导入了也一样）。原因是 FairyGUI 的 TMP 文字默认向 TMP 要 Medium 字重的字、粗体要 Bold，而 LGUI 运行时建的 TMP 字体只有一个字重，TMP 不给非 Regular 字重的字，排出来字宽 0、什么都不画。现在项目字体只向 TMP 要 Regular 字重，粗体照旧写 `bold="true"`，由 shader 加粗（伪粗体）。系统回退字体出的字（玩家名里的生僻字）同样修好。FairyGUI 的文件没改。
- `tests/unity/fonts/` 的原生验收改成检查字真的排出来：普通、粗体，中文、英文各一段，字宽要大于 0、顶点数够，项目字体里没有的字要由系统回退字体画；第一次排版的耗时只在确认排出字之后才算数。0.4.1 的验收没查这些，文字不显示也报 `ok: true`，当时记下的耗时不作数。

**已知限制**

- 斜体（`italic="true"`、富文本 `[i]`）在 Unity 上可能同样不显示：FairyGUI 查字时带着斜体样式，TMP 可能走同一个找不到字的分支。要修得改 FairyGUI 的文件，还没定。
- 这次的 C# 改动还没在 Unity 上编译和运行，要等 Windows 重测。

## 0.4.1（2026-11-08）

**Unity**

- `lgui unity export` 自动导入 TextMesh Pro 的必需资源：工程用了项目字体、Unity 工程 `Assets/` 下又没有 `TMP Settings.asset` 时，从 Unity 自带的 `com.unity.ugui` 包里的 TMP Essential Resources 资源包导入。不联网，不启动 Unity，batchmode 和 Agent 都不用点菜单；只写工程里还没有的文件，已有 TMP Settings 的工程不动。输出和 `--json` 的 `data.tmpEssentials` 写明导入了几个文件、从哪个资源包。
- 找不到或读不了这个资源包、包里没有 TMP Settings、写入失败，报 `LGUI-CLI-143`，列出找过的位置，什么都不写。
- 运行时缺 TMP Settings 报 `LGUI-RT-181`，写明原因和补法（重新 `lgui unity export`，或 Window → TextMeshPro → Import TMP Essential Resources），不再在创建字体时空引用。0.4.0 里，没导入 TMP 必需资源的 Unity 工程用项目字体会启动失败，这一版修好。

**编辑器和模板**

- `lgui init` 的模板和 `lgui new view` 生成的 XML 改成编辑器保存时的写法，模板带上 `ui/settings/` 下三份设置文件（`{}`）。新工程第一次在编辑器里保存时，只有改动过的地方变化，不再重写 11 个 XML、新增 3 份设置。已有工程和背包示例第一次保存时仍会被编辑器整理一次（显示效果不变），以后只改动过的地方。
- `lgui new` 新建包的 `package.xml` 带一个空的 `<publish name="包名">`。`LGUI-CLI-113` 的说明改成在已有的 `<publish>` 上加 `maxAtlasSize`，没有才写一个（写第二个 `<publish>` 不生效）。

**新错误码**

- `LGUI-CLI-143`：要导入 TMP 必需资源时，找不到或用不了 Unity 自带的资源包。

**已知限制**

- TMP 必需资源包在 Unity 安装里的位置按 TMP 原来的包推断，还没在 Windows 上核对；找不到时报 `LGUI-CLI-143`，在 Unity 里用菜单导入一次即可。
- Unity 端 TMP 字体还没在 Unity 上跑通验收。

## 0.4.0（2026-11-08）

**和 0.3.0 不兼容的地方**

- `lockWhilePending` 的动作失败时不再被绑定吞掉：和不锁时一样作为未处理的 Promise 报出来，`lgui test` 里这个测试失败。
- 已经打开（或正在打开）的界面再 `open`、参数不同时报 `LGUI-RT-240`，不再静默丢掉这次的参数。参数相同（按值比较，不管键的顺序；不传等于 `static params` 的默认值）照旧返回同一个 Promise。
- `ItemView` 里的 `click`、`doubleClick`、`hold.action` 收到这一项的数据作参数：`click: it => shopController.buy(it.id)`。
- 网页端描边画在字外，宽度改成 2 × outline，露在字外的正好是 outline，和 Unity 一致。按旧效果调过 `strokeSize` 的工程会觉得描边变粗了。
- 按钮按下缩放改为框架内置：写了 `downEffect="scale"` 的按钮按下 50 毫秒 `Quad.Out` 缩到 `downEffectValue`，松开 100 毫秒 `Back.Out` 弹回（会冲过头一点），参数写死；没绑 `click` 的按钮也一样。按住后手指移出点击范围（比如在列表里开始拖动）就弹回。加载器加载出来的组件里的按钮照旧是 FairyGUI 原来的一下子缩小。
- `lgui check` 要求每种语言的文本表里有 `lgui.time.day`、`lgui.time.hour`、`lgui.time.minute`、`lgui.time.second` 四个键（`format.duration('units')` 用），缺了报 `LGUI-UI-030`。模板和背包示例已补。
- `defaultFont` 和 XML 的 `font` 只能写 `ui/fonts/` 里的项目字体名，系统字体名也不行，否则报 `LGUI-CLI-142` / `LGUI-UI-080`。`defaultFont: null` 照旧可以，表示用系统默认字体。
- Unity 端项目字体改成 TextMesh Pro（需要 TMP，Unity 6 自带，不用另装）。没有项目字体时照旧用系统动态字体。
- Unity 工程要用 `lgui upgrade` 同步新版 Unity 包：旧版包没有剪贴板和项目字体的接口，分别报 `LGUI-RT-241`、`LGUI-RT-181`。
- `lgui.debug.snapshot().views[i]` 多了 `tweens`（正在跑的补间数）；`t.end()` 补间没停也算泄漏（`LGUI-RT-112`）。
- headless 照浏览器的规则执行，原来能过的测试可能变红：
  - 不能滚动（没写 `overflow="scroll"`）的列表设成虚拟列表报 `LGUI-RT-261`，设了再改回去报 `LGUI-RT-021`。
  - 按钮、标签的文字写进名为 `title` 的子控件；按钮实例没写 `title` 时保留子控件自己的文字（以前清成空）；`t.text` 读没有 `title` 子控件的按钮、标签报 `LGUI-RT-262`。
  - `t.type` 遵守 `maxLength`；点 Check 按钮切换选中、点 Radio 按钮选中。
  - 位置、尺寸由关联、排布、文字自动大小、加载器自动大小、`gearXY` / `gearSize` 决定的，文字、颜色、图标、可用状态、字号由改属性的齿轮（`gearText`、`gearColor`、`gearIcon`、`gearLook`、`gearFontSize`）决定的，读到（包括 `t.text`、`t.enabled`、点它）报 `LGUI-RT-260`，不再返回 `ui/` 里的初始值。要测这些用 `lgui test --browser`。
- `lgui test` 给没调 `t.end()` 的测试补上：测试通过了照样关界面、查泄漏和 `error` 日志，有问题这个测试失败。
- 没写图集上限的包默认 4096（以前是 2048）；`ui/settings/Publish.json` 写了 `atlasSetting.maxSize` 用它。
- `art cut`：和包里已登记的图片同名时直接替换（资源 ID、路径、导出不变，以前报 `LGUI-CLI-082`）；九宫格不再抽成「两端 + 中间 1 像素」，整张按比例缩放、保留原拉伸区；平铺图写 `scale="tile"`。
- 生成目录分开：`lgui dev` 写 `.lgui/build/dev/`，`lgui verify` 写 `.lgui/build/verify/`（站点在 `site/`），`lgui test` 用 `.lgui/build/test/`。
- `lgui check` 新加的规则（`LGUI-UI-066`–`069`、`LGUI-UI-080`、`LGUI-CLI-140`–`142`）可能让原来通过的工程报错。

**安装和工程**

- 随插件多带 `harfbuzzjs`、`wawoff2`（纯 WASM，做字体子集和 WOFF2），各系统同一份；许可见 `THIRD_PARTY_NOTICES.md`。
- 工程里新增 `ui/fonts/`：项目字体文件放这里（见下面「框架」的字体一节）。
- 工程配置新增 `devWatch`：`lgui dev` 额外监视的路径（宿主代码、仓库根的 `Config/` 等）。

**命令行**

- `lgui test [文件或目录...] [--name 名字片段] [--browser]`：只跑指定的文件、目录，或名字（连同 describe 的名字）里含这段文字的测试。输出写清跑了几个文件、几个测试，通过、失败、跳过、筛掉几个；describe 本身不算一个测试；`--json` 里每个失败带原因。路径写错 `LGUI-CLI-130`，`--name` 一个都没匹配到 `LGUI-CLI-131`。
- `lgui test --browser`：同一个测试文件、同一套 `t.*`，在 Chrome / Edge 里用网页后端跑，发真实的鼠标、触摸、键盘输入，做真实命中测试（被挡住、在屏幕外报 `LGUI-RT-032`）。每个测试开一个新页面（Model 每次都是新的）；`t.advance` 是真的等、一次最多 10 秒；测试文件只能 import `node:test`、`node:assert/strict`，子测试、`mock`、`done` 回调、`async` 的 `describe` 报 `LGUI-RT-263`；没有浏览器报 `LGUI-CLI-132`。
- 一条测试在 `t.end()` 前断言失败，同一个文件后面的测试不再跟着红；配了 `uiCache.keepClosedViews` 时 `t.end()` 不再报假的 `LGUI-RT-112`。
- `lgui check` 新规则：
  - `LGUI-UI-066`：给按钮、标签写了标题（实例的 `title`、绑定表的 `text`），给下拉框写了选项（实例的 `<item title>`、绑定表的 `items`），组件里却没有名为 `title` 的子控件——网页上显示不出来。
  - `LGUI-UI-067`：动效里旋转、缩放的控件没设 `pivot`（会绕左上角）；要绕左上角写 `pivot="0,0"`。
  - `LGUI-UI-068`：`shrink` / `ellipsis` 的文字框只放得下一行，没写 `singleLine="true"`。
  - `LGUI-UI-069`：动效的目标是普通组（生成时会被去掉）；写 `advanced="true"` 或直接动组里的控件。
  - `LGUI-UI-080`、`LGUI-CLI-140`–`142`：字体，见「框架」。
- 跨包图片可以用了：`<image pkg="对方包ID" src="资源ID">`。`LGUI-UI-020` 只剩「子组件跨包不写 `fileName`」；`LGUI-UI-009` 查跨包图片已导出；跨包图片所在的包算进包依赖，打开界面时一起加载（网页、headless、Unity 都是）。
- `art cut`：有物件在不拉伸的方向上都缩得不到尺寸的一半报 `LGUI-CLI-111`（以前悄悄变小）；要替换的图原来是九宫格、名字文件没写 `9grid` 报 `LGUI-CLI-112`；`pkg=` 只是「存进哪个包」，共用的图存进 Common 一份就行；修了 `fit` 的项可能被误报 `LGUI-CLI-085`。
- 图集：生成前逐张查尺寸，超过上限报 `LGUI-CLI-113`，写明哪张图、上限从哪来（包的 `<publish maxAtlasSize>` / `Publish.json` / LGUI 默认）。
- dev 开着时跑 `verify` / `test` 不再报 `ENOTEMPTY`。`devWatch` 路径不存在报 `LGUI-CLI-116`；写成 `.` 或 `..` 也不监视 `.lgui/build/`。
- `lgui verify --view <View> --params '<JSON>'`：给要参数的界面传参数；`--params` 写错报 `LGUI-CLI-114`，打开出错报 `LGUI-CLI-115`（带原来的错误码），不再是 `LGUI-CLI-999`。
- `lgui i18n extract`：多行文字（`&#xA;`）提取成真的换行。
- `lgui dev`、`verify`、`test --browser`、`unity export` 生成时按用到的字给项目字体做子集：网页出 WOFF2，Unity 出原格式。

**框架**

- 列表：只有能滚动的列表（`overflow="scroll"`）绑定时才用虚拟列表；不滚动的固定几项每一项都创建，浏览器上不再报 `Virtual list must be scrollable`。
- 输入框：`input` 动作跑完（返回 Promise 时等它结束）后框里显示 `text` 绑定的值，Model 截断了框里也截断。
- `lockWhilePending`：请求还没回来界面就关了，请求照常跑完，完成时不再碰控件（不再报 `Cannot set properties of null`）。
- `lgui.setLanguage`：同时调用时按顺序一个一个切；切换期间已打开的界面先不刷新、切完刷一次，这期间打开的界面、操作提示栏、横竖屏换版、排队放出的 modal 都等切完再做；不用界面缓存里旧语言的组件。不再出现 `LGUI-RT-071`、`LGUI-RT-080`。切换失败时错误交给这次的调用方。
- 旋转、换语言后重排层内顺序时界面不离开舞台，里面的动效不再停住。
- 被盖住时关掉、进了界面缓存的界面，再打开时自动播放的动效从头放（以前停在那一帧）。
- 剪贴板 `lgui.platform.clipboard.writeText(text)`、`readText()`，都返回 Promise；读写不了时失败（`LGUI-RT-241`，外部失败），用 `lgui.request` 包一层拿 `{ ok }`。宿主可以在 `lgui.app({ platform: { clipboard } })` 里换掉。
- `format.compact(n)`：数字缩写，中文 `1.6万`、`1.2亿`、`1万亿`（日文、繁体中文 `兆`，韩文 `조`），英文 `16.3K`、`1.2M`，最多一位小数，临界值进位（`999.95` → `1K`）。三端用同一套内置规则，显示一样。
- `format.duration(毫秒, 'clock' | 'units')`：`05:09`、`1:02:03`；`1天2小时`、`5分9秒`（单位用文本表的 `lgui.time.*`）。写法不对报 `LGUI-RT-285`。
- 单独的 Check / Radio 按钮能绑 `selected`：显示 Model 的值，点击由 `click` 交给 Controller 改。绑在普通按钮上，绑定时就报 `LGUI-RT-242`。
- `ItemView` 的 `redDot` 可以写成函数，按这一项返回路径：`` redDot: it => `sign.day${it.day}` ``。按钮、标签的类型上能写 `view`，按钮的类型上能写 `selected`。
- 代码补间：View、PartView 里的 `this.tween(目标, 终值, 选项)`、`this.stopTweens(目标?, { complete? })`、`this.itemsOf(列表)`。
  - 属性：`dx`、`dy`、`scale`、`scaleX`、`scaleY`、`rotation`、`alpha`、`width`、`height`、`color`、`fontSize`、`fillAmount`、`progress`、`chars`（打字机，富文本标签整段带上）。
  - 选项：`duration`（必填）、`ease`（31 个，写法同 XML，默认 `Quad.Out`）、`delay`（目标是数组时可按序号）、`from`、`repeat`、`yoyo`。Promise 放完才 resolve。
  - 跟着界面走：被盖住暂停（`delay` 也停），关闭时全部停掉、还原碰过的属性，旋转、换语言重建后按路径接着走，列表 `items` 变了子项上的补间跳到终值。补间结束后控件被关联挪过，下一次补间和关闭还原按新原位算。
  - 一个属性一个主人：和齿轮、正在放的 `ui/` 动效、`downEffect`、绑定的 `progress` / `holdProgress`、`roll` 抢同一个属性报 `LGUI-RT-282`；补缩放、旋转时轴心是 (0, 0) 报 `LGUI-RT-283`；参数不对 `LGUI-RT-280`，目标不对 `LGUI-RT-281`。
- 绑定表新词：`roll: { duration, ease? }`（配 `text` 或 `progress`，数值从旧值平滑滚到新值）、`tick: 毫秒`（定时重算显示值，被盖住时不算、露出来马上算一次，配倒计时用）。写错报 `LGUI-RT-284`。
- 正式构建里补间、`roll`、`tick`、`itemsOf`、`format.duration` 写错只记 `error` 日志、这次不生效，不从 `Model.set` 抛进 Controller。
- 测试：`t.look(路径)` 读控件现在的样子（`dx`、`dy`、缩放、旋转、透明度、尺寸、颜色、字号、填充）。
- 项目字体：字体文件放 `ui/fonts/<名字>.ttf` 或 `.otf`，文件名就是字体名（大写字母开头、只用字母和数字）；`defaultFont`、XML 的 `font`、富文本的 `[font=…]` 写这个名字。
  - 自动精简：字集是 ASCII 可见字符、`ui/` 里的全部文字、`i18n/` 全部语言的文案、框架自己显示的固定文字；字体里没有的字不收。
  - 缺字：静态文字里有字体没有的字报 `LGUI-CLI-141`，列出是哪些字、在哪个文件或文本键；按显示它的那个控件的字体查（按钮、标签、下拉框、列表项的标题看组件里的 `title` 文字控件），表情符号同样报。多语言工程的默认字体要覆盖所有语言。
  - 字体文件用不了报 `LGUI-CLI-140`：文件名不合规或和 CSS 通用字体名撞名（`Serif`、`Default` 等）、同名、TTC / WOFF / WOFF2、内容不是 TTF / OTF（包括空文件、被截断）、可变字体等。
  - 运行时才知道的文字（玩家名、服务器数据、输入框）里子集外的字按字回退到系统字体，不报错。
  - headless 只记下字体名，文字度量照旧报 `LGUI-RT-260`。

**网页端**

- `autoSize="shrink"` 实现了：规则同 Unity（单行按宽度、多行按整数字号缩，只缩不放大），按字面加描边算宽度，缩完字和描边都在框里；浏览器给不出 Canvas 2D 时报 `LGUI-RT-232`。
- `downEffect="scale"` 的按压不再改布局：轴心保持 XML 里的，按下只缩元素的样子，按钮跟兄弟控件一起拉宽时不再往左跑，也能和按钮自己的缩放动效叠加。
- 界面里的控件离开舞台再回来（比如显示齿轮藏起来又显示）时，动效暂停、接着放，不再停在当前帧。
- 不透明九宫格在 Chrome、Edge、安卓 WebView 分数缩放下的接缝细线去掉了；半透明、平铺的照旧。
- 项目字体在创建任何界面之前用 `FontFace` 加载，失败报 `LGUI-RT-180`（写明地址和原因），不悄悄换成系统字体。部署网页时 `ui/fonts/` 要和界面包一起发布。
- FairyGUI-dom 的补丁大部分改成启动时挂上，上游文件不改；框架副本被改坏、挂不上时启动报 `LGUI-RT-230` / `LGUI-RT-231`，用 `lgui upgrade` 换回插件带的框架。

**Unity**

- 剪贴板走 Unity 包的 `LGUI.Platform.ClipboardGet()` / `ClipboardSet(text)`（系统剪贴板），`link.xml` 保留需要的类型；出错报 `LGUI-RT-241`。
- 按钮按下效果由框架带缓动地缩放，关掉 FairyGUI 自己的按下缩放，和网页一致。
- 代码补间读 FairyGUI-unity 的齿轮、按钮、动效信息，读不到报 `LGUI-RT-286`。
- 项目字体用 TextMesh Pro：启动时用导出的精简字体建动态 TMP 字体（字第一次出现时才画进图集，满了自动开新图集），按字体名注册，`defaultFont` 和 XML 的 `font` 照旧按名字找；注册不了报 `LGUI-RT-181`。
- 子集外的字（聊天、玩家名）由系统字体回退：依次找 PingFang SC、Noto Sans CJK SC、Noto Sans SC、Source Han Sans SC、Microsoft YaHei、Droid Sans Fallback、WenQuanYi Micro Hei。一个都没找到记一次 `LGUI-RT-182`（`error` 日志，不抛错），缺的字显示方框。
- 跨包图片所在的包随 `unity export` 一起导出。

**编辑器**

- 跨包图片能读、能存（以前读进来就丢 `pkg`，整个工程存不了）。
- 「发布设置」里没写的图集上限显示 4096，点确定写回 4096，和 LGUI 一致（以前显示并写回 2048）；用全局设置的包显示全局上限。

**规范和技能**

- ui-spec：跨包图片写法；XML 属性 `bold`、`strokeColor`、`strokeSize`、`shadowColor`、`shadowOffset`、`downEffect`、`downEffectValue`、`<publish maxAtlasSize>`；新增「art cut 对输入图的要求」；字体（第 8 节）；规则表加 066–069、080。
- mvc-spec：headless 支持什么、什么时候用 `--browser`（第 12 节）；`roll`、`tick`、`format.compact`、`format.duration`、剪贴板；新增第 16 节「代码补间」。
- `lgui-ui` 技能的动效参考加「`ui/` 动效和代码补间的分工」；`lgui-code`、`lgui-verify` 技能和工程模板跟上 `lgui test` 的新用法。

**新错误码**

- CLI
  - `LGUI-CLI-111`：`art cut` 统一缩放后有物件缩得不到尺寸的一半。
  - `LGUI-CLI-112`：`art cut` 要替换的九宫格图，名字文件没写 `9grid`。
  - `LGUI-CLI-113`：图片比图集上限大，或一个包的图太多，打不进图集。
  - `LGUI-CLI-114`：`lgui verify --params` 不是 JSON 对象，或没和 `--view` 一起用。
  - `LGUI-CLI-115`：`lgui verify --view` 打开界面出错。
  - `LGUI-CLI-116`：`devWatch` 里的路径不存在。
  - `LGUI-CLI-130`：`lgui test` 指定的文件或目录不存在、不在 `tests/` 里或不是测试文件。
  - `LGUI-CLI-131`：`lgui test --name` 一个测试也没匹配到。
  - `LGUI-CLI-132`：`lgui test --browser` 没找到 Chrome 或 Edge。
  - `LGUI-CLI-140`：`ui/fonts/` 里的字体文件用不了。
  - `LGUI-CLI-141`：静态文字里有字体没有的字。
  - `LGUI-CLI-142`：`defaultFont` 不是 `ui/fonts/` 里的字体。
- RT
  - `LGUI-RT-180`：网页端项目字体加载失败。
  - `LGUI-RT-181`：Unity 注册不了项目字体（文件不在、TMP 建不成，或 Unity 包是旧版）。
  - `LGUI-RT-182`：Unity 上一个候选系统字体都没找到。
  - `LGUI-RT-230`：网页端 FairyGUI-dom 补丁要挂的方法、属性或字段不在了。
  - `LGUI-RT-231`：网页端补丁要加的方法上游已经有同名的。
  - `LGUI-RT-232`：网页端量 shrink 文字时浏览器给不出 Canvas 2D。
  - `LGUI-RT-240`：已打开的界面用不同参数再次打开。
  - `LGUI-RT-241`：剪贴板读写失败。
  - `LGUI-RT-242`：`selected` 绑在普通按钮上。
  - `LGUI-RT-260`：headless 给不出网页上的值（布局、自动大小、改属性的齿轮决定的）。
  - `LGUI-RT-261`：不能滚动的列表设成了虚拟列表。
  - `LGUI-RT-262`：`t.text` 读的按钮或标签没有 `title` 子控件。
  - `LGUI-RT-263`：`lgui test --browser` 不支持的写法。
  - `LGUI-RT-280`：补间参数不对。
  - `LGUI-RT-281`：补间目标不对，或 `itemsOf` 用在虚拟列表上。
  - `LGUI-RT-282`：补间的属性还有别的主人。
  - `LGUI-RT-283`：补缩放或旋转时控件轴心是 (0, 0)。
  - `LGUI-RT-284`：绑定的 `roll` / `tick` 写法不对。
  - `LGUI-RT-285`：`format.duration` 的写法不是 `'clock'` 或 `'units'`。
  - `LGUI-RT-286`：Unity 上补间读不到 FairyGUI-unity 的内部信息。
- UI
  - `LGUI-UI-066`：写了标题或选项，组件里没有名为 `title` 的子控件。
  - `LGUI-UI-067`：动效里旋转、缩放的控件没设轴心。
  - `LGUI-UI-068`：`shrink` / `ellipsis` 的文字框只放得下一行，没写 `singleLine="true"`。
  - `LGUI-UI-069`：动效的目标是普通组。
  - `LGUI-UI-080`：`font`、`[font=…]` 不是 `ui/fonts/` 里的字体。
- MVC：无。

**已知限制**

- Unity 端新加的 C#（TMP 字体、代码补间、剪贴板等）还没在 Unity 里编译和验收。
- Unity 端不支持表情符号。
- Unity 出微信小游戏或 WebGL 时读不到系统字体，子集外的字没有回退，要在 `ui/fonts/` 里带一个常用字字体。
- `lgui verify --lang pseudo` 的伪翻译字符、`format.number` / `date` / `currency` 走 Intl 时出现的非 ASCII 符号（比如 `¥`）不在字体子集里，会按系统字体显示。
- 只用 `[font=X]` 包起来的那段文字，缺字按控件的字体查，不按 `X` 查。
- 编辑器里看到的是回退字体，不是项目字体。
- Unity 上字第一次出现时要现画进 TMP 图集，一次出很多新字的界面要在真机上看耗时。

## 0.3.0

和 0.2.0 不兼容：目录结构、命令行、框架都是新的。0.2.0 的全部内容在 tag `v0.2.0-final` 里。

**许可**

- 许可从 MIT 改成 PolyForm Shield 1.0.0，另加 LumioGames 的附加许可和商标说明（见 `LICENSE`）。可以用 LGUI 做游戏、应用、网站，包括商业产品；不能拿它或改过的版本做 UI 框架、UI 工具、UI 编辑器、游戏开发工具这类竞品，也不能改名换皮重新发布。LGUI、Lumio、LumioGames 的名字和图标不在授权里。换许可之前按 MIT 发布的提交和版本仍按 MIT。

**安装和工程**

- 发布面只有 `plugin/`；Claude Code、Codex 用仓库里的 marketplace 安装，其他客户端直接用 `plugin/` 目录。
- 用户机器上只需要 Node 24 或更高和 Chrome / Edge；TypeScript、esbuild、OpenFairyGUI 0.7.0、sharp、playwright-core 随插件提供（macOS arm64 / x64、Linux x64、Windows x64）。
- 用户工程：`ui/`（FairyGUI 格式，界面的唯一来源）、`src/`、`tests/`、`i18n/`、`.lgui/`（工程配置、框架副本、生成物）。

**命令行（`node <插件目录>/tools/lgui.mjs`）**

- `init`、`doctor`、`dev`（改动后自动刷新）、`check`（TypeScript + UI / MVC / 多语言规则）、`test`（headless 后端、假时钟；测试文件没跑起来也算失败）、`verify`（6 组尺寸 × 横竖，`--lang`、伪翻译）、`ui list`、`new module`、`new view`（四种排布模式）、`i18n extract`、`art split`、`art cut`、`upgrade`、`editor`、`editor props`、`unity export --to <Unity 工程>`。
- 所有命令支持 `--json`；错误都带错误码（`LGUI-CLI-xxx`、`LGUI-RT-xxx`、`LGUI-UI-xxx`、`LGUI-MVC-xxx`），见 `references/error-codes.md`。报错里的文件一律写相对工程根目录、用 `/` 的路径。
- `check` 的规则：MVC-001 不再误报工程里自己声明的 `location`、`window` 这类同名变量和参数；只有 View 的 `keys` 表里的 `hint` 算文本键；没写 `fontSize` 的文字按默认 12 号查 UI-011；UI-017 也查装载器的 `url` 和按钮的 `icon`；UI-020 同包引用不再警告。新规则：gearText 里写了用户能看到的文字（UI-060）、按钮直接绑控制器（UI-061）、翻译和原文一字不差（UI-062，警告）、横竖两版的固定文字不一样（UI-063，警告）、全屏界面没有 `safe`（UI-064）、音效不存在、没登记或不是 mp3（UI-065）、View 里直接改控件属性（MVC-020，警告）。
- `verify`：同一个画面只截一次（默认 8 张）；按尺寸的 `safeArea` 模拟刘海。
- `new module`：Model 和子项的代码里不写死文字，用文本键并补进文本表；全屏排布模式的骨架带 `safe`，贴边的控件关联到它。
- `art cut`：把 AI 生成的一页图集拆成小图——按透明区域找物件（物件漂过格线也能找对，闪光碎片并进旁边的物件，杂点丢掉），按从上到下、每行从左到右对上名字（`EMPTY` 跳过），数量对不上报错并列出找到的物件；裁掉空白后整页用同一个缩放比例放进各自的尺寸（名字文件里每项可以写自己的尺寸；写 `fit` 的九宫格 / 平铺图单独缩放，不拉伸的方向正好等于尺寸；写 `pkg=` 的存进别的包，一页图可以分给几个包）；去掉半透明边缘的白边；拉伸图重拼成「两端 + 中间 1 像素」并写 `scale9grid`，平铺图检查左右接缝；每页出一张检查图。新错误码 `LGUI-CLI-085`、`LGUI-CLI-086`。

**框架**

- MVC：`lgui.Model` + `pick`、View / ItemView / PartView 和绑定表、Controller、Service、`lgui.request`。
- UIManager：hud、page、popup、modal（队列）、toast 五层，激活和遮挡，`onClose` 交回结果，资源引用计数和关闭界面缓存。
- 横竖屏：按方向自动换 `@portrait` 版本，View 实例保留。
- UIManager 的边界情况：modal 按打开的先后排队，前一个打开失败或被取消时照常放出下一个，loading 不参与排队；`lgui.confirm` 一次显示一个，总会有结果（被取消当 `false`）；`popTo`、`closeAll` 最后只重算一次激活；返回键不关 `hud` 层；对打开着的界面再登记 `onClose` 报 `LGUI-RT-084`。
- 旋转、换语言重建时 PartView 实例保留，通用弹窗的文字换成新语言；安全区：全屏界面的 `safe` 子控件摆进安全区，弹窗放在安全区正中，测试用 `t.setSafeArea`。
- 输入：手势（点击、双击、长按、拖拽、滑动、双指缩放、滚轮、悬停）、按键动作、返回键、操作提示栏、输入类型。
- 动效：动效名当绑定表的键（`playing`、`play`、`done`），`ui/` 里的自动播放照旧；被全屏界面盖住时暂停，界面关闭时停掉；headless 按 `ui/` 里写的时长走假时钟。
- 拖放（游戏式）：`dragData`、`dragIcon`、`drop`；拖起时有跟手的临时图标，松在 `drop` 上才调用 Controller；测试用 `t.dragTo(从哪, 到哪)`。
- 多语言：`lgui.t`、复数、格式化、运行时切换语言、带字图片、伪翻译。
- 定时器（跟着界面暂停和取消；回调出错时照常报错，不影响别的定时器和以后的帧）、广播站、红点、按钮音效、图片占位、通用弹窗（提示、确认、加载中）、ArtText 美术字、`lgui.time.wait`。
- 后端：h5（FairyGUI-dom，带补丁）、headless（测试用）、Unity（FairyGUI-unity + PuerTS）；共享一致性用例和快照捕获器。
- 控件：标签、滑动条（`value` + `change`）、下拉框（`items` / `selected` / `select`）、序列帧动画（`playing`）、树（和列表同样的词）；输入框加 `input`（输入法选字时不触发）；测试加 `t.type`、`t.setValue`、`t.choose`、`t.value`、`t.playing`。
- headless 模拟显示齿轮（`gearDisplay`、`gearDisplay2`）和组，`t.visible` 在两个后端上都是「真的显示」；`wheel` 只认落在这个控件上的滚动；网页端不可用的控件在 FairyGUI 重新挂元素以后仍然点不到。
- 报错分三类：代码或界面写错了 → 抛错并记 `error`（开发和测试里抛，正式构建里只记日志、界面照常显示）；外部失败 → 不抛，交回给代码，记 `warn`；正常的先后顺序 → 记 `info`。缺文本键、加载器的图片包没加载、ArtText 缺字符、没有 `Common/ActionHintBar`、没配 `i18nBase` 就换语言都不再默默跳过；`lgui test` 里记了 `error` 日志的测试判失败。开发模式由打包时的 `LGUI_DEV` 决定。
- `lgui.log`（`debug` / `info` / `warn` / `error` / `child`，形状和 Lumio 引擎的 `Logger` 一样）；`lgui.app({ platform: { log, audio } })` 只换给出的平台服务。
- 界面声音：View 的 `static music`（栈里最上面写了的界面决定，同一首接着放，换曲淡入淡出，切到后台暂停，解锁后才放）、`ui/` 里按钮的音效（`volume="0"` 不出声，没写用 `sounds.click`）、`lgui.sound.play`、音乐和音效两个声道的音量和静音（`lgui.sound.settings` 能用 `pick` 读，自动存进本地存储）；mp3 登记在 `ui/` 的包里，网页界面包带上它们；测试里 `t.sounds()`、`t.music()`。
- `lgui.time.wait` 和请求超时用同一个按帧等待。
- 界面被盖住时，里面的部件（PartView）和列表子项（ItemView）的定时器也暂停，露出来接着走。
- 下拉框弹出的列表可以放在别的包里：生成包依赖时算上 `dropdown` 指向的包。
- `lgui i18n extract` 也提取标签的固定标题和下拉框的固定选项（`<控件名>@item<j>`）；headless 换语言时选项跟着翻译。
- 一致性测试：网页一侧接上 `t.dragTo`、`t.setSafeArea`，加了拖放用例；Unity 开发运行器接上 `t.dragTo`、`t.setValue`、`t.choose`。
- Unity 开发一致性运行器接上 `t.type`：聚焦后全选、逐字输入和退格清空；中文输入法选字过程未覆盖。
- H5 手势保留 DOM 输入实际发生的时间，避免主线程延迟把慢拖误成快滑；浏览器一致性测试按指定坐标和真实间隔派发触摸，不逐步等待驱动应答，不让应答迟到拉长动作。

**Unity**

- Unity 开发一致性运行器接上 `t.setSafeArea`：注入屏幕像素边距，下一帧通知界面重排，未注入时使用宿主安全区。
- Unity 6000.6.x + PuerTS Core/V8 3.0.3 本地包。`unity export` 核对固定文件摘要，应用四处 Unity 6.6 兼容补丁，安装 Unity 包并生成启动场景；已有场景保留。
- 同一份 `ui/`、`src/`、`i18n/` 生成 Unity 界面包、图集、翻译和 `game.js.txt`，放入 `Assets/LGUI/Resources/`；同时导出 `Assets/LGUI/link.xml` 保留动态调用。`upgrade` 同步已配置的 Unity 包。
- Unity 适配层连接控件、列表、控制器、动效、原始输入和平台服务；图片请求共享和释放跟随宿主、控件生命周期。WebSocket 暂未实现，明确报告 `LGUI-RT-001`。
- 生成 UI 图集由包内 Editor 导入器关闭 mipmap，范围限定为有对应界面包的 LGUI 图集。
- 修复 ArtText 改字后旧字符图片未释放、Unity 父界面递归销毁后子容器仍被记录；列表写入不同滚动目标时同步提交，避免旧惯性覆盖重建前的位置；普通 modal 并发申请按 FIFO 排队，前项失败或取消不会阻塞后项。
- Unity HTTP 启动的同步失败明确结束 Fetch、图片和音频请求；宿主关闭后的旧回调隔离。背包示例的领奖图标通过真实 PartView 组件声明图片包依赖，确认弹窗保留文本键与参数以随语言重建。
- Unity 适配层跟上本版的新接口：标签、滑动条、下拉框、序列帧动画、树，动效的 `playing` / `play` / `done`，拖放落点、滚轮只认落在控件上的事件、`t.visible` 的「真的显示」；日志出口和引擎的 `Logger` 同形；声音由 `LGUI.Platform` 自己的 AudioSource 放（背景音乐淡入淡出、暂停），关掉 FairyGUI 自己的按钮音和动效音，和网页一致。功能、快照和可视像素按实际用例分别验收。
- IL2CPP 使用 PuerTS Reflection Mode 生成必需原生桥，不依赖类型静态 wrapper。Unity 接入文档和技能包含本地安装、导出、Release 打包、横竖屏检查及错误处理。

**编辑器**

- `plugin/editor/`：FairyGUI Editor Online 编译版，换成 LGUI 品牌；`lgui editor` 打开它并提供实时会话中转，每次打开都从 `ui/` 重新读取（不含 `art-src/`）；`lgui editor props` 在编辑器开着时改控件属性。
- `lgui editor` 用固定端口（工程配置 `editorPort`，默认 4174，被占用时报 `LGUI-CLI-110`），浏览器记得住授权过的 `ui/` 文件夹；中转只转发 `query` 和 `transact`；中转和 `lgui dev` 的服务都只认 Host 是 `127.0.0.1:<端口>` 的请求。

**规范和技能**

- `references/`：UI 开发规范、MVC 开发规范、用户工程目录、错误码、接入 Unity。
- 技能：`lgui-setup`、`lgui-ui`、`lgui-code`、`lgui-verify`、`lgui-unity`。

**示例**

- `examples/inventory/`：用新框架重写的背包示例（营地、背包、商店、领奖），用到框架的每一项功能。
- 背包示例的普通按钮默认播放程序合成的短点击音（`Common/click.mp3`），网页和 Unity 使用同一份资源。
- 背包示例的网页版发布在 GitHub Pages：https://lumiogames.github.io/LGUI/ 。仓库的 `scripts/build-demo.mjs` 做静态正式构建，`.github/workflows/pages.yml` 在 main 更新时部署。为此 `lgui dev` 生成的页面改用相对路径（`./app.js`、`./ui`、`./i18n`），自动刷新只在 `lgui dev` 里加；正式构建不挂调试面板用的 `window.__lgui`。
- 网页后端在 Safari 里打不开的问题：FairyGUI-dom 用的扩展内置元素（`extends: "div"`）WebKit 不支持，iPhone 上所有浏览器（包括微信）和 Mac 上的 Safari 都报 `ele.init is not a function`。改成独立自定义元素（补丁 5，见 `framework/backends/h5/vendor/PATCHES.md`）。
