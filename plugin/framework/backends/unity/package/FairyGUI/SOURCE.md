# FairyGUI-unity source

Source: [fairygui/FairyGUI-unity](https://github.com/fairygui/FairyGUI-unity/tree/8cc8f214cca79685532eef13372d0a4f74acdf08), commit `8cc8f214cca79685532eef13372d0a4f74acdf08`.

The original `Assets/Scripts` tree and root `LICENSE` are included. The source tree, `.meta` files, and original assembly definition are preserved. Git tree of `Assets/Scripts`: `a2406d04158c0e475ad6079f0a67b7b15912690c`.

The same commit's `Assets/Resources/Shaders/FairyGUI-Image.shader`, `FairyGUI-Text.shader`, and `FairyGUI-BMFont.shader` are also included under `Resources/Shaders`, with their original `.meta` files and the original Resources/Shaders folder metadata. These three shaders are required by the default `ShaderConfig`; copying Scripts alone omits them and makes the upstream runtime use `UI/Default`. Their only include is Unity's own `UnityCG.cginc`, supplied by the installed Unity Editor and not redistributed here. No optional AddOn shaders or unrelated Unity assets are included. This addition was explicitly approved for S3-01 after the missing-shader probe.

The original MIT notice is in [LICENSE](LICENSE). `Tween/EaseManager.cs` retains its DOTween terms link and Robert Penner BSD notice. `Core/Text/RTLSupport.cs` retains Copyright (c) 2018 Tadpole Studio and its “All rights reserved” notice; this is third-party source and is not relicensed as LGUI-original MIT code. Removing that file was tested in Unity 6000.6.6f1 and fails with `CS0246` at `TextField.cs:22`, so the original file is retained. The first LGUI version does not claim right-to-left UI support.

LGUI change: `FairyGUI.asmdef` defines `FAIRYGUI_TMPRO` through `versionDefines` when `com.unity.ugui` 2.0.0 or later is installed, so that FairyGUI's TextMesh Pro support (`Extensions/TextMeshPro/TMPFont.cs` and the `FAIRYGUI_TMPRO` branches) is compiled; LGUI's project fonts use it. All other files are byte-identical to the commit above. The change and the reason are recorded in the LGUI repository's `plugin/framework/backends/unity/PATCHES.md`.
