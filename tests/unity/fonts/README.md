# Unity 项目字体（TMP）原生验收

在真 Unity 里跑 Unity 适配层、`LGUI.Platform.RegisterFont`、FairyGUI 的 `TMPFont` 和 TextMesh Pro。检查：

- 项目字体找不到时报 `LGUI-RT-181`（报错里有 `Resources/UI/fonts/Missing`）。
- 项目字体按名字注册成 FairyGUI 的 `TMPFont`（LGUI 的子类 `ProjectTMPFont`，只向 TMP 查 Regular 字重），TMP 字体是动态图集（`Dynamic`），开了多图集。
- 没写 `font` 的文字（按 `defaultFont`）实际用项目 TMP 字体画（读 FairyGUI `TextField` 的 `_font`）。
- **字真的排出来、画出来了**：探针在同一个文字控件上依次设七段字（中文、英文、普通、粗体，见 `probe.ts` 的 `report.draws`），每段都走 FairyGUI 默认路径排版并建网格（`TextField.Redraw`，和每帧做的一样），读字宽、网格顶点数（主网格加 TMP 子网格）、这些顶点用的是哪个字体的图集。`checker.mjs` 要求每段字宽 > 0、顶点数不少于「字数 × 4」。0.4.1 在 Windows 上文字全不显示时就是字宽 0、0 个顶点。
- 项目字体里有的字只用项目字体的图集；项目字体里没有的字（`齉`，测试样本里故意没有）只用系统回退字体的图集，普通和粗体都查。这台机器上要找得到系统回退字体（候选见 `plugin/framework/backends/unity/package/Runtime/Platform/Fonts.cs`）。
- 探针**不另外向 TMP 查字**：0.4.1 及以前的探针用 Regular 字重单独查「这个字由哪个字体出」，那会从另一条路径把字加进图集，默认路径（当时查 Medium / Bold）排不出字也照样 `ok: true`。
- 记下第一次排版（字现画进图集）和第二次（已在图集里）的毫秒数，只在确认这两次都排出字之后才算数：编辑器里只是参考，真机数字要在手机上跑。

`LGUI-RT-182`（一个系统字体都没找到）在有系统字体的机器上触发不了，由 `tests/unit/unity/objects.test.mjs` 用模拟的 Unity 桥测。

字体样本是 `tests/fixtures/fonts/NotoSansSC-Sample.otf`，`prepare.mjs` 把它放到 `lgui unity export` 写的位置（`Assets/LGUI/Resources/UI/fonts/Noto.otf`）。

```text
node tests/unity/fonts/prepare.mjs --project <Unity工程> --evidence <证据目录>
<Unity> -batchmode -projectPath <Unity工程> -executeMethod LGUI.Tests.LGUIConformanceEditor.Run -lguiResult <证据目录>/result.json -lguiTimeout 120 -logFile <证据目录>/unity.log
node tests/unity/fonts/checker.mjs <证据目录>/result.json
```

`<Unity工程>` 用 `../runner.mjs` 准备的开发工程（装好本地 PuerTS 3.0.3 Core/V8 和这个分支的 Unity 包，见上一级 README）。

## Unity 上要跑的步骤（交给装了 Unity 6000.6 的 Windows 机器）

**A. 全新工程，没有 TMP Settings。**

1. 用 Unity 6000.6.6f1 新建一个空工程，按 `../README.md` 放好 PuerTS 3.0.3 Core/V8 本地包。**不要**点 Window → TextMeshPro 的导入。确认 `Assets/` 下没有 `TMP Settings.asset`。
2. **导出。**
   - 背包示例（`examples/inventory`）的副本里放整包 Noto Sans SC 为 `ui/fonts/NotoSansSC.otf`。下载命令：`node -e "import('./scripts/fonts/noto.mjs').then(m => m.notoSansSC()).then(console.log)"`，它从 Google 官方仓库下载到临时目录并打印路径，来源和 SHA-256 写在 `scripts/fonts/noto.mjs`。
   - `.lgui/project.json` 的 `defaultFont` 改成 `"NotoSansSC"`，然后 `lgui unity export --to <这个工程>`。
   - 要看到：
     - 输出里有一行「已从 com.unity.ugui 自带的资源包导入 TMP Essential Resources（N 个文件，没联网……）：<资源包路径>」。**把这个路径带回来**：它说明 ugui 2.0 的资源包实际在哪（工程的 `Library/PackageCache/` 还是 Unity 安装目录的 `BuiltInPackages/`）。
     - `Assets/TextMesh Pro/Resources/TMP Settings.asset` 存在。
   - 如果报 `LGUI-CLI-143`，把完整报错（找过的路径）带回来，再在 Unity 安装目录里找 `TMP Essential Resources.unitypackage`，把它的实际路径带回来。
3. **打开 Unity。** Console 没有导入错误。顺便看 `Assets/TextMesh Pro/` 的文件和用菜单 Window → TextMeshPro → Import TMP Essential Resources 导入的是不是一样（GUID 一样就行）。
4. **原生验收。** 用 `../runner.mjs` 准备的开发工程跑上面的三条命令。`prepare.mjs` 发现没有 TMP Settings 时，会和导出一样导入，输出里的 `tmpEssentials` 写着从哪里导入的。`checker.mjs` 要输出 `ok: true`；把它打印的 `fallback`（Windows 上应该是 `Microsoft YaHei`）、`firstLayoutMs`、`secondLayoutMs`、每段的字宽和顶点数（`draws`）带回来，连同 `result.json`、`unity.log`。没过时它说哪一段（普通 / 粗体、哪几个字）字宽是 0 或顶点不够。
5. **编辑器 Play**（第 2 步导出的工程，打开 `Assets/LGUI/LGUIBoot.unity`，截图）。看：
   - 文字清晰（SDF，不糊、不是方块）；
   - 普通字和 `bold="true"` 的粗体都显示，粗体比普通字粗（伪粗体：同一个字体文件由 shader 加粗）；描边（`strokeColor`）、投影（`shadowColor`）都在；
   - `autoSize="shrink"` 的字能缩；
   - 运行时给一个文字控件设一段带生僻字和英文的玩家名，生僻字由系统字体显示（不是方框）；
   - Console 没有空引用，没有 `LGUI-RT-160` / `LGUI-RT-181` / `LGUI-RT-182`。
6. **IL2CPP Windows Player**（照 `../player-build.mjs`）。看两点：
   - 画面和编辑器一样（不再是空白），文字和投影都在。
   - Player 日志里没有空引用。如果有 `TextMeshPro/Mobile/Distance Field` 这类 shader 找不到的报错，说明 TMP 自己的 shader 在出包时被剥了，把日志带回来。

**B. 已经有 TMP Settings 的工程。**

7. 在第 2 步的工程里随便改一下 `Assets/TextMesh Pro/Resources/TMP Settings.asset`（或者换一个用菜单导入过 TMP 的工程），记下 `git status` / 文件哈希，再 `lgui unity export` 一次。看到：
   - 输出里**没有**「导入 TMP Essential Resources」那一行；
   - `Assets/TextMesh Pro/` 下一个文件都没变。

**C. 运行时那条错误。**

8. 临时把 `TMP Settings.asset` 挪出 `Resources` 再 Play：报 `LGUI-RT-181`，信息里有「TMP Settings」、「lgui unity export」、「Window → TextMeshPro → Import TMP Essential Resources」，不再是空引用 / RT-160。看完挪回去。

**D. 手机（有条件再做）。** Android、iOS 真机上看三件事：
- 系统回退字体找得到（没有 RT-182，生僻字不是方框）；
- 一次显示几百个新字的界面，第一次打开的耗时；
- 图集张数（`Atlas` 读数的第三项）。
