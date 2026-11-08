# 证据：`<transition>` 动效在 cocos 端实跑验证通过（2026-11-08）

## 结论

LGUI 的编辑器动效（FairyGUI Transition，底层 fairygui-cc 的 GTween）在 example 独立工程实跑验证通过。给 `examples/inventory` 的 BagPanel **横竖两版**各加两个 `<transition>`（零代码改动，只有 UI XML）：

- `enter`：autoPlay 淡入，3 项 Alpha stagger（bg 帧 0、标题帧 4、列表帧 8，各 8–10 帧 @24fps）。
- `hintPulse`：autoPlayRepeat="-1" 无限循环，Alpha 1→0.55 `repeat="1" yoyo="true"`（12 帧单程），呼吸右下角操作提示。

## 验证方法与证据

流程：`node sync.mjs` → Creator CLI 构建（6s）→ 两个 dev 脚本（留在工程里，与 T014 的 verify/probe 同例）：

1. **像素证据**（`verify-tween.mjs`，截图 /tmp/lgui-tween/）：
   - enter：开背包瞬间抓中途帧 ≠ 等 1.2s 后的稳定帧（淡入真的在渐变）。
   - hintPulse：稳定后对 touchHint 区域（1120,930 760×80）每 350ms 连拍三张，SHA 两两不同（PNG 编码对相同像素确定，字节同即像素同）。
2. **语义证据**（`probe-tween.mjs`，读 `View.__component.native.getTransition()`）：`hintPulse: playing=true totalTimes=-1 autoPlayTimes=-1`，`touchHint.alpha` 三次采样 0.581→0.941→0.558 振荡；`enter` 放完 playing=false。
3. **回归**：`verify.mjs` 全链（boot→背包→关闭→换语言）照常通过，唯一 pageerror 是 T014 已记录的 fairygui-cc `InputProcessor.clickTest` 边界，非本次引入。`lgui check` 零新增（138 个错误与改动前后完全一致，全是 src/tests 的存量 TS 环境错）。

## 排坑记录

- **动效目标选了空控件 = 视觉上"没动"**：循环动效最初瞄准 `coinFx`（金币数量艺术字），探针显示 alpha 在真实振荡、playing=true，但该控件只在金币变动时有内容，平时渲染为空——alpha 动了没有像素可变，截图三张全同。选动效目标必须选常驻有内容的控件。
- **（2026-11-08 补）hintPulse 目标 touchHint 绑了 `visibleOn: ['touch']`**：T008c 修正 DOM pointerType 分类后鼠标输入下提示按设计隐藏，verify-tween 改 `hasTouch: true` + `touchscreen.tap` 驱动（顺带覆盖真触屏输入链），像素证据恢复成立。
- `autoPlayRepeat="-1"` 经 OpenFairyGUI writer 映射为二进制 autoPlayTimes（int32 -1），fairygui-cc `play(null, -1)` 无限循环，全链路无坑；writer 对 item 的 `repeat`/`yoyo` 也都映射。
- `__lgui`（mvc lgui）不暴露动效状态，语义探针走 `ui.list('page')` 拿 View 实例 → `__component.native`（fgui.GComponent）→ `getTransition(name)._playing/_totalTimes`，这条路可以复用到以后的动效调试。

## 属性支持面（对比 FairyGUI 原生 tween）

- **支持**：编辑器 Transition 全属性走包（time/duration/tween/startValue/endValue/repeat/yoyo/autoPlay/autoPlayRepeat/autoPlayDelay/frameRate；类型随底层 FairyGUI：Alpha/XY/Size/Pivot/Rotation/Scale/Color/Shake…）；MVC 绑定表 `playing`/`play`/`done`；盖住暂停/露出恢复/关闭停止（ViewMotion + h5 补丁 10，cocos 端走 fairygui-cc 自身的舞台语义）。
- **不暴露**：代码式 GTween（`GObject.TweenMove`、`GTween.create`）——框架设计就是动效全走 XML + 绑定表（headless 假时钟可测）。headless 后端只模拟时长（`describeTransition` 按「time + duration×(repeat+1)」取最大换毫秒），不做视觉。
