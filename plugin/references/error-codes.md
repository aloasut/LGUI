# 错误码

LGUI 的每条报错都带错误码，并写明：哪个文件哪一行（如果有）、出了什么问题、下一步怎么改。

| 前缀 | 来自 | 说明 |
|---|---|---|
| `LGUI-CLI-xxx` | 命令行 | 见下表 |
| `LGUI-RT-xxx` | 运行时 | 见下表 |
| `LGUI-UI-xxx` | UI 开发规范的检查规则 | 见 [ui-spec.md](ui-spec.md) 第 13 节 |
| `LGUI-MVC-xxx` | MVC 开发规范的检查规则 | 见 [mvc-spec.md](mvc-spec.md) 第 13 节 |

## LGUI-CLI-xxx

| 错误码 | 什么时候出现 | 怎么改 |
|---|---|---|
| `LGUI-CLI-000` | 这条命令还没实现（开发中的功能） | 换一条已经实现的命令，或者等新版本 |
| `LGUI-CLI-001` | 没有这条命令 | 看报错里列出的全部命令，或者运行不带参数的 `lgui` |
| `LGUI-CLI-002` | 当前目录往上都找不到 `.lgui/project.json`，不在 LGUI 工程里 | 先运行 `lgui init`，或者 cd 到工程目录里 |
| `LGUI-CLI-003` | 工程里的框架版本（`lguiVersion`）或 Unity 工程里的 LGUI 包版本和插件版本不一致 | 运行 `lgui upgrade`；框架已同版时也会更新旧的 Unity 包 |
| `LGUI-CLI-004` | `.lgui/project.json` 读不了，或者字段缺了、类型不对、多了不认识的字段 | 按 `project-layout.md` 的字段表改 |
| `LGUI-CLI-005` | 当前平台不受支持。随插件带的 esbuild 和 sharp 只有 macOS arm64、macOS x64、Linux x64（glibc）、Windows x64 这 4 个平台的版本；Linux musl、Linux arm64、Windows arm64 都不支持 | 换到上面 4 个平台之一运行 |
| `LGUI-CLI-006` | 命令的参数不对：不认识的参数、开关带了值、要值的参数没给值 | 看报错里列出的能用的参数 |
| `LGUI-CLI-010` | `lgui init` 的目标目录已经存在而且不是空的（不会覆盖） | 换一个新目录，或者先清空 |
| `LGUI-CLI-011` | 插件里缺少要复制进工程的框架文件 | 插件不完整，重新安装 LGUI 插件 |
| `LGUI-CLI-020` | `ui/UI.fairy` 找不到，或者 OpenFairyGUI 校验界面工程没通过（报错里逐条列出 OpenFairyGUI 给的问题） | 按提示改 `ui/` 里对应的文件 |
| `LGUI-CLI-021` | 生成界面包时缺文件：OpenFairyGUI 没生成某个包，或者 `package.xml` 里登记的图片文件不存在 | 把图片放回 `package.xml` 写的位置，或者删掉这条资源 |
| `LGUI-CLI-030` | `lgui dev` 的端口已经被占用 | 在 `.lgui/project.json` 里改 `devPort`，或者加 `--port <端口>` |
| `LGUI-CLI-031` | 缺少某种语言的文本表，或者文本表不是合法的 JSON | 新建或修好 `i18n/<语言>.json` |
| `LGUI-CLI-032` | 打包 `src/` 失败（语法错误、找不到 import 的文件等），带文件和行号 | 按提示改代码 |
| `LGUI-CLI-040` | `tests/` 里没有测试文件（`*.test.ts`） | 在 `tests/` 下写测试，写法见 mvc-spec.md 第 12 节 |
| `LGUI-CLI-041` | 测试没通过（报错里附上测试结束时的界面状态快照） | 看测试输出，按断言改代码或测试 |
| `LGUI-CLI-050` | `lgui check` 读不了 `tsconfig.json` | 用 `lgui init` 生成的 `tsconfig.json`，不要改它 |
| `LGUI-CLI-051` | Unity 工程缺少 embedded 的 PuerTS Core/V8 3.0.3 本地包、使用了目录链接或包缓存，或者 C++ 补丁目标摘要不可信 | 将官方 Core/V8 压缩包解压到工程的 `Packages/com.tencent.puerts.core/` 和 `Packages/com.tencent.puerts.v8/`；保留自己的修改后恢复官方原文件再导出 |
| `LGUI-CLI-052` | 导出目标不是 Unity 6000.6.x 工程、管理路径使用了文件/目录链接，或目标条目的文件/目录类型不对 | 使用 Unity 6000.6 创建的工程根目录；管理路径使用实际目录和文件，移走同名的错误类型条目 |
| `LGUI-CLI-053` | 导出目标不是 Cocos Creator 3.8.x 工程，或缺少 fairygui-cc@1.2.2 依赖 | 用 Cocos Creator 3.8 创建工程；在目标工程里 `npm install fairygui-cc@1.2.2` 后再导出 |
| `LGUI-CLI-054` | cocos export 的管理路径使用了文件/目录链接、路径逃出工程，或目标条目的文件/目录类型不对 | 管理路径使用实际目录和文件，移走同名的错误类型条目 |
| `TSxxxx` | `lgui check` 报的 TypeScript 类型错误（错误码是 TypeScript 自己的） | 按提示改；控件名和类型以 `lgui ui list` 为准 |
| `LGUI-CLI-060` | `lgui verify` 没找到 Chrome 或 Edge | 装一个 Chrome 或 Edge |
| `LGUI-CLI-061` | `--size` 写的验证尺寸不存在 | 用工程配置 `verifySizes` 里的名字 |
| `LGUI-CLI-062` | `--lang` 写的语言工程不支持 | 用 `languages` 里的语言，或者 `pseudo` |
| `LGUI-CLI-063` | `--view` 写的 View 在 `src/modules/` 里没有导出 | 写 View 的类名 |
| `LGUI-CLI-064` | 截图时页面报错 | 按报错改代码；`lgui dev` 里能看到同样的错误 |
| `LGUI-CLI-070` | Node 版本低于 24 | 安装 Node 24（推荐 24.22.1） |
| `LGUI-CLI-072` | 随插件带的工具加载失败 | 插件不完整，重新安装 LGUI 插件 |
| `LGUI-CLI-073` | 没找到 Chrome 或 Edge | 装一个 Chrome 或 Edge |
| `LGUI-CLI-074` | 工程的 `devPort` 被占用 | 改 `devPort`，或者 `lgui dev --port <端口>` |
| `LGUI-CLI-080` | `lgui art split` / `lgui art cut` 的参数不对（大图找不到、`--grid` / `--size` / `--scale` 写法不对、缺 `--pkg` / `--names`、名字不合规范、名字文件里的尺寸 / `9grid` / `tile` 写法不对） | 照用法写：`lgui art split <大图> --grid 6x4 --size 128x128 --pkg <包> --names <名字>`；`lgui art cut` 的名字文件写法见 ui-spec.md 第 5 节 |
| `LGUI-CLI-081` | 名字的数量和格子数（`art cut`：找到的物件数）不一样，或者名字重复 | 每格一个不同的名字，按从左到右、从上到下；`art cut` 报错里列出了找到的物件，碎片用 `--gap` 并进去、杂点用 `--speck` 丢掉、空格子写 `EMPTY` |
| `LGUI-CLI-082` | 要写的图片已经存在（不会覆盖）：`art split` 的同名图片；`art cut` 的同名文件在包目录里、但没登记进 `package.xml`（登记过的同名图片会被替换，资源 ID 不变）；原图在 `ui/art-src/` 里已经有同名的 | 换名字，或者先删掉旧图片；`art cut` 把文件登记进 `package.xml` 再拆就是替换 |
| `LGUI-CLI-083` | `--pkg`（或 `art cut` 名字文件里的 `pkg=`）写的包不存在 | 写一个已有的包名 |
| `LGUI-CLI-084` | 读不了大图 | 用 PNG 或 JPG（`art cut` 要透明底的 PNG） |
| `LGUI-CLI-085` | `lgui art cut` 规整不了：按 `--scale` 缩放后放不进导出尺寸、比九宫格边距还小，或者整页没有固定尺寸的方向算不出缩放比例 | 去掉 `--scale` 自动算或改小；九宫格边距按导出尺寸写；全是九宫格的页写 `--scale` |
| `LGUI-CLI-086` | `lgui art cut` 的平铺图（`tile`）左右接不上 | 让 AI 重画、要求左右无缝拼接，或者去掉 `tile` 当普通图片用 |
| `LGUI-CLI-090` | 排布模式不存在 | 用 split、tabs、grid、dialog 之一 |
| `LGUI-CLI-091` | 要生成的文件已经存在（不会覆盖） | 换一个名字，或者先删掉旧文件 |
| `LGUI-CLI-092` | 工程里没有 `Common/Button`，排布模式要用它 | 用 `lgui init` 生成的 Common 包 |
| `LGUI-CLI-093` | 名字写法不对（`new view` 要写「包/组件」，`new module` 要写小写开头的英文名） | 照用法写 |
| `LGUI-CLI-100` | 编辑器没开，或者编辑器页面没连上（`lgui editor props`） | 先在工程目录运行 `lgui editor`，等编辑器页面打开 |
| `LGUI-CLI-101` | `lgui editor props` 的参数不对（属性名、值的写法） | 照用法写：`lgui editor props <组件> <控件> <属性>=<值> ...` |
| `LGUI-CLI-102` | 组件或控件不存在（`ui/` 里没有，或者编辑器里打开的不是本工程的 `ui/`） | 用 `lgui ui list` 查名字；在编辑器里导入本工程的 `ui/` 文件夹 |
| `LGUI-CLI-103` | 编辑器拒绝了查询或修改 | 按编辑器的提示改；内容刚变过就再运行一次 |
| `LGUI-CLI-104` | 插件里没有编辑器文件 | 重新安装插件 |
| `LGUI-CLI-110` | `lgui editor` 的端口（工程配置 `editorPort`，默认 4174）已经被占用，常见原因是另一个 `lgui editor` 还开着 | 先关掉占用它的程序；要换端口就改 `editorPort`（换了端口，浏览器要重新授权 `ui/` 文件夹） |
| `LGUI-CLI-111` | `lgui art cut` 整页用同一个比例缩放后，有物件在不拉伸的方向上都不到尺寸的一半（同一页里画的比例差太多，图标会悄悄变得很小） | 让 AI 按同一个比例重画；或者把尺寸差得多的物件分到另一页单独拆；尺寸写错了就改名字文件里的 `宽x高` |
| `LGUI-CLI-112` | `lgui art cut` 要替换的图片原来登记成九宫格，名字文件里这一项没写 `9grid` | 写上 `9grid=左,上,右,下`（按导出尺寸量）；确实不要九宫格了，先删掉 `package.xml` 里这张图的 `scale` 和 `scale9grid` |
| `LGUI-CLI-113` | 生成界面包时图片打不进图集：有图比所在包的图集上限大（包的 `<publish maxAtlasSize>`；没写就是 `ui/settings/Publish.json` 的 `atlasSetting.maxSize`；都没写是 4096），或者一个包的图太多 | 把图缩到上限以内、大图拆开；确实要这么大，在包的 `package.xml` 里写 `<publish name="包名" maxAtlasSize="8192"/>`（ui-spec.md 第 5 节） |
| `LGUI-CLI-114` | `lgui verify --params` 写法不对：不是 JSON 对象，或者没和 `--view` 一起用 | 写成 `--view BagView --params '{"tab":"equip"}'` |
| `LGUI-CLI-115` | `lgui verify --view` 打开界面时出错（报错里带着原来的错误码） | 界面要参数就用 `--params` 传（字段见 View 的 `static params`）；不然按报错改代码 |
| `LGUI-CLI-116` | 工程配置 `devWatch` 里的路径不存在 | 写相对工程根目录的路径（比如 `../Config`），或者删掉这一项 |
| `LGUI-CLI-130` | `lgui test` 指定的文件或目录不存在、不在 `tests/` 里，或者不是测试文件（`*.test.ts`）、目录里没有测试文件 | 写 `tests/` 里的测试文件或目录（路径按当前目录算），比如 `lgui test tests/bag.test.ts`；不写就跑全部 |
| `LGUI-CLI-131` | `lgui test --name` 一个测试也没匹配到 | `--name` 按测试名（和所在 `describe` 的名字）里的一段文字筛选，区分大小写；不写就跑全部 |
| `LGUI-CLI-132` | `lgui test --browser` 没找到 Chrome 或 Edge | 装一个 Chrome 或 Edge；或者先不加 `--browser`，用 headless 跑 |
| `LGUI-CLI-999` | 命令行内部错误（LGUI 自己的缺陷） | 把输出报告给维护者 |

## LGUI-RT-xxx

运行时的错误分三类（MVC 开发规范第 14.1 节）：代码或界面写错了 → 抛错并记 `error` 日志（正式构建里只记日志，界面照常显示）；外部的东西失败了 → 不抛，失败交回给代码，记 `warn`；正常的先后顺序 → 记 `info`。日志的事件名由错误码得来（`LGUI-RT-090` → `lgui_rt_090`）。

| 错误码 | 什么时候出现 | 怎么改 |
|---|---|---|
| `LGUI-RT-001` | 当前后端或框架还没实现这项功能（开发中） | 换到已经实现的后端，或者先不用这项功能 |
| `LGUI-RT-002` | 创建界面时它所在的界面包还没加载 | 先加载这个包（UIManager 打开界面时会自动加载） |
| `LGUI-RT-003` | 界面包里没有这个组件 | 用 `lgui ui list` 查看有哪些组件 |
| `LGUI-RT-010` | 网页端的散图映射 `manifest.json` 格式不对，或者里面没有某个包、某张图片 | 重新运行 `lgui dev` 生成界面包 |
| `LGUI-RT-011` | 后端加载界面包失败（地址不对或文件不存在） | 确认包名对；网页重新运行 `lgui dev`，Unity 重新导出并确认 `Resources/UI/` 的文件存在 |
| `LGUI-RT-020` | 颜色的格式不对 | 写成 `#rrggbb` |
| `LGUI-RT-021` | 列表设成虚拟列表以后又想改回去 | 在第一次给数据之前决定要不要虚拟列表 |
| `LGUI-RT-022` | 控制器没有这个页名 | 看报错里列出的页名 |
| `LGUI-RT-023` | 把一个不是组件的控件当成组件用 | 检查 `ui/` 里这个控件的类型 |
| `LGUI-RT-024` | 混用了不同后端创建的对象 | 不要混用 |
| `LGUI-RT-025` | 图片加载失败（外部失败） | 确认地址对、文件存在 |
| `LGUI-RT-026` | 声音文件加载失败（外部失败，记 `warn`） | 确认地址对、文件存在 |
| `LGUI-RT-030` | 列表没有设置子项组件（`defaultItem`）就给了数据 | 在 `ui/` 里给列表设置 `defaultItem` |
| `LGUI-RT-031` | 子组件引用的组件不存在 | 在 `ui/` 里修好引用，再重新生成 |
| `LGUI-RT-032` | 测试里点了一个点不到的控件（自己或上级没显示、被齿轮或组藏起来、不可用或不接收输入；文字、图片和序列帧动画本身收不到点击）；`lgui test --browser` 里还做真实的命中测试：控件中心被别的控件挡住、在屏幕外也报 | 检查控件和它所在的界面是不是显示、可用、激活，齿轮藏起来的控件先切到它显示的页；点击和手势绑在按钮、组件、列表或有填充的图形上；被挡住时检查上面盖着的遮罩、弹窗、同级控件 |
| `LGUI-RT-040` | 同一个事件名声明了两次 | 换一个名字，或者 import 已经声明的那个 |
| `LGUI-RT-050` | 框架还没启动就用了需要后端的功能（时间、界面等） | 用 `lgui dev` 预览，或者在测试里先调用 `lgui.testing.start(app)` |
| `LGUI-RT-060` | View 缺少必填的 static（`component`、`layer`），或者值不对 | 照 mvc-spec.md 第 6.2 节写 |
| `LGUI-RT-061` | View 写了 8 项以外的 static（ItemView、PartView 只能写 `component`） | 删掉多出来的 |
| `LGUI-RT-062` | 绑定表的键在组件里找不到（不是控件、控制器，也不是点号路径） | 用 `lgui ui list` 查看真实的名字；改了 `ui/` 要重新生成 |
| `LGUI-RT-063` | 绑定表用了词表以外的词，或者这个词不能用在这种控件上 | 见 mvc-spec.md 第 6.4 节的词表 |
| `LGUI-RT-064` | 列表的 `item`、部件的 `view` 写得不对（缺少、或者对应的组件不一致） | 让 ItemView / PartView 的 `static component` 和 `ui/` 里的组件一致 |
| `LGUI-RT-065` | 界面还没打开或已经关闭时用了 `this.ui` | 只在生命周期钩子里用 `this.ui` |
| `LGUI-RT-070` | 网络图片加载失败，显示占位图（外部失败，记 `warn`） | 确认图片地址对、能访问 |
| `LGUI-RT-071` | 加载器要显示 `ui://包名/图片名`，但那个包没有加载（不是这个界面依赖的包）；写错了，开发和测试里抛错 | 让界面用到那个包的组件（比如列表的 `defaultItem`，或者用那个包里的按钮组件、给它的 `icon` 赋值），打开界面时就会一起加载 |
| `LGUI-RT-080` | 打开界面失败（界面包加载失败、组件不存在、绑定出错等），不会显示打开了一半的界面 | 按报错里的原因改 |
| `LGUI-RT-081` | 界面在打开的过程中（或在 modal 队列里排队时）被关闭了，这次打开已取消 | 一般不需要处理 |
| `LGUI-RT-082` | 关闭一个没有打开的界面（只记 `info` 日志，不算错误） | 不需要处理 |
| `LGUI-RT-083` | `popTo` 的目标界面没有打开 | 先确认它已经打开 |
| `LGUI-RT-084` | 对已经打开（或正在打开）的界面再 `open`，又登记了 `onClose`：这个回调不会被调用 | 先用 `lgui.ui.isOpen` 判断；要知道它什么时候关，在第一次打开时登记 `onClose`，或者收听 `lgui.events.viewClosed` |
| `LGUI-RT-090` | 文本表里没有这个键；写错了，开发和测试里抛错，正式构建里显示键名 | 在每种语言的 `i18n/<语言>.json` 里加上它 |
| `LGUI-RT-100` | `lgui.request` 超时（工程配置 `requestTimeoutMs`，默认 10 秒） | 检查网络；需要更长时间就改配置 |
| `LGUI-RT-101` | `lgui.request` 里的请求失败了（报错里带原因） | 看 Service 返回的错误 |
| `LGUI-RT-102` | 用了没有注册的服务 | 在 `main.ts` 的 `lgui.app({ services })` 里注册；测试里用 `lgui.testing.start(app, { services })` |
| `LGUI-RT-110` | 在 `lgui test` 以外用了 `lgui.testing` | 用 `lgui test` 跑测试 |
| `LGUI-RT-111` | 测试里的控件路径找不到（界面没打开、控件名不对、列表没有这一项） | 用 `lgui ui list` 查看真实路径；路径写成 `包/组件.控件路径`，列表子项写 `list[序号]` |
| `LGUI-RT-112` | 测试结束时（`t.end()`）关掉所有界面后，还有界面或包没清理 | 检查是不是有界面没走 `lgui.ui` 关闭 |
| `LGUI-RT-120` | 红点路径写法不对 | 写成用「.」分隔的英文名，比如 `bag.newItem` |
| `LGUI-RT-130` | ArtText 要显示的字符没有对应的图片（报错里写明是哪个字符）；正式构建里跳过这个字符 | 在字体目录下加上这个字符的图片，登记进 `package.xml` 并导出 |
| `LGUI-RT-140` | 切换到工程不支持的语言 | 在 `.lgui/project.json` 的 `languages` 里加上它，并新建 `i18n/<语言>.json` |
| `LGUI-RT-141` | 后端读不到这种语言的翻译文件，或翻译 XML 无法解析 | 网页重新运行 `lgui dev`；Unity 重新导出并确认 `Resources/UI/i18n/` 下有对应语言的 XML |
| `LGUI-RT-150` | 测试里的改值操作用错了控件：`t.type` 只能用在输入框上，`t.setValue` 只能用在滑动条上，`t.choose` 只能用在下拉框上 | 换成对应控件的路径（`lgui ui list` 里能看到控件类型） |
| `LGUI-RT-151` | `t.choose` 的序号超出了下拉框的项数 | 序号从 0 开始；先确认下拉框的 `items` 已经给好 |
| `LGUI-RT-152` | 树的绑定没写 `key`，或者树里有两个节点的 key 一样 | 写上 `key`（比如 `key: (n: TreeNode) => n.id`），key 在整棵树里要唯一 |
| `LGUI-RT-210` | 动效只写了 `done`，但它不会自动播放，也没写 `playing` 或 `play`，永远放不完 | 加上 `playing` 或 `play`，或者在 `ui/` 里给它勾上自动播放 |
| `LGUI-RT-211` | 动效同时写了 `playing` 和 `play`，或者在 `ItemView` 里写了 `play` | 二选一；`ItemView` 里用 `playing: it => …` |
| `LGUI-RT-220` | 写了 `dragData` 的控件不是加载器或按钮，又没写 `dragIcon`，拖起时没有图标 | 加上 `dragIcon`，或者把 `dragData` 写在加载器、按钮上 |
| `LGUI-RT-221` | 写了 `dragIcon` 但没写 `dragData` | 加上 `dragData`，或者去掉 `dragIcon` |
| `LGUI-RT-230` | 网页端启动时 FairyGUI-dom 补丁装不上：上游没有要挂钩子的方法、属性或字段了（升级了上游，或者改了框架副本里的 `vendor/fairygui.module.js`）。错误里写着补丁编号 | 用户工程：不要改 `.lgui/framework/`，运行 `lgui upgrade` 换回插件带的框架。维护 LGUI：对照 `framework/backends/h5/vendor/PATCHES.md` 里那个编号重看补丁 |
| `LGUI-RT-231` | 网页端启动时 FairyGUI-dom 补丁要加的方法，上游已经有同名的了 | 同 `LGUI-RT-230`；维护 LGUI 时判断上游是否已经实现了同样的功能，决定改用上游的还是去掉这个补丁 |
| `LGUI-RT-232` | 网页端量 `autoSize="shrink"` 文字的宽度时浏览器给不出 Canvas 2D | 换一个支持 Canvas 2D 的浏览器或 WebView |
| `LGUI-RT-240` | 对已经打开（或正在打开）的界面再 `open`，这次的参数和打开时的不同（不会生效，不静默丢掉） | 同一个界面同时只开一个：先用 `lgui.ui.isOpen` 判断，要换内容就改它绑定的 Model；要依次显示好几份（比如几份奖励），在 Controller 里排队，前一个关了再开下一个 |
| `LGUI-RT-241` | 剪贴板读写失败（外部失败）：网页不是 https 或 localhost、浏览器拒绝；Unity 读写系统剪贴板出错，或者 Unity 包不是这一版（`LGUI.Platform` 没有 `ClipboardGet` / `ClipboardSet`） | 网页用 https 或 localhost；写入放在点击动作里直接调用；用 `lgui.request` 包一层，失败时拿到 `{ ok: false }` 并记 `warn` |
| `LGUI-RT-242` | `selected` 绑在普通按钮（Common 模式）上，显示不出选中（绑定时就报） | 在 `ui/` 里把按钮组件的模式改成 Check（开关）或 Radio（单选），或者去掉 `selected` |
| `LGUI-RT-260` | headless 给不出网页上的值：`lgui.ui.find` 要读的位置或尺寸由关联（relation）、列表或组的排布、文字自动大小（`autoSize` 是 both、height）、加载器的自动大小（`autoSize="true"`）、控件或组上的 `gearXY` / `gearSize` 决定；或者要用的文字、颜色、图标（加载器的地址）、可用状态和能不能点由改属性的齿轮（`gearText`、`gearColor`、`gearIcon`、`gearLook`）决定（读它、`t.text` / `t.enabled`、点它都算）。报错里写明是哪个控件、哪个原因，`ui/` 里写的初始值不是网页上的结果 | 要测这些，用 `lgui test --browser` 在真浏览器里跑这个测试；只看样子用 `lgui verify` 截图。改属性的齿轮管着的属性，代码自己写过以后 headless 就知道，直到那个控制器再换页 |
| `LGUI-RT-261` | 列表不能滚动（`ui/` 里没写 `overflow="scroll"`）却设成了虚拟列表（浏览器里 FairyGUI 报 `Virtual list must be scrollable!`，headless 照样报） | 要虚拟列表就给列表写 `overflow="scroll"`（不想显示滚动条再加 `scrollBar="hidden"`）；项数固定的短列表不用虚拟列表 |
| `LGUI-RT-262` | 测试里用 `t.text` 读按钮或标签的文字，但组件里没有名为 `title` 的子控件：文字写进去了也不显示（浏览器里一样） | 在 `ui/` 里给这个组件加一个名为 `title` 的文字控件；要读组件里别的文字，路径写到那个子控件 |
| `LGUI-RT-263` | `lgui test --browser` 不支持的写法：子测试（`t.test`）、`mock`、`done` 回调、`async` 的 `describe`、`t.advance` 一次超过 10 秒（浏览器里是真的等） | 浏览器里的测试只用 `test` / `describe`、`before` / `after` / `beforeEach` / `afterEach` 和 `node:assert/strict`；跨天这类长时间用 `lgui.time.setServerOffset`；必须用这些写法的测试不加 `--browser` |
| `LGUI-RT-264` | 加载界面包时发现同名包已经在页面里，但它不是这个后端加载的（FairyGUI 按包名全局注册，别处——比如另一份 UI 产物的引导或冒烟代码——先加载了同名包，不报的话 `create` 会拿到别家的组件，绑定层随后报「组件里没有这个控件」） | 一个页面只放一套 LGUI 的界面包：找出谁先加载了同名包，别让两份 UI 产物进同一个页面 |
| `LGUI-RT-027` | 后端还没启动就开始用 | 先调用 `backend.init(config)`（框架启动时会自动调用） |
| `LGUI-RT-160` | Unity 启动脚本或 Resources 文本缺失、PuerTS 启动失败、每帧回调或宿主驱动、退出清理失败 | 每帧回调出错时按堆栈修正该回调，其他回调和后续帧继续运行；宿主启动失败时核对导出文件、PuerTS 3.0.3 本地包后重新启动场景 |
| `LGUI-RT-161` | Unity 平台存储、HTTP、音频等服务失败 | 按日志检查存储权限、请求参数、资源地址或本地 PuerTS 环境 |
| `LGUI-RT-170` | 声音地址 `ui://…` 没有登记在 `ui/` 的包里 | 把 mp3 放进包目录，在 `package.xml` 里登记成 `<sound … exported="true"/>`，地址写成 `ui://包名/声音名` |
| `LGUI-RT-171` | ArtText 用的字体所在的包没有加载 | 把 ArtText 放在字体所在包的组件里，或者让界面用到那个包的组件 |
| `LGUI-RT-172` | 没有 Common 包或 `Common/ActionHintBar`，建不了操作提示栏（开发和测试里启动就报；正式构建里不显示提示栏） | 用 `lgui init` 自带的 Common 包，不要删掉 `ActionHintBar` |
| `LGUI-RT-173` | 网页端没配 `i18nBase` 就切换语言 | `backend.init` 时传 `i18nBase`（`lgui dev` 生成的启动入口传的是 `./i18n`） |
| `LGUI-RT-174` | `lgui.sound` 的参数不对：声道不是 `music` / `sfx`，音量不在 0–1，静音不是布尔值，地址是空的 | 照 mvc-spec.md 第 15 节写 |
| `LGUI-RT-175` | 本地存储里的声音设置读不出来，用默认值（外部失败，记 `warn`） | 不需要处理；玩家下次改音量时会重新存 |
| `LGUI-RT-176` | `lgui test` 里这个测试记了 `error` 级的日志（报错里写明是哪条） | 按日志改代码或界面 |
