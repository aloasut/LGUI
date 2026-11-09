# LGUI Unity runtime

Unity 6000.6 的 embedded package（`com.lumiogames.lgui`）。包含 C# 启动与平台服务，以及固定版本的 FairyGUI-unity。`lgui unity export` 的命令接入在 S3-03 完成；本目录本身可以复制进 Unity 工程的 `Packages/com.lumiogames.lgui/`。

FairyGUI 除 `Assets/Scripts` 外，还包含同一固定提交必需的 Image、Text、BMFont 三个 shader，位于 `FairyGUI/Resources/Shaders/`；保留原 `.meta` 和许可。放入 Resources 以便 Unity 将它们纳入 Player。仅复制 C# 源码会缺少这三个 shader，使上游改用 `UI/Default`；这不能算正确的 LGUI 渲染。Unity 自带的 `UnityCG.cginc` 不随包复制。

**项目字体用 TextMesh Pro。** `FairyGUI/FairyGUI.asmdef` 在装了 `com.unity.ugui`（2.0.0 起自带 TextMesh Pro）时定义 `FAIRYGUI_TMPRO`，FairyGUI 的 `TMPFont` 才会编译；这是对上游唯一的改动，台账在 LGUI 仓库的 `plugin/framework/backends/unity/PATCHES.md`。`LGUI.Platform.RegisterFont` 用 `lgui unity export` 写进 `Assets/LGUI/Resources/UI/fonts/` 的精简字体建动态 TMP 字体（字第一次出现时才画进图集，满了开新图集），包成 `TMPFont` 按字体名注册，后面挂一个系统字体建的 TMP 回退字体。`Runtime/Resources/LGUI/` 里的两份材质只为让出包时带上 FairyGUI 的 TMP shader 和投影用的 `UNDERLAY_ON` 变体。

先按 PuerTS 官方说明准备 3.0.3 的 Core 和 V8 本地包。LGUI 不分发或安装 PuerTS。包的 UGUI 依赖提供 FairyGUI 所需的 TextMeshPro 程序集。

启动场景挂 `LGUI.LGUIBoot`。它从 `Resources.Load<TextAsset>("Game/game.js")` 读取 `Assets/LGUI/Resources/Game/game.js.txt`：Unity 导入文本时只剥掉最后的 `.txt`，实际 TextAsset 名称保留 `.js`。之后调用脚本的 `globalThis.__lguiStart()`，每帧先 `JsEnv.Tick()` 再通知 TypeScript。退出前先取消 TypeScript 监听、停止原生异步请求，再释放环境。脚本需提供 `__lguiFrame(deltaMs)`、`__lguiVisibility(visible)`、`__lguiDispose()` 生命周期钩子。`debugPort` 默认 `-1`；只有显式启用时才开放 PuerTS 调试器。

`Runtime/link.xml` 是供导出器复制的模板；Unity 不处理直接位于 package 内的 link.xml。构建 IL2CPP 前，必须将它复制到 `Assets/LGUI/link.xml`（S3-03 导出器负责），保留由 JS 动态调用的 FairyGUI、LGUI 平台桥和 PuerTS Core/V8 入口。只有包内这份文件时，不能声称已防止代码裁剪。

`LGUI.Platform` 由后端使用，游戏代码仍只调用 `lgui`：

- `Now` 是单调毫秒；屏幕尺寸和四边安全区是屏幕像素。
- `StorageGet/Set/Remove(project, key, ...)` 在 `Application.persistentDataPath` 下保存按工程、键名隔离的文件。
- `LoadText(resourcePath)` 读取 Resources 文本；翻译使用 `UI/i18n/<语言>`。
- `Fetch` 使用 `UnityWebRequest`，在 Unity 主线程回调 JSON `{status, text, error}`。请求头参数为 JSON `{items: [{name, value}]}`。
- `PlayAudio` 播放 `ui://` 音效或 HTTP(S) 音效；`PlayMusic` 换背景音乐（同一首只改音量，换曲淡入淡出）；`SetAudioPaused` 暂停或恢复全部 LGUI 声音。声音都用 LGUI 自己的 AudioSource 放；FairyGUI 自己的按钮音、动效音由 TypeScript 后端关掉（`Stage.soundVolume = 0`）。
- `ButtonSoundUrl`、`TransitionAutoPlay`、`TransitionAutoPlayTimes`、`TransitionAutoPlayDelay` 读出 FairyGUI 不公开的按钮音效地址和动效自动播放设置。
- `ClipboardGet` / `ClipboardSet` 读写系统剪贴板（`GUIUtility.systemCopyBuffer`，`link.xml` 里保留了它）；失败时抛错，TypeScript 后端报成 `LGUI-RT-241`。
- `Log`、`SystemLanguage`、`IsComposing` 和 `SetInputMode` 提供其余平台信息。
- `LGUIResourceLoader` 为 FairyGUI 的外部图片加载增加完成/失败事件和 HTTP(S) 支持。同一 URL 的预载与界面显示共享请求、纹理；占位图保持到预载成功，显示时直接接收已下载纹理。

外链纹理由原生图形引用计数持有；最后一个消费者释放后只保留两帧，供 PuerTS 的下一次 `Tick` 完成预载 Promise 到显示控件的交接。`LGUIBoot` 在 `Tick` 和每帧回调之后清理闲置纹理，关闭宿主时清空缓存并取消请求。一个界面关闭不会销毁另一个界面仍在使用的共享纹理；过期 URL 的响应不覆盖新图片。

WebSocket 尚未实现，后端必须报告 `LGUI-RT-001`。缺脚本或生命周期失败报告 `LGUI-RT-160`，平台服务失败报告 `LGUI-RT-161`。

FairyGUI 来源和保留的第三方声明见 [FairyGUI/SOURCE.md](FairyGUI/SOURCE.md) 与原始 [LICENSE](FairyGUI/LICENSE)。
