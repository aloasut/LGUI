# 编译编辑器

`plugin/editor/` 里的编辑器由这里编译生成，不手改。

```bash
node scripts/build-editor/build.mjs
```

需要能访问 GitHub 和 npm 仓库，只在开发机上跑，结果提交进 git。`--source <目录>` 可以复用一个已经克隆好、检出了固定提交的目录。

## 做了什么

1. 克隆 [OpenFairyGUI/FairyGUI-Editor-Online](https://github.com/OpenFairyGUI/FairyGUI-Editor-Online)，检出 `45f0bef93bb16d507552b673ace6d5af417a8a0f`，连同子模块 `vendor/FairyGUI-Editor`（编辑器自己的界面工程）和 `samples/FairyGUI-layabox`。
2. `npm ci`。
3. 打补丁：
   - `patches/agent-session.patch`：实时会话（让 Agent 在编辑器开着时改控件属性）。来自 tag `v0.2.0-final` 的 `patches/editor-online-45f0bef-agent-session.patch`，改动：原来浏览器经 vite 开发服务器的 websocket 收发请求，编译以后没有 vite，改成连 `lgui editor` 提供的同源中转 `/__lgui_editor/`（服务端发请求用 Server-Sent Events，浏览器回结果用同源 POST）；去掉了 vite 插件、中转脚本和只在开发服务器上跑的验证脚本。只在 `127.0.0.1` 上、地址带 `?agent=1` 时启用。
   - `patches/rebrand.patch`（编辑器源码）和 `patches/rebrand-ui.patch`（界面工程，打在子模块 `vendor/FairyGUI-Editor` 里）：换品牌，见下表。
   - `patches/project-reload.patch`：由 `lgui editor` 打开时（`127.0.0.1`、`?agent=1`），每次都从 `/__lgui_editor/project` 读工程的 `ui/` 重新导入，不用浏览器里存的旧副本；已经绑定过的文件夹保留，保存时照样写回 `ui/`。原因见 [CONTRIBUTING.md](../../CONTRIBUTING.md) 的「编辑器实测」。
   - `patches/cross-package-image.patch`：编辑器读写跨包图片（`<image pkg="…" src="…">`）时不丢 `pkg`。改的是编辑器仓库里提交好的后端 `assets/resources/editor/runtime/openfairygui-backend-browser.js`（OpenFairyGUI 0.2.4 打出来的包，vite 原样复制进产物）：读进来（`liftDisplayNode`）时保留图片的 `packageId`，写回去（`materializeDisplayNode`）时写回 `pkg`，去掉「不支持跨包图片」的事务检查（`unsupported_cross_package_image_ref`）。原来读进来就丢了 `pkg`，判定工程「不能无损保存」（`uam_fidelity_unsupported`），整个工程都存不了。跨包子组件写 `fileName` 的情况没改，仍然存不了（`lgui check` 警告 `LGUI-UI-020`）。
   - `patches/atlas-default.patch`：「发布设置」对话框里图集上限的默认值和 LGUI 一致（4096）。上游没写全局 `atlasSetting.maxSize` 时显示 2048，点「确定」就把 2048 写进 `ui/settings/Publish.json`，LGUI 会把它当成用户写的上限（为了改别的发布选项打开过一次，1080×2600 的背景就报 `LGUI-CLI-113`）。改成没写时显示 4096；用全局设置的包显示全局的上限（编辑器后端读包时自己填 2048）。改的是 `src/editor/dialogs/PublishSettingsEditor.ts`，要重新 `vite build`。
   - 用 `brand/logo128.png`（源文件 `brand/logo.svg`）换掉界面工程里的 Logo。
4. 从换过品牌的界面工程重新发布编辑器界面包（`npm run publish:editor-ui`），类型检查，`vite build`。
5. 产物复制到 `plugin/editor/`（去掉 LayaAir 的 `.meta` 文件），连同编辑器原有的 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`TRADEMARKS.md`，再写 `VERSION.md`。
6. 打印 `plugin/editor/` 的大小。

## 品牌出现的位置

编辑器的 `TRADEMARKS.md`：FairyGUI 的名称和 Logo 没有随软件许可授出；衍生项目没有另行授权时，要换掉可能让人误认为官方产品的名称、Logo 和视觉标识；只为说明格式兼容、技术依赖或事实来源而提到 FairyGUI 可以保留，并标明第三方身份。编辑器的界面工程本身可以自由使用（`THIRD_PARTY_NOTICES.md` 引用了上游 README 的说法）。

| 位置 | 原来 | 处理 |
|---|---|---|
| `index.html` 页面标题 | FairyGUI Editor Online | 换成 LGUI Editor |
| `src/Main.ts` 启动面板标题 | FairyGUI Editor Online | 换成 LGUI Editor |
| `src/editor/EditorShell.ts` 帮助菜单 | 关于 FairyGUI 编辑器 | 换成「关于 LGUI 编辑器」 |
| `src/editor/EditorShell.ts` 关于窗口说明 | 基于 OpenFairyGUI 的浏览器版 FairyGUI 编辑器 | 换成「LGUI 编辑器：基于 FairyGUI Editor Online（OpenFairyGUI）修改，读写 FairyGUI 格式的工程。」（来源和格式，属于事实陈述） |
| `src/editor/EditorShell.ts` 关于窗口链接 | GitHub 仓库、FairyGUI 官网 | 换成 LGUI 仓库、上游仓库；保留「“FairyGUI”名称……本项目并非 FairyGUI 官方产品」的声明 |
| `src/editor/runtime/BrowserWorkspaceRegistry.ts`、`src/editor/services/BrowserProjectStorage.ts` 默认工作区文件名 | FairyGUI-layabox-demo.fairy（开始页上能看到） | 换成 Demo.fairy |
| 界面工程 `Builder/dialogs/AboutDialog.xml` | 窗口标题「关于 FairyGUI 编辑器」、大字「FairyGUI Editor」、Logo | 换成「关于 LGUI 编辑器」「LGUI Editor」、LGUI Logo |
| 界面工程 `Builder/StartScene.xml` | 「欢迎使用 FairyGUI」、Logo | 换成「欢迎使用 LGUI」、LGUI Logo |
| 界面工程 `Builder/RecentItem.xml` | 占位文字 FairyGUI-Unity-Demo、/Users/Documents/FairyGUI（运行时会被清掉） | 换成 UIProject |
| 界面工程 `Builder/icons/logo128.png` | FairyGUI 的 Logo | 换成 `brand/logo128.png` |
| 界面工程 `Builder/dialogs/RegisterNoticeDialog.xml` | 专业版订阅提示，多处提到 FairyGUI | **没改**：编辑器代码里没有用到这个窗口，页面上看不到 |
| 界面工程 `Builder/dialogs/PublishPackageSettings.xml` | 「FairyGUI提供了专门的着色器混合」 | **保留**：说明运行时的技术事实 |
| 导入相关的文字（「导入 FairyGUI 项目」「Import FairyGUI Package」「请选择 FairyGUI 工程文件夹或 ZIP」等） | — | **保留**：说明格式兼容 |
| 控制台日志前缀 `[FairyGUI Editor]` | — | **保留**：只在浏览器开发者工具里能看到 |

## 兼容实测

```bash
node scripts/build-editor/check-compat.mjs [工程目录 ...]
```

编辑器打开并保存工程（把一个文字控件右移 1 像素）→ 导出 → 和原文件比较 → 随插件带的 OpenFairyGUI 0.7.0 生成网页界面包 → 浏览器里加载每个包、创建每个导出的组件。不写参数时测 `lgui init` 的模板工程（再多跑 `lgui check` 和 `lgui verify --size desktop`）和背包示例 `examples/inventory/ui`。升级上游编辑器后跑一遍。

## 验证

用本地静态服务打开 `plugin/editor/index.html`（`127.0.0.1`），编辑器正常加载默认工作区；页面标题、开始页、帮助菜单、关于窗口里都是 LGUI 的名称和 Logo。截图：[编辑器](screenshots/editor.png)、[开始页](screenshots/start.png)、[关于窗口](screenshots/about.png)。
