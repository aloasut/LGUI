# 接入 Unity

`lgui unity export` 将同一份 `ui/`、`src/` 和 `i18n/` 导出给 Unity。先在网页端完成界面和功能，再接 Unity；游戏代码继续只使用 `lgui` 接口，不调用 `CS.*` 等引擎 API，这一条由 `lgui check` 检查。

本文里的 `lgui` 指 `node "<插件目录>/tools/lgui.mjs"`。在 LGUI 工程根目录运行命令；`--to` 指向已经创建的 Unity 工程根目录。

## 准备 Unity 和 PuerTS

1. 安装 **Unity 6000.6.x（Unity 6.6）**，创建空工程。Windows IL2CPP 构建还需要 Unity Hub 中的 **Windows Build Support (IL2CPP)** 模块，以及该 Unity 版本要求的 MSVC 和 Windows SDK。模块和构建设置见 [Unity 的 IL2CPP 说明](https://docs.unity.com/en-us/engine/6000.6/manual/programming-environment/scripting-backends/il2cpp/il2cpp-introduction)。
2. 从 [PuerTS Unity_v3.0.3 官方发布页](https://github.com/Tencent/puerts/releases/tag/Unity_v3.0.3) 下载 `PuerTS_Core_3.0.3.tar.gz` 和 `PuerTS_V8_3.0.3.tar.gz`。将包内容分别解压到下面两个实际目录，确认 `package.json` 直接位于包目录内：

   ```text
   MyUnityGame/
   ├── ProjectSettings/ProjectVersion.txt
   └── Packages/
       ├── com.tencent.puerts.core/package.json
       └── com.tencent.puerts.v8/package.json
   ```

   两个包的名称分别为 `com.tencent.puerts.core`、`com.tencent.puerts.v8`，版本都必须是 `3.0.3`。这里需要工程内的 embedded 本地包；指向外部目录的链接、包注册表安装和 `Library/PackageCache/` 不符合导出条件。

LGUI 不自动安装 Unity 或 PuerTS，也不会修改 Unity 的包缓存。LGUI 的 Unity 包包含 C# 宿主、固定版本的 FairyGUI-unity 和必需的 Image、Text、BMFont shader；第三方说明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 导出并在 Editor 运行

在 LGUI 工程里执行：

```text
node "<插件目录>/tools/lgui.mjs" check
node "<插件目录>/tools/lgui.mjs" test
node "<插件目录>/tools/lgui.mjs" unity export --to "<Unity 工程路径>"
```

导出会检查 Unity 版本、本地 PuerTS 包、补丁目标和已有 LGUI 包版本。首次导出会安装 `Packages/com.lumiogames.lgui/`、生成 `Assets/LGUI/LGUIBoot.unity`，并记录 `.lgui/project.json` 的 `unityProject`。

PuerTS 的四处 Unity 6.6 兼容补丁应用到本地 Core 包的 `Editor/Resources/puerts/xil2cpp/Puerts_il2cpp.cpp.txt`。导出先核对原始字节的 SHA256：官方原文件精确修改四处；已经补好的文件明确跳过；其他内容报 `LGUI-CLI-051`，不会硬打。不要手改模板后绕过这个检查。

每次导出都会从 LGUI 源文件重新生成界面包、图集、翻译和游戏脚本。先在 `.lgui/build/unity/` 下完成生成和编译，成功后才替换 Unity 的两个生成物目录；已有启动场景不覆盖。

```text
MyUnityGame/
├── Packages/
│   ├── com.tencent.puerts.core/
│   ├── com.tencent.puerts.v8/
│   └── com.lumiogames.lgui/
└── Assets/LGUI/
    ├── Resources/
    │   ├── UI/                   # 界面 .bytes、图集、README.txt
    │   │   └── i18n/             # 各语言的界面翻译 XML
    │   └── Game/
    │       ├── game.js.txt        # src/ 加 Unity 适配层打成的脚本
    │       └── README.txt
    ├── link.xml                  # 导出时复制的动态调用裁剪保留声明
    └── LGUIBoot.unity             # 启动场景，首次生成后保留
```

让 Unity 完成资源导入和 C# 编译，打开 `Assets/LGUI/LGUIBoot.unity`，点 Play。场景中保留一个 `LGUIBoot` 即可。`game.js.txt` 在 Unity 中的文本资源名是 `game.js`，宿主用 `Resources.Load<TextAsset>("Game/game.js")` 读取。

包内的 Editor 导入器会为生成的 UI 图集关闭 mipmap：只匹配 `Assets/LGUI/Resources/UI/<包名>_atlas<数字>.png`，并要求同目录存在对应的 `<包名>_fui.bytes`。重新导出后让 Unity 完成正常导入即可；其他目录的用户贴图及其余纹理设置保持原样。

`Assets/LGUI/Resources/UI/` 和 `Game/` 会整目录替换，不要放自写文件，也不要在 Unity 里改生成内容。界面、代码和翻译要回到 `ui/`、`src/`、`i18n/` 修改后重新导出。管理路径必须是实际目录或文件，不能通过链接重定向到用户资源；用户自己的 Unity 代码放在 `Assets/LGUI/` 以外，通过框架的平台接口接入。

插件、LGUI 工程和 Unity 包的版本需要一致。报 `LGUI-CLI-003` 时先核对 `.lgui/project.json` 的 `unityProject`：`lgui upgrade` 只处理这个字段指向的 Unity 工程，不接收导出命令的 `--to`。如果这次换了目标工程，先把该字段设为要升级的工程路径（相对于 LGUI 工程的路径，或绝对路径），再运行 `lgui upgrade`，按更新记录处理并重新导出。升级会替换框架副本和配置的 Unity 工程内的 LGUI 包，不会替你重新打游戏脚本。

## Windows Release IL2CPP Player

`lgui unity export` 只导出文件，不启动 Unity，也不生成 PuerTS 原生桥。Editor Play 通过以后，在 Unity 中继续：

1. 在 `File > Build Profiles` 中选择 Windows，Architecture 选 **Intel 64-bit（x86_64）**，关闭 Development Build；加入 `Assets/LGUI/LGUIBoot.unity`，将它作为启动场景。构建界面见 [Unity Build Profiles 说明](https://docs.unity.com/en-us/engine/6000.6/manual/building-and-publishing/build-settings/create-build-profile)。
2. 在 Windows Player Settings 设置：**IL2CPP、C++ Compiler Configuration = Release、Managed Code Variant = Release、Managed Stripping Level = Low、API Compatibility Level = .NET Standard**，各项见 [Windows Player 设置](https://docs.unity.com/en-us/engine/6000.6/manual/platform-specific/windows/playersettings)。
3. 执行 `Tools/PuerTS/Generate il2cpp/Reflection Mode`，也就是 `Puerts.Editor.Generator.UnityMenu.GenV2WithoutWrapper()`。等生成文件导入、编译完成后再构建 Player。
4. 运行打出的 `.exe`，检查实际操作和退出日志。构建成功与 Player 运行通过分别记录。

Reflection Mode 仍会生成反射调用必需的委托、值类型原生桥、扩展方法元数据和 linker 文件；它不生成类型静态 wrapper。不要选 `Static Wrapper Mode` 或 `Generate C# Static Wrappers` 来代替这个步骤。原生输出默认在 `Assets/Gen/Plugins/puerts_il2cpp/`，具体目录由 PuerTS 配置决定。更换 PuerTS、更新兼容补丁或修改需要桥接的 C# API 后，重新生成再构建。

保留 **`Assets/LGUI/link.xml`** 和 PuerTS 生成目录内的 `link.xml`。Unity 不处理 UPM 包内部的 `link.xml`，所以 LGUI 包里的模板不能代替导出到 `Assets/` 的声明；PuerTS 生成的声明也不能代替它。

`LGUIBoot` 的 `debugPort` 默认是 `-1`。普通 Player 保持这个值；需要连接 PuerTS Inspector 时再为该次验证显式设置端口。

### 检查横竖屏

要验证自动换版，先确认 `.lgui/project.json` 中的 `orientation` 是 `"both"`，且需要两种排法的组件在 `ui/` 中有对应的 `@portrait` 版本，见 [ui-spec.md](ui-spec.md)。锁定为 `landscape` 或 `portrait` 时，框架按配置方向显示；没有竖版的组件沿用原组件，弹窗等可共用一版。

网页和 Player 都要实际查看横屏、竖屏：文字是否截断，列表能否滚动，弹窗和返回键是否正常，切换方向、语言以后选中项和滚动位置是否保留。网页可以用 `lgui verify` 生成标准横竖截图，再在 `lgui dev` 页面操作；同时检查实际组件布局和快照的 `orientation`，不能只靠截图文件名判断换版。

Windows Player 可设置为 Windowed 并开启 Resizable Window，通过改变窗口尺寸触发方向切换。也可以先关闭上一实例，再从 PowerShell 分别启动两种尺寸：

```powershell
& "<Player目录>/Game.exe" -screen-fullscreen 0 -screen-width 1280 -screen-height 720
& "<Player目录>/Game.exe" -screen-fullscreen 0 -screen-width 450 -screen-height 800
```

核对实际客户端宽高和截图尺寸：显示空间不足时，Unity 或系统可能限制、截断申请的窗口尺寸，命令行参数不能代替实测。上面的竖屏例子是 9:16 的 `450×800`，可按可用桌面空间调整。

这能在电脑上检查手机比例的竖版布局；截图和实际可操作窗口分别保留。物理手机、触摸键盘等行为需要在相应设备上另验。

## 接入后要看的三件事

1. **文字。** Unity 和浏览器测量文字的方式不同；检查项目使用的字体、中文和其他语言有没有缺字或截断，横竖两版都看。项目字体（`ui/fonts/`）由 `lgui unity export` 做成子集写到 `Assets/LGUI/Resources/UI/fonts/`，启动时用它建动态的 TextMesh Pro 字体。TMP 建字体要用工程里的 TMP 必需资源（TMP Essential Resources，里面有 TMP Settings）：工程用了项目字体、又没有 TMP Settings 时，`lgui unity export` 会从 `com.unity.ugui` 自带的资源包 `Package Resources/TMP Essential Resources.unitypackage` 导入（不联网，只写工程里还没有的文件，已有 TMP Settings 的工程不动；按顺序找工程的 `Library/PackageCache/com.unity.ugui@…/`、`Packages/com.unity.ugui/`、Unity Hub 默认安装位置里这个版本的内置包，找不到报 `LGUI-CLI-143`），运行时还是没有就报 `LGUI-RT-181`。TMP 字体（字第一次出现时才画进图集、满了开新图集），按名字注册给 FairyGUI（注册不上报 `LGUI-RT-181`）。Unity 包依赖 `com.unity.ugui`（Unity 6 起自带 TextMesh Pro），FairyGUI 的 TMP 支持靠它打开。子集外的字（聊天、玩家名）由挂在后面的系统字体 TMP 回退字体显示：iOS、macOS 苹方，Android 系统的 Noto Sans CJK 等，Windows 微软雅黑；一个都没找到时记一次 `LGUI-RT-182`，缺的字显示方框。系统字体回退只对 iOS、Android、电脑原生包有效，出微信小游戏或 WebGL 时读不到系统字体，要带常用字字体。表情符号这次不支持（以后用 TMP Sprite Asset）。一次出很多新字的界面，在真机上看第一次出字的耗时。
2. **平台服务。** Unity 存档位于 `Application.persistentDataPath/LGUI/` 下，按工程和键名隔离；它与浏览器存储各自独立。HTTP 使用 UnityWebRequest，检查产品实际使用的地址、权限和错误处理。WebSocket 暂未实现，会报 `LGUI-RT-001`。
3. **格式化。** 本次 Windows 验证使用的 PuerTS 3.0.3 V8 没有 `Intl`。框架会使用内置千分位、`年-月-日 时:分` 和 `货币代码 数值` 格式；中文、日文、韩文复数取 `other`，其他语言按 `1/其他` 区分。日期、货币和部分数字显示可能与浏览器的 `Intl` 不同，应按产品用到的语言和值核对。

例如，本次实测 `12345.6789` 在 Unity 显示 `12,345.6789`，浏览器显示 `12,345.679`；英文环境中 `USD 123.5` 在 Unity 显示 `USD 123.5`，浏览器显示 `$123.50`。日期使用宿主本地时区。共享业务快照一致，不代表所有格式化文字都逐字一致；验证保留两端实际的 `Intl` 能力，不关闭浏览器的 `Intl` 制造一致。

## 运行约定

- **资源依赖。** 动态图片 URL 本身不声明跨包依赖。背包示例的领奖图标通过实际可见的 `Bag/ItemIcon` 子组件和 `RewardIconPartView` 显示，导出时可识别奖励界面依赖 Bag 包；从营地直接领奖时也会加载图片所属包。自定义界面同样应通过实际使用的组件引用声明依赖，不能依靠之前恰好打开过另一个界面。跨包图片（`<image pkg="…" src="…">`）和跨包子组件一样算依赖：导出时图片所在的包写进包依赖，打开界面时一起加载。
- **艺术字生命周期。** 每批 ArtText 字符图片由容器持有；改字、清空文字会释放旧批次，关闭父界面会递归释放最后一批。Unity 后端同时清理递归销毁的子容器记录。这说明对象如何释放；内存验收仍需在实际 Player 测量。
- **列表位置。** 写入不同的 `scrollPosition` 会同步提交滚动位置，避免下一帧旧惯性覆盖它；横竖屏或语言重建保留该位置和选中项。重复写入相同位置沿用 FairyGUI 的无操作语义，不承诺停止正在运行的惯性。背包示例的 `scrollBar="hidden"` 还会禁用 FairyGUI 滚轮滚动，列表使用按住拖动；这是界面配置，不改变后端滚轮的方向和数值。
- **弹窗顺序。** 同时申请的普通 modal 按申请顺序显示；前项加载失败、取消或打开失败后，后项继续排队。打开者已关闭时，其子窗口后续关闭不会再通知旧打开者。通过 UIManager 的公开接口开关界面，让激活、返回和关闭通知遵守同一规则。
- **声音。** FairyGUI-unity 的按钮和动效自己会放声音，网页版的 FairyGUI 不放；Unity 后端把 FairyGUI 自己的声音关掉，界面声音全部由框架放：按钮音按 `ui/` 里按钮的设置，背景音乐按 View 的 `static music`，代码里用 `lgui.sound.play`，和网页一样。音效和背景音乐由 Unity 包的 `LGUI.Platform` 用自己的 AudioSource 播放，换曲按不受 `timeScale` 影响的时间淡入淡出，切到后台时一起暂停。没登记的 `ui://` 声音报 `LGUI-RT-170`；网络声音下载失败记 warn。
- **新控件、动效和拖放。** 标签、滑动条、下拉框、序列帧动画、树，动效的 `playing` / `play` / `done`，拖放找落点（FairyGUI 的命中测试）、滚轮只认落在控件上的事件、`t.visible` 的「真的显示」，在 Unity 后端都按同一套接口实现。功能、快照和可视像素按实际用例分别验收；开发用一致性运行器已经接了 `t.dragTo`、`t.setValue`、`t.choose`、`t.type`、`t.setSafeArea`。`t.type` 点击聚焦后全选原文字，再逐字输入或用退格清空；本次 Unity 6000.6.6f1 Editor 和 Windows Release IL2CPP Player 分别跑过 `input` 用例，ASCII 逐字输入、替换原文字、清空的完整快照均与 headless、H5 相等。该验证使用 Legacy Input（`activeInputHandler: 0`），未启用 `FAIRYGUI_INPUT_SYSTEM`；中文输入法选字过程未覆盖。
- **安全区模拟。** 开发运行器的 `t.setSafeArea` 注入屏幕像素边距，等两次原生渲染更新后继续。Unity 平台优先读 `globalThis.__lguiSafeArea`，没有注入时读宿主安全区；边距变化在下一帧发一次尺寸通知，同一帧的尺寸和边距变化合并通知。Node 已覆盖注入读取、同值不重复、恢复宿主边距；Unity 6000.6.6f1 Editor 和 Windows Release IL2CPP Player 已验证 960×540 全屏界面的三组安全区重排，完整快照与 headless 一致。
- **网络启动和关闭。** 请求遵守 Unity 工程的网络策略。HTTP 在启动时被拒绝等同步失败，会正常结束失败处理：原生失败原因含 `LGUI-RT-161`，JS 网络层按既有 `LGUI-RT-101` 报告；外链图片走已有失败回调，上层图片绑定使用既有错误处理和占位图；音频记录一次 `LGUI-RT-161` 并结束。宿主停止后不再派发旧代请求的回调；图片的一次回调触发宿主关闭时，也不会继续派发剩余旧回调。框架不会为此重试、修改网络策略或系统代理。专用验证工程的 HTTP 放行配置不代表普通 Player 配置。

正常流程与预期失败用例分别记录：保留原始错误码和堆栈，并核对有没有额外的未预期错误。不要把一次构建成功、Node 边界测试或图片 URL 可访问，写成 Player 的功能、像素或内存验收通过。

## 本轮验证范围与维护者复现

本轮 Windows Release IL2CPP 的五组共享用例与 headless、H5 完整快照深比较相等。背包同串操作的 26 个业务检查点及稳定 UI 也相等；两端真实耗时产生的 `rawTiming` 和唯一 HUD 倒计时文字单列保留，其他字段继续严格比较。

内存验收覆盖同一原始 VM 的完整 200 次暖机、200 次正式循环，连同两组各自的一轮初始化共执行 402 次。独立检查正式第 0、200 次的强引用保留链后，接受“本次正式 200 次窗口内未发现关闭界面或游戏监听累积泄漏”：原生 DisplayObjectInfo 计数保持 44，脱离父界面的 Loader 保持 0，PuerTS 活跃槽保持 55，17 类自定义实例的稳定 ID 未变，未发现旧 UI 或新增游戏监听的保留链。

正式六点的 GC 后、暂停时读取的 JS 堆为 `3997992 / 3901920 / 3952480 / 4000552 / 4038672 / 4030304` 字节，非单调，首尾增加 `32312` 字节；固定回收后的托管堆与进程 Private Memory 也有波动和回落。堆图强引用 self size 首尾增加 `92152` 字节，主要归于具名 JIT/feedback、有限的测试采样记录和当前替换状态。两种原始观察分别保留，没有相减、扣噪声或设容差。这一结论限于观测窗口，不证明全堆每个字节或任意更长生命周期。维护者工作目录中的证据是 `.local/lgui-stage3/S3-04/memory/run9-retainers/verdict.json`，不随插件分发。

本次普通包位于维护者工作目录的 `.local/lgui-stage3/S3-04/ordinary-final/player/Inventory.exe`：分发量 `93,231,253` 字节，构建 0 错误、10 条上游警告，实际 C++ 和托管变体均为 Release，8 份 Player Csc 响应启用优化，`debugPort=-1`。最终普通包的横屏、竖屏可视操作仍待 Owner 手动处理桌面上的 Windows 防火墙提示后验收；验证用 Player 的截图不代替这两项。

开发工具在仓库的 `tests/unity/`，不随插件分发。先按 [开发用 Unity 验证步骤](https://github.com/LumioGames/LGUI/blob/8209211592596b3a9f85595ab06bb6eecbcc77b7/tests/unity/player-build.md) 准备独立的 Release 验证 Player，再复现原始 VM 的暂停堆采样和快照：

```text
node tests/unity/acceptance/memory-host.mjs --player "<验证Player>" --evidence "<新的证据目录>" --port <明确端口> --scenario memory-settled --alternating-gc true --paused-heap true --heap-snapshots true --graphical true
```

采样固定回收轮次并保存全部原值；快照只在正式第 0、200 次的同一暂停点获取，要求完整快照块、成功回执和节点/边结构校验，退出时恢复调试器。`graphical` 明确运行实际图形窗口；占位图像素用同一文档中的 `coverage-host` 流程查看原始 PNG，不能接受 batch 模式的黑图。专用测试端口、HTTP 放行和采样桥均不带进普通预览包；采集完成与内存判断分别记录。

## 常见报错

| 错误码 | 原因和处理 |
| --- | --- |
| `LGUI-CLI-052` | 目标不是 Unity 6000.6.x 工程，或管理路径用了链接、文件/目录类型不对。检查 `--to` 是否指向工程根目录，并按报错移走同名的错误类型条目。 |
| `LGUI-CLI-051` | Core/V8 本地包名称、版本、位置或补丁文件摘要不对。保留自己的修改后，将官方 3.0.3 包内容恢复到工程的 `Packages/` 实际目录，再导出；不要修改 `Library/PackageCache/`。 |
| `LGUI-CLI-003` | LGUI 工程或 Unity 包版本和插件不一致。先核对配置中的 `unityProject` 是否指向这次目标，运行 `lgui upgrade` 后重新导出。 |
| `LGUI-CLI-011` | 插件里的 Unity 包模板、metadata、linker 或固定补丁缺失、不完整。重新安装完整插件。 |
| `LGUI-RT-011` / `LGUI-RT-141` | 界面包或翻译资源缺失、无法加载。重新导出，检查 `Resources/UI/` 和 `UI/i18n/`。 |
| `LGUI-RT-071` | 图片 URL 所属包尚未加载。用实际使用的跨包组件声明依赖后重新导出，不在游戏代码里调用引擎加载 API。 |
| `LGUI-RT-160` | Unity 宿主启动、每帧回调或退出失败。按完整堆栈检查脚本、资源路径、PuerTS 和桥生成；回调出错时按该回调的实际原因修复。 |
| `LGUI-RT-161` | Unity 存储、HTTP、音频等平台服务失败。按日志检查本地目录权限、请求和资源地址。 |
| `LGUI-RT-001` | 当前能力尚未实现，例如 Unity WebSocket。按产品需要评估接口能力。 |

完整清单见 [error-codes.md](error-codes.md)。`LGUI-CLI-050` 仍表示 `lgui check` 无法读取 `tsconfig.json`，Unity 版本校验使用的是 `LGUI-CLI-052`。
