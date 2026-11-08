# 证据：T008c cocos 一致性 runner 全绿——12 过 0 差异 + 3 待输入（2026-11-08）

## 结论

`tests/cocos/run-conformance.mjs` 全量 15 用例：**✅ 12 过、⏳ 3 待输入（T008d：combobox/input/slider 的 type/setValue/choose）、❌ 0 差异 0 错误**。每用例与 headless 快照逐项 deep-equal（runner 内置）。至此 T008c（手动 runner）收口，剩余输入位归 T008d。

## 本轮落地（从 0 过 12 差异到全绿）

**基建三件：**
1. **testbed 场景残留手术**：main.scene 里 DemoEntry 节点挂着 T007 时代已删除的 fork demo 脚本（uuid `d87b8…`），每次加载报 corrupted + 构建指标采集崩溃（exit 36 且被误判构建失败）。带 `__id__` 重映射删除（证据 2026-11-08-t008-rt062.md 早有记录，本轮到期清理）。
2. **testbed 工程 designResolution 1136×640 → 1920×1080**（同 T014 对 example 的校准：工程设计分辨率必须等于 LGUI 设计尺寸，GRoot vanilla 尺寸 = rootSize = 引擎可视区，fairy 两次 y 翻转和命中测试才自洽）。
3. **conf 桥 applyDesignSize**：conf 工程 designSize 与 inventory 不同（1920×1080/1080×1920），conf 模式没人调 applyDesignSize（sync 提示只写在注释里没落地）。ConformanceBoot init 里按窗口横竖取 design + onResize 重贴。

**框架修复五件（都是只有真输入才暴露的缺陷）：**
4. **CLICK_ITEM 签名**（list+tree）：fairygui-cc 的 `GList.dispatchItemEvent` 用 cc 节点事件派发（`_node.emit(CLICK_ITEM, item, evt)`），监听参数是 `(item, evt)`；框架读 `event.initiator` 得 undefined → childIndex -1 → 绑定层按越界静默丢弃。列表 select、树点击在此前从未被测过。修：直接收 item 参数。
5. **键盘 capture**：cc 引擎在 GameCanvas 上的 keydown 处理器 `stopPropagation + preventDefault`——画布聚焦后（点过一次画布就聚焦）document 冒泡监听永远收不到键盘。修：框架键盘监听改 capture 阶段（stack-keys 的 Escape 由此救活）。
6. **滚轮 DOM 地面真相**（`pointer.ts domWheel`）：运行库 `mouseWheelDelta = Math.max(getScrollX(), getScrollY())`，向下滚时 cc scrollY 为负、max 恒得 0——向下滚动量整个丢失（wheel/wheel-delta 实测）。修：platform 挂 capture 级 DOM wheel 监听记录增量，fairy 事件只定命中目标。
7. **空文本归一**：GTextInput 没输入过时 `native.text` 是 undefined，规范语义 `''`（headless/h5 同）。`CocosText.text` getter 归一。
8. **hitDepth 坐标空间 + 指针单位统一**：
   - hitTest 收「fairy 空间」点（GRoot 单位、y 向下），旧实现走 `toWorld` 翻 y → drop 落点全偏（drag-drop 实测；地面真相配对法定位：真实 TOUCH_BEGIN 派发现场 eventPos 与探针点同值、按钮内层 bg 命中，翻 y 的反而不中）。
   - 控件级 `onPointer/onWheel` 上报 fairy 事件原始 pos（GRoot 单位），舞台级（platform root 监听）上报设计单位——两套单位被手势层当同一条流消费，scale≠1 时每次点击都被算成「移过」、click 全灭。修：控件级同样 ÷stage.scale。
9. **引擎设计分辨率跟窗口 EXACT_FIT（T014 不变式推广到任意窗口）**：引擎用工程设置的设计分辨率再缩一层，窗口一变（转屏）就 letterbox + `getVisibleSize()` 陈值 + 两套刻度打架（list-rotate 转屏后点击飞到 y=2408）。修：`syncEngineDesign()` 每次 resize 按窗口重设 EXACT_FIT，设计适配全权交给 stage 缩放；platform `size()` 直接读 `ccScreen.windowSize`（不信陈值的 getVisibleSize）。转屏后 orientation/选中/坐标全对。
   - 注：State B 第一次尝试（只在 init 设一次、size 用 getVisibleSize）失败并回退过；失败根因是上面第 8 条的单位混用，不是 EXACT_FIT 本身。

**运行器一件：**
10. **构建成功判据**：本机 3.8.8 CLI 构建即便产物完整也退出 36（警告走 console.error 就计 exit 码，example 同样 36）。runner 改成「build Task Finished + 产物存在」为准。

## 验证

- 全量：`node tests/cocos/run-conformance.mjs --build` → 12 ✅ + 3 ⏳ + 0 ❌（`/tmp/conf-final.log`）。
- npm test：624/631 过；唯一稳定失败 `dev.test`（改 MainView.xml 5 秒内没推送）在 **HEAD 基线同样失败**（git stash 对照），与本次无关；editor 失败是残留进程占 4174 端口（清掉即过）、dev-verify-dirs 空载即过。
- example 回归：sync 新框架后 `verify-tween.mjs` 全过（触屏驱动；touchHint 绑 `visibleOn: ['touch']`，旧框架把鼠标误判成 touch 所以旧脚本鼠标能看见提示，DOM pointerType 修正后按设计隐藏——verify 脚本改 hasTouch + touchscreen.tap，顺带覆盖真触屏链）。
- `probe-tween.mjs` 语义探针照常（playing=true / alpha 振荡）。

## 方法论沉淀（T008d 直接复用）

- **用例模式探针**（ConformanceBoot `__confProbe(undefined, caseName)`）：包一层 `t.object` 记录每次解析的 sim 坐标 + platform 指针流 + 结束后活体几何（visibleSize/stageScale/gr/viewport/orientation）。本轮 list-rotate/wheel/stack-keys 三个案子的定位都靠它。
- **地面真相配对**：把「真实事件的必中点」和「候选换算点」在同一现场各 hitTest 一遍——坐标空间之争一次定论，胜过纸上推导 fairy 的三重翻转。
- **工程/进程坑**：Creator GUI 开着会占工程锁、CLI 构建挂死（kill 掉再跑）；CLI 构建别信 exit 码。

## 遗留 → T008d

- ~~combobox / input / slider 的 type / setValue / choose~~ **当日已接齐，见下**。剩 setSafeArea / pinch（现有 15 用例都不用）。
- 触屏模式的 CDP 合成触摸（现走桌面鼠标/真实触摸事件已够）。

## 2026-11-08（续）：T008d 操作位接齐 → 全量 15/15 全绿

`node tests/cocos/run-conformance.mjs --build` → **15 ✅ 0 ⏳ 0 ❌**。

- **choose（combobox）**：点开（`native.dropdown` 此时才创建）→ 等 100ms 弹出层挂台 → `centerCss` 点列表项。一次通。
- **setValue（slider）**：按住 `_gripObject` 一次拖到目标（只发一次移动，FairyGUI 只通知一次）。第一版位移系数用 `vp.width/g.width`（=1）全拖过头（changes=[100,0,100]）；`_barMaxWidth` 是设计单位，设计→页面像素的正确系数是 **stage.scale**（0.6667）——修正后 changes=[80,25,100] 与 headless 逐字一致。touchPath 同改。
- **type（input）**：点输入框（fairy TOUCH_END → EditBox `openKeyboard` 聚焦隐藏 DOM 输入）→ 全选 → 真键盘逐字。第一版全小写 `['a','ab','abc']`，与 headless 的 `['a','Ab','ABc']` 差在**回写落在字符之间**：input → Model（大写）→ 绑定把值写回输入框 → 下一个字接在回写后的文字上。根因：cc EditBox 聚焦期间不把程序化文本传到 DOM input（`_edTxt` 是唯一真值，回写只更新 label，全实现无一处 `_edTxt.value=` 写入）。修在框架：`CocosInput.set text` 聚焦时直写 `_edTxt`——h5 的 FairyGUI-dom `element.text` 直写 `_input.value`，语义本就该如此。
- 中间尝试过 sim 层逐字 + `syncInput`（读 `input.text` 回灌 DOM），失败：回写被 EditBox 打回，读到的还是旧值——保护必须在框架写回处。

## 输入位最终形态（runner `__pw` 操作面）

press（真实鼠标按下-保持-抬起，按用例 pointerType 可选 CDP 触摸）/ touchPath / wheel / key / **type**（keyboard.type 逐字）/ **mouseDrag**（一次移动）/ **selectInput**（activeElement.select()）/ viewport。
