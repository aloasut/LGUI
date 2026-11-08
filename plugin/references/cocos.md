# 接入 Cocos Creator

`lgui cocos export` 将同一份 `ui/`、`src/` 和 `i18n/` 导出给 Cocos Creator。先在网页端完成界面和功能，再接引擎；游戏代码继续只使用 `lgui` 接口，不调用 `cc` 等引擎 API，这一条由 `lgui check` 检查。

本文里的 `lgui` 指 `node "<插件目录>/tools/lgui.mjs"`。在 LGUI 工程根目录运行命令；`--to` 指向已经创建的 Cocos Creator 工程根目录。

## 准备 Cocos Creator 工程

1. 安装 **Cocos Creator 3.8.x**（当前在 3.8.8 上验证），创建空工程（2D 模板即可）。
2. 在工程根目录 `npm install fairygui-cc@1.2.2`（官方运行库，LGUI 不 vendor 这个 npm 包）。工程 `package.json` 里应出现 `"creator": { "version": "3.8.x" }` 和 `"dependencies": { "fairygui-cc": "1.2.2" }`，两者都是导出的校验条件。

LGUI 不自动安装 Cocos Creator 或 npm 依赖，也不触发 Creator 构建；导出是纯文件操作。

## 导出并在 Creator 运行

在 LGUI 工程里执行：

```text
node "<插件目录>/tools/lgui.mjs" check
node "<插件目录>/tools/lgui.mjs" test
node "<插件目录>/tools/lgui.mjs" cocos export --to "<Cocos Creator 工程路径>"
```

导出先在 `.lgui/build/cocos/export/` 完成全部生成（界面包、图集、翻译、框架子集、类型、启动脚本、`src/` 别名重写），全量成功后才替换目标工程里的 LGUI 管理目录；`assets/main.scene` 只在缺失时用模板创建，**已有场景永不覆盖**。导出后 `.lgui/project.json` 记录 `cocosProject`。

```text
<CC 工程>/
└── assets/
    ├── main.scene               # 模板启动场景（缺失才创建；也可以用你自己的场景，Boot 不依赖场景挂载）
    ├── lgui-ui/                 # 界面包 <包名>/<包名>.bin + 图集 + i18n/（各语言翻译 XML）
    ├── lgui-framework/          # 框架 TS 子集（core/mvc/backends/cocos）+ VERSION
    ├── ui-types/                # 生成类型（'lgui/ui' 别名落点，纯类型，运行时擦除）
    ├── lgui-boot/               # Boot.ts（自动启动）+ lgui-config.ts（config/deps/components/texts，生成不手改）
    └── app-src/                 # src/ 的副本，'lgui'/'lgui/ui' 别名按目录深度重写成相对路径
```

在 Cocos Creator 里打开工程即可预览：`assets/lgui-boot/Boot.ts` 在第一个场景加载完自动初始化后端、按当前窗口横竖贴设计尺寸并跟 resize 重贴，然后 `boot` 拉起 `app-src/main.ts` 的界面栈。页面侧 `globalThis.__lgui` 暴露 `lgui.debug.snapshot()` / `lgui.ui` 供控制台调试。无头构建用 Creator CLI：

```text
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator --project "<CC 工程路径>" --build "platform=web-mobile;debug=true"
```

（CLI 构建即便成功也常退出 36——警告走 console.error 就计入退出码；成功与否看「build Task Finished」日志和产物目录。）

## 工程设置要求

- **设计分辨率设成和 `.lgui/project.json` 的 `designSize.landscape` 一致**（默认 1920×1080）：LGUI 的 cocos 后端把引擎设计分辨率跟窗口做 EXACT_FIT、设计适配全权交给内部 stage 缩放；工程初始值只在编辑器预览里当初值，但两套尺寸相差过大时首次校准会有多余的一次 resize。
- **工程依赖的 fairygui-cc 必须是官方 npm 包 1.2.2**；fork 或改版 dist 的类顺序有损坏。
- 用户自己的代码放在上述管理目录（`lgui-ui`、`lgui-framework`、`ui-types`、`lgui-boot`、`app-src`）之外；这些目录整目录替换，不要在里面放自写文件，也不要在 Creator 里改生成内容。界面、代码和翻译回到 `ui/`、`src/`、`i18n/` 修改后重新导出。
- 管理路径必须是实际目录或文件，不能通过目录链接重定向到用户资源（`LGUI-CLI-054`）。

## 与网页端的已知差异

- **输入设备判定以 DOM pointerType 为准**：桌面浏览器鼠标点击不会被判成 touch。绑定表里 `visibleOn: ['touch']` 的元素在鼠标输入下隐藏是设计内行为。
- **滚轮**：增量取 DOM wheel 事件（正 = 向下），与 h5 同值同向。
- **输入框回写**：绑定把 Model 值写回输入框时，聚焦中的框也会更新（cc EditBox 聚焦期间不传播程序化文本，框架直写其 DOM 输入）。
- 一致性运行器（`tests/cocos/run-conformance.mjs`）的 15 个用例与 headless 完整快照深比较相等；输入位接法见该目录 README。

## 常见报错

| 错误码 | 原因和处理 |
| --- | --- |
| `LGUI-CLI-053` | 目标不是 Cocos Creator 3.8.x 工程，或缺 `fairygui-cc@1.2.2`。核对 `--to` 与 `package.json`。 |
| `LGUI-CLI-054` | 管理路径用了链接、逃出工程或类型不对。按报错移走同名条目。 |
| `LGUI-CLI-003` | 已装框架版本和插件不一致。核对 `.lgui/project.json` 的 `cocosProject`，运行 `lgui upgrade` 后重新导出。 |
| `LGUI-CLI-011` | 插件里的 Cocos 工程模板（Boot/场景）缺失。重新安装完整插件。 |
| `LGUI-RT-011` | 界面包 bundle 读不到。确认导出后 Creator 完成了资源导入（assets 下 `.meta` 由 Creator 自动生成）。 |

完整清单见 [error-codes.md](error-codes.md)。
