# tests/cocos —— cocos 一致性（手动）

T008 四方快照（headless/h5/unity/cocos）的 cocos 侧运行器。手动定位同 tests/unity：不进 npm test，构建耗时（Creator CLI ~1min）是主因，四层全绿后再议进 npm test。

## 用法

```sh
node tests/cocos/run-conformance.mjs [用例名...] [--build]
```

- 不带用例名 = 跑全部 15 个；带名字只跑指定的。
- 构建产物已存在时直接用；`--build` 才触发 Creator CLI 构建（路径默认取 `/Applications/Cocos/Creator/3.8.8/...`，`CC_CREATOR_BIN` 环境变量可覆盖）。
- 输出每用例一行：✅ 过 / ⏳ 输入位待 T008d / ❌ 差异或错误（有 ❌ 退出码 1）。

## 前置条件

1. **fixture 产物进 testbed**：`node lgui-cocos-mcp/testbed/sync.mjs --conformance`（灌 assets/conf-ui + conf-src，改了 fixture 或用例后要重跑）。
2. **testbed 构建**：`node tests/cocos/run-conformance.mjs --build` 或 Creator GUI 手动构建（首次导入必须 GUI 打开过一次，见 plan-tree P001 的 T007 证据）。
3. **Chrome/Edge**（与 e2e 同款探测，没有就跳过）。

## 与 headless/h5 的分工

- 用例、取快照代码（cases/、harness.ts）三端同一份；只有「怎么操作」不同：
  - headless 用 Node 模拟操作（sim 直接驱动控件树）；
  - h5 用 playwright 真实鼠标/触摸/键盘；
  - **cocos 用 CDP 合成输入**：页面侧（ConformanceBoot）把控件中心换算成页面像素，runner 经 `__pw` 派发真实触摸/滚轮/键盘，走 cc 画布 → fairygui InputProcessor → 框架手势的完整链路。不做 `simulateClick` 直呼目标——命中测试也是被测面。
- 坐标换算依据：GRoot 世界矩形（applyDesignSize 覆盖引擎可视区）↔ cc 游戏视口矩形做仿射；页面暴露 `__confProbe()` 导出三层几何，换算有疑时用它校准。**T014 实测补充**：桌面鼠标模式下 playwright 真实 mouse.click 直达绑定（fui_click 全链通，P001 证据 2026-11-08-t014），T008d 的输入位优先走真实鼠标事件，CDP 合成触摸留给触屏模式。

## 输入位现状（T008d 已接齐，2026-11-08）

已接：click / doubleClick / hold / drag / swipe / dragTo / wheel / key / type / setValue / choose / setScreen / advance（15/15 用例全绿，无 ⏳）。
未接：pinch、setSafeArea（现有 15 个用例都不用；用例跑到会抛 T008d 字样，runner 标 ⏳）。

- **type**：点输入框（fairy TOUCH_END → EditBox `openKeyboard` 聚焦隐藏 DOM 输入）→ `selectInput` 全选 → 真键盘逐字打。回写落在字符之间靠框架侧保证：`CocosInput.set text` 聚焦时直写 `_edTxt`（cc EditBox 聚焦期间不把程序化文本传到 DOM）。
- **setValue**：按住 `native._gripObject` 一次拖到目标再松开（只发一次移动）；位移用 `stage.scale` 做设计→页面像素换算（`_barMaxWidth` 是设计单位）。
- **choose**：点开下拉框（此时 `native.dropdown` 才创建）→ 等 100ms 弹出层挂台 → 点列表里的项。
