# 证据：example（inventory）在独立 CC 工程完整跑通（2026-11-08）

## 结论

`examples/inventory` 在**独立 Cocos Creator 工程**（`lgui-cocos-mcp/example/`，决策 004）里完整跑起来：boot → 存档恢复 → HUD+营地 → 真实点击开背包/商店 → 领奖 modal 排队连弹 → 切语言重建，全链路无渲染错误。无头验收：Creator CLI 构建 → 静态服务 → 无头 Chrome（playwright）真实鼠标点击 + 截图（/tmp/lgui-example/1~7*.png）。

## 工程事实

- 工程：CC 3.8.8、官方 `fairygui-cc@1.2.2`、`assets/lgui-ui` bundle、demo 同款 `main.scene`、同步器 `sync.mjs`（框架 + 界面包 + i18n + 生成类型 ui-types + 示例 src 别名重写 ×23 文件）。**CLI 构建无需 GUI 预导入**（与 T007 时代不同，3.8.8 直接过）。
- **工程设计分辨率必须 == LGUI 设计尺寸**（1920×1080）：GRoot vanilla 尺寸 = rootSize = cc 设计分辨率，stage scale=1 时 fairygui 的两次 y 翻转和手势坐标全部自洽；demo 遗留的 1136×640 会让所有点击打偏（probe10-17 的定位过程）。
- 入口：`Boot.ts` 直连 `backend.init + mvc/boot`，`{...app, backend: 'cocos'}`，暴露 `__lgui` 供验收脚本驱动。

## 本轮排掉的雷（全部是「官方包 + CC 工具链」校准产出）

1. **`assetManager.releaseAsset` 是强制释放**（ReleaseManager.tryRelease(asset, force=true) 跳过引用检查无条件 destroy）——cocos 后端 `setLanguage` 卸包时把打开中的组件还引用着的纹理当场销毁（rebuild 在 swap 之后才跑），渲染帧拿到已释放的帧 → `gpuDescriptors null` / `MovieClip frame released` → 渲染循环死亡、画面全黑。**修法**（backends/cocos/index.ts）：卸载前偷走包的 `_items`（dispose 空转、一个资源不放），rebuild 完成后两帧再自行 releaseAsset。引用计数（addRef）挡不住 force，别走那条路。
2. **包资产引用基线是 0**：fork 的 loader 用 `bundle.load` 装载图集/声音但不持引用，且 atlas 的 Texture2D 是运行时 wrapper（`new Texture2D(); tex.image = bundleAsset`）。
3. **cc 的 `Node.addChild()` 返回 void**：`host = scene.addChild(new Node())` 拿到 undefined → 音效出口建不起来（LGUI-RT-026）。platform/audio.ts 已修。
4. **CC babel loose 的 `[...set]` 坑也存在于用户工程**：example 的 `BagModel.add` 用 `[...new Set(...)]`，h5/esbuild 正常、cocos 构建把整个 Set 变成一个元素 → newIds=[Set] → 红点同步 `id.replace` 崩。**用户工程 src 同样要遵守 Array.from 纪律**（已修 BagModel.ts:193；M2 的 check 规则应考虑扫用户工程）。
5. **`fui_click` 事件链实测全通**：cc 画布 → PointerEventDispatcher（hit test windowId=0）→ GRoot 节点 → fairygui InputProcessor（touch 合成）→ bubbling 到框架手势 → 绑定 click。playwright 的 mouse.click 即可驱动，无需 CDP（T008d 的输入位比预想简单，桌面鼠标模式用真实鼠标事件就行）。

## 遗留

- **fairygui-cc `InputProcessor.clickTest` 边界**：down/up 之间目标被销毁时 `GGraph.findParent` 抛 null（丢一次点击、不致命）——运行库内部，暂不修，记 T008d 参考。
- example 的 `verify.mjs`/`verify-flows.mjs`/`probe*.mjs` 是验收与诊断脚本，留在工程里（dev-only）。
- testbed 已同步同一份修复框架；conformance 桥未回归（T008d 待做，跑 `tests/cocos/run-conformance.mjs`）。

## 续（同日，接 T008d）：conf 桥两颗新雷 + runner 修通 binding-language

example 的输入链打通后，conf 用例第一次真正点击，连爆两颗框架雷（都被 example 验收逼出来）：

1. **clickSound 读 `config.sounds.click` 崩**：conf 工程不配 `sounds`，`setRuntime` 原样存 config 不合并默认值（defaultConfig 注释却承诺「测试里可以只改其中几项」）→ 异常杀死 click 处理链 → clicks 永远 0。修：`setRuntime` 用 `{...defaultConfig, ...config}` 合并（mvc/runtime.ts）。
2. **inputType 分类**：cocos 上鼠标点击被引擎合成成触摸（fairygui 按 touchId≥0 分类 → 'touch'），h5 语义是按真实设备 → 快照对不齐。修：`pointer.ts` 加 `domPointer`（platform 装 DOM pointerdown 监听更新），pointerType 以 DOM pointerType 为地面真相（与 h5 同语义；原生 T012 换引擎输入时另接）。

runner 修正（tests/cocos/run-conformance.mjs）：press 改真实鼠标 down/hold/up（CDP synthesizeTapGesture 在 FGUI 链上不产生 click）、去掉 hasTouch（进触摸模式对不齐 keyboardMouse）、静态服务吃掉 favicon 404（console 错误收集的噪音）。

**全量 15 用例现状：过 2（binding-language、gear-tabs）、待输入 3（combobox/input/slider，操作位未接）、差异 10**（drag/gestures/wheel/tree/stack-keys 等，逐例分析是 T008d 剩余工作）。binding-language 四方快照全绿。
