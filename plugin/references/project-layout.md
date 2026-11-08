# 用户工程目录

用户对 Agent 说"帮我建一个 UI 工程"，Agent 执行 `lgui init`，得到下面的目录。文档里的 `lgui xxx` 都指 `node <插件目录>/tools/lgui.mjs xxx`。

```
MyGame/
├── ui/                        # 界面：FairyGUI 工程，界面资源和预制结构只在这里改
│   ├── UI.fairy               #   工程文件
│   ├── assets/                #   各个界面包（组件 XML、图片）
│   └── art-src/               #   AI 生成的原始大图：只作来源，界面不引用，不进游戏包
├── src/                       # 游戏代码，按 MVC 开发规范写
│   ├── main.ts                #   入口：选后端（默认 h5），启动游戏
│   └── modules/               #   一个功能一个文件夹
│       └── bag/
│           ├── BagModel.ts    #     数据和规则
│           ├── BagView.ts     #     对应 ui/ 里的一个组件，只负责显示和转发事件
│           └── BagController.ts #   处理事件、改数据、调服务
├── tests/                     # 单元测试：用测试后端在 Node 里跑，不需要浏览器
├── i18n/                      # 文本表：每种语言一个 <语言>.json
├── .lgui/                     # LGUI 自己的东西，用户不用管
│   ├── project.json           #   工程配置（字段见下）
│   ├── framework/             #   建工程时从插件复制一份框架进来，锁定版本
│   └── build/                 #   生成物，不手改，不进 git：预览文件、控件类型（types/）、本地连接文件
├── package.json               # 只有工程名称等少量字段，不需要 npm install
└── .gitignore                 # 忽略 .lgui/build/、node_modules/
```

## `.lgui/project.json` 的字段

只有 `name` 和 `lguiVersion` 必填，其余不写就用默认值。写了表里没有的字段、或者类型不对，命令会报 `LGUI-CLI-004`，一次列出全部问题。

| 字段 | 类型 | 默认值 | 用途 |
|---|---|---|---|
| `name` | 非空字符串 | 必填 | 工程名称 |
| `lguiVersion` | 版本号 | 必填 | 工程用的 LGUI 版本；和插件不一致时命令报 `LGUI-CLI-003`，先运行 `lgui upgrade` |
| `designSize` | `{ landscape: {width,height}, portrait: {width,height} }` | 横 1920×1080，竖 1080×1920 | 设计尺寸 |
| `orientation` | `"both"` \| `"landscape"` \| `"portrait"` | `"both"` | 跟随设备旋转，或者锁定一种方向 |
| `verifySizes` | `[{ name, width, height, safeArea? }]` | 6 组，见下 | `lgui verify` 的标准验证尺寸，每组横竖各截一张（同一个画面只截一次） |
| `languages` | 语言代码数组 | `["zh-CN", "en"]` | 支持的语言 |
| `defaultLanguage` | 语言代码 | `"zh-CN"` | 默认语言，必须在 `languages` 里 |
| `keyMap` | `{ <平台>: { <按键名>: <动作名> } }` | `{}` | 按平台改写「按键 → 动作」映射 |
| `uiCache` | `{ keepClosedViews: 非负整数 }` | `{ keepClosedViews: 0 }` | 最近关掉的几个界面不销毁，再打开时直接复用 |
| `requestErrorToast` | 布尔值 | `true` | `lgui.request` 失败时，统一弹出提示 |
| `requestTimeoutMs` | 正整数（毫秒） | `10000` | `lgui.request` 的超时时间 |
| `placeholder` | `ui://` 开头的图片地址 | `"ui://Common/placeholder"` | 默认占位图 |
| `sounds` | `{ click: 音效地址 \| null }` | `{ click: null }` | 按钮的默认点击音效（`ui://<包>/<声音名>`）：`ui/` 里按钮没写音效时用；`null` 表示不放 |
| `defaultFont` | 字体名 \| `null` | `null` | 默认字体，`null` 表示用 FairyGUI 的默认字体 |
| `devPort` | 端口号 1–65535 | `4173` | `lgui dev` 的端口 |
| `devWatch` | 路径数组 | `[]` | `lgui dev` 除了 `ui/`、`src/`、`i18n/` 以外还要监视的目录或文件，相对工程根目录（比如宿主代码、仓库根的 `["../Config"]`），改了就重新打包、刷新页面（不监视 `.lgui/build/`，写成工程根目录也不会自己触发自己）。路径不存在时报 `LGUI-CLI-116` |
| `editorPort` | 端口号 1–65535 | `4174` | `lgui editor` 的端口。浏览器按地址（含端口）记住授权过的 `ui/` 文件夹，所以端口固定；改了端口要在编辑器里重新授权。被占用时报 `LGUI-CLI-110` |
| `backend` | `"h5"` | `"h5"` | 默认后端 |
| `unityProject` | 路径 \| `null` | `null` | 导出过的 Unity 工程路径，由 `lgui unity export` 写入 |
| `cocosProject` | 路径 \| `null` | `null` | 导出过的 Cocos Creator 工程路径，由 `lgui cocos export` 写入 |

默认的 6 组验证尺寸（单位：CSS 像素）：

| `name` | 尺寸 | 安全区（上 右 下 左） | 场景 |
|---|---|---|---|
| `desktop` | 1920×1080 | — | 电脑 16:9 |
| `ultrawide` | 2560×1080 | — | 超宽屏 |
| `phone-landscape` | 844×390 | 0 47 21 47 | 手机横屏（带刘海） |
| `tablet` | 1024×768 | — | 平板 4:3 |
| `phone-portrait` | 390×844 | 47 0 34 0 | 手机竖屏 |
| `tablet-portrait` | 768×1024 | — | 平板竖屏 |

- `lgui verify` 对每组横竖各截一张，但同一个画面只截一次：`phone-landscape` 转成竖屏和 `phone-portrait` 是同一个画面，只留本来就是竖屏的那组（平板同理），所以默认是 8 张。
- `safeArea` 按这组尺寸本来的方向写（单位 CSS 像素）；截图前设好 `window.__lguiSafeArea = { top, right, bottom, left }`，网页后端按它模拟刘海；转到另一个方向截图时，四边跟着转 90°。没写就是 0。

**说明**

- **用户只碰 `ui/`、`src/`、`tests/`、`i18n/`。**
- **框架复制进工程，不走 npm 安装。** 离线可用，版本固定，同一工程在谁的机器上跑都一样。插件和工程的版本不一致时，命令会直接报错，提示运行 `lgui upgrade`。
- **游戏代码的写法。** `src/main.ts` 里 `import` 的是 `lgui`，指向 `.lgui/framework/`；需要的配置由 `lgui init` 生成。游戏代码不出现 `document`、`window`、`CS.` 这类引擎或平台的 API，这一条由 `lgui check` 检查。
- **`src/modules/` 里的细节以 MVC 开发规范为准。** 比如文件怎么命名、服务放在哪里。本节只定到"一个功能一个文件夹"。
- **日常命令。** 预览用 `lgui dev`（打开浏览器，改动后自动刷新），改界面用 `lgui editor`（打开编辑器；在编辑器里授权过 `ui/` 文件夹，保存就写回 `ui/`），检查用 `lgui check`，测试用 `lgui test`。
- **队友和 CI。** 也要装插件，才能运行 `lgui` 命令。

## `import 'lgui'` 怎么生效

全工程只用这一种办法，不需要 `node_modules`，也不需要 import map：

- **类型检查：** `tsconfig.json` 的 `paths` 把 `lgui` 指向 `.lgui/framework/index.ts`，`lgui/ui` 指向 `.lgui/build/types/index.d.ts`（由 `ui/` 生成的控件类型）。
- **网页预览、测试、导出 Unity：** 全部由随插件带的 esbuild 打包，用 esbuild 的 `alias` 把 `lgui` 指向 `.lgui/framework/index.ts`；`lgui/ui` 只有类型，打包时会被去掉。
- 测试文件里可以 `import` 的 Node 模块只有 `node:test` 和 `node:assert/strict`，它们的类型在 `.lgui/framework/env.d.ts`。
