# FairyGUI-unity 改动台账

上游：FairyGUI-unity 提交 `8cc8f214cca79685532eef13372d0a4f74acdf08`（来源、范围见 `package/FairyGUI/SOURCE.md`）。**上游文件原则上一个字节不改**：LGUI 自己要的东西放在 LGUI 的程序集（`package/Runtime/`）里，用 FairyGUI 的扩展点接上（比如 `FontManager.RegisterFont`）。只有扩展点做不到、必须改上游文件的，记在这张表里：写清改了哪个文件、为什么、原文和现在的样子、怎么验证。

## 怎么升级上游

换提交以后，先把下表的文件恢复成新上游的原文，再按「现在」一栏重新改一遍；`tests/unit/unity/tmp-setup.test.mjs` 里记着上游原文，要一起换。

## 改动

| 编号 | 文件 | 原因 | 上游原文 → 现在 | 测试 |
|---|---|---|---|---|
| U1 | `package/FairyGUI/FairyGUI.asmdef` | 项目字体在 Unity 上用 TextMesh Pro（Owner 11-08 定）。FairyGUI 的 `TMPFont`、`FontManager` 里认 TMP 字体的分支、`GTextField` 读 TMP 文字格式的那几行都包在 `#if FAIRYGUI_TMPRO` 里，这个宏要在编译 FairyGUI 这个程序集时定义。宏只能写在这个程序集自己的 asmdef 里；改工程的 Player 设置或放全局 `csc.rsp` 会动到用户工程的配置，所以不用。 | 上游 SHA-256 `b3f4133b032b674547ac348ac7192646c22f44496402e9e27ced8d3ac307df58`，`"versionDefines": []` → 一项 `{"name": "com.unity.ugui", "expression": "2.0.0", "define": "FAIRYGUI_TMPRO"}`（装了 com.unity.ugui 2.0.0 及以上就定义；LGUI 的包本来就依赖它，上游 asmdef 本来就引用 `Unity.TextMeshPro`）。其余字段、缩进不变 | `tests/unit/unity/tmp-setup.test.mjs`：除了 `versionDefines` 和上游原文逐项相同；Unity 里由 `tests/unity/fonts/` 验收（注册成 `TMPFont`） |

## 不改上游、但为上游补的东西

- `package/Runtime/Resources/LGUI/FairyGUI-TMP.mat`、`FairyGUI-TMP-Underlay.mat`：FairyGUI 的 TMP shader（`FairyGUI/Extensions/TextMeshPro/Shaders/FairyGUI-TMP.shader`，`Shader "FairyGUI/TextMeshPro/Distance Field"`）不在 Resources 里，`TMPFont` 用 `Shader.Find` 按名字找它。出包时 Unity 只带被引用的 shader，投影用的 `UNDERLAY_ON` 是 `shader_feature`，没有材质用到也会被剥掉。这两份材质放在 Resources 里、引用这个 shader（一份不开关键字、一份开 `UNDERLAY_ON`），出包就会带上 shader 和这两个变体。shader 文件本身不动、不挪。
- `package/Runtime/Platform/Fonts.cs` 的 `ProjectTMPFont`（`TMPFont` 的子类，项目字体注册的就是它）：上游 `TMPFont` 默认向 TMP 查 Medium 字重的字（`TMPFont.cs` 第 51 行），粗体查 Bold（第 316 行）。LGUI 运行时建的 TMP 字体只有一个字重、字重表是空的，TMP（com.unity.ugui 2.6.0）对非 Regular 字重只找替代字体，找不到就返回空，不从字体文件加字，结果字宽 0、什么都不画（Windows、Unity 6000.6.6f1 实测，0.4.1 文字全不显示的原因）。普通字用上游的 `fontWeight` 设成 Regular；粗体上游没有设字重的地方，子类在 `SetFormat` 之后把私有字段 `_fontWeight` 重设成 Regular（反射），`FontStyles.Bold` 和 `format.bold` 保留，粗体照旧由 shader 加粗、加宽字距（伪粗体）。字段找不到时注册字体直接抛错，不会静默画不出字。**升级上游时**：`tests/unit/unity/tmp-setup.test.mjs` 记着子类依赖的上游那几行（`_fontWeight` 字段、默认 Medium、粗体定成 Bold、查字用 `_fontWeight`），变了要红，照新上游重看一遍。
