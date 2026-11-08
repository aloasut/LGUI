# P001 Roadmap

任务状态唯一权威。T 编号 Plan 内自增。

## Done

- T001 可行性评估：fairygui-cocos fork 调查 + LGUI Backend/Platform 契约对照，结论「可以，比接 Unity 起点更好」（2026-11-07，报告要点在 topics/cocos-backend.md）
- T002 用户目标澄清与 M1 范围决策（见 decisions/001、002）
- T003 工作区落地：`lgui-cocos-mcp/` 骨架 + 本 plan-tree 立项
- T004 上游基座核查：fork 基点 `cd19b70` **即**上游 `ccc3.0` HEAD（此前「落后 149 commits」的调查结论有误，已更正）；ccc3.0-3.4 分支也不领先。no-op，直接开工 T005（[证据](evidence/2026-11-07-t004-upstream-base-verified.md)）
- T005a Q1/Q2 收口：testbed 新建最小 CC 3.8.2 工程（抄 fork demo 的工程配置）；产物 `assets/lgui-ui/<包名>/` + bundle 加载（见 decisions/003）
- T005 backends/cocos 骨架：vendor fairygui-cc 产物 + objects 全量移植 + platform 九服务 + index + 契约打通（`'cocos'` 加入 backend 联合类型、init 随插件分发清单）；严格 TS 0 错误、init/upgrade 单测过、npm run check 过（[证据](evidence/2026-11-07-t005-cocos-backend-skeleton.md)）
- T006 generate/cocos 分支：`lib/generate/cocos.mjs` 复用 unity 产物格式、按 decisions/003 分包目录输出；单测 4/4 + 回归 21/21（[证据](evidence/2026-11-07-t006-generate-cocos.md)）

## Done（续）

- T014 example 独立工程完整跑通：`lgui-cocos-mcp/example/`（决策 004），inventory 全链（boot/存档/五层栈/真实点击开背包商店/领奖 modal 排队/切语言重建）无渲染错误，CLI 构建无需 GUI 预导入。顺带修掉三颗雷：releaseAsset 强制释放（setLanguage 黑屏，偷 _items 延迟自释）、audio ensureHost 的 addChild void、example src 的 `[...set]` babel loose 坑。**输入链实测**：桌面鼠标模式 playwright mouse.click 直达，无需 CDP 合成触摸（[证据](evidence/2026-11-08-t014-example-standalone-project.md)）
- 动效（transition tween）实跑验证：BagPanel 横竖两版加 `enter`（3 项 stagger 淡入）+ `hintPulse`（yoyo 无限循环）两个 `<transition>`，零代码改动，cocos 端像素+语义双证据通过（autoPlayRepeat="-1" 全链到 fairygui-cc 无坑）。排坑：动效目标选空控件（coinFx）时 alpha 在动但无像素可看；语义探针路数 `ui.list('page')→View.__component.native.getTransition()`（[证据](evidence/2026-11-08-transition-tween-verify.md)）
- **T008c cocos 一致性 runner 全绿**：全量 15 用例 **12 ✅ 0 ❌ + 3 ⏳（T008d：combobox/input/slider 的 type/setValue/choose）**，每用例与 headless 快照 deep-equal。修掉一批只有真输入才暴露的框架雷：CLICK_ITEM 的 cc 节点事件签名（list select/tree 点击此前从未被测过）、键盘 capture（cc 在 GameCanvas 上 stopPropagation，画布聚焦后冒泡监听收不到 Esc）、滚轮 DOM 地面真相（mouseWheelDelta 向下滚恒 0）、空文本归一 `''`、hitDepth 坐标空间（toWorld 翻 y 全偏）+ 控件级指针事件单位统一（混用 GRoot/设计单位 → scale≠1 时 click 全灭）、引擎设计分辨率跟窗口 EXACT_FIT + size() 读 windowSize（转屏 letterbox/陈值/两套刻度）。基建：testbed 场景残留手术、工程 designResolution 1920×1080、conf 桥 applyDesignSize、runner 构建判据改「Finished+产物」（CLI exit 36 是常态）。npm test 无新增失败（dev.test 在 HEAD 基线同败）；example tween 回归过（touchHint `visibleOn:['touch']` 配 DOM pointerType 修正按设计隐藏，verify 改触屏驱动）（[证据](evidence/2026-11-08-t008c-conformance-green.md)）
- **T008d 输入位接齐 → 全量 15/15 全绿（0 ⏳ 0 ❌）**：type（聚焦隐藏 DOM 输入 + 全选 + 真键盘逐字；回写落在字符之间由框架保证——cc EditBox 聚焦期间不把程序化文本传到 DOM，`CocosInput.set text` 聚焦时直写 `_edTxt`）、setValue（拖 `_gripObject` 一次到位；设计→页面像素系数是 stage.scale，不是 vp/gr 比）、choose（点开等弹出层挂台再点项）。runner `__pw` 新增 type/mouseDrag/selectInput 操作（[证据](evidence/2026-11-08-t008c-conformance-green.md)）
- **T009 `lgui cocos export` 落地（M2 第一项）**：命令形态对齐 unity export（`--to`、owned-path 防 symlink 逃逸、staging 两段式、幂等重导出）。目标校验 CC 3.8.x + fairygui-cc@1.2.2（LGUI-CLI-053）；五类生成物整目录替换（lgui-ui/lgui-framework/ui-types/lgui-boot/app-src，LGUI-CLI-054）+ 模板场景缺失才创建（project-template/main.scene 取自 testbed 清理后场景，全内置组件；Boot 是自动启动钩子不依赖场景挂载，不拷 .meta）。decisions/005 定范围。测试：tests/unit/cocos/export.test.mjs 6/6（目标校验/成功导出/幂等/版本不符 003/符号链接 054）+ tests/helpers/cocos.mjs 假工程；真机验证对 inventory 导出，Bag.bin 与 sync.mjs 产物字节一致、app-src 别名按深度重写。文档：references/cocos.md、error-codes 053/054、project-layout cocosProject 字段（project.mjs schema 同步）；npm test 无新增失败（命令清单/字段表两处一致性测试同步更新）（[证据](evidence/2026-11-08-t009-cocos-export.md)）

- **T009 实机闭环（当日续）**：导出工程 npm 装 fairygui-cc → Creator CLI 构建（0 模块解析错误）→ 无头验收启动链全通（boot/MainView/点开背包/截图）。实机构建抓出两颗雷已修：project-template 混进框架源码（cpSync filter 排除）、**lgui-ui 缺 bundle 文件夹 meta**（`isBundle+bundleName` 写进 meta 的 userData，uuid 随机防撞；缺它 bundle 加载 404、启动链挂死）（证据 t009 续段）
- **T010 MCP server 落地（M2 第二项）**：`lgui-cocos-mcp/mcp/server.mjs`——stdio 最小 MCP（手写 JSON-RPC，无 SDK），5 个白名单工具包装 lgui CLI `--json`（check/ui_list/test/verify/cocos_export），口令只有 CLI 一份。decisions/006 **收口 Q5**。协议测试 5/5（真 spawn server 握手 + 真工具调用 + 错误透传）。排坑：CLI 子进程输出后不退出（stdin pipe + OpenFairyGUI/verify 句柄）→ runCli JSON 早结算 + child.kill，spawn stdin 必须 ignore（[证据](evidence/2026-11-08-t010-mcp-server.md)）

- **T011/M3 启动游戏打通（M2/M3 交界）**：[decisions/007](decisions/007-m3-play-via-funplay.md) 收口 Q4——不自研 extension，复用 testbed vendored 的 funplay-cocos-mcp（MIT，编辑器内 streamable HTTP MCP）。lgui-cocos server 新增 3 个代理工具：cocos_preview（Play）、cocos_screenshot、cocos_eval（scene 上下文读 `__lgui` 验收）。顺带根治 MCP server 第三颗雷：CLI 子进程树持有 pipe fd 导致调用方永不 EOF——输出改走临时文件 + 轮询 + SIGKILL（测试进程零孤儿）。协议形状 mock 单测覆盖；实机 Play 联调（Creator GUI 会话）待补（[证据](evidence/2026-11-08-t011-play-via-funplay.md)）

## In Progress

- M1/T008/T009（实机闭环）/T010/**T011 实机 Play 联调全通**（funplay open_scene 打开 main 后预览画面完整渲染——此前「黑屏」根因是 Creator CLI 启动的编辑器当前场景为空、预览跑的是空场景，Owner 点破；cocos_preview 工具已加 scene 参数固化。预览编译链静态枚举坑也在此过程中修掉）。四方中 unity 侧见 tests/unity（另行验证）。
- 全部改动已分 7 个提交落在分支 lgui/cocos-backend-m1；**推送/PR 须 Owner 批准**。

## Next

- M2 工具面按使用反馈扩充（editor props 中转、art split/cut 等）
- 全部改动统一 review 后走提交流程（分支 lgui/cocos-backend-m1 上已 9 个提交；推送/PR 须 Owner 批准）

## Deferred

- T009 `lgui cocos export` 命令与工程模板（M2 一起考虑 CLI 面）
- T010 MCP server（M2，工具面草案在 topics/mcp-server.md）
- T011 启动/控制 Cocos Creator（M3，自动化面按 Q4）
- T012 原生目标（native shell：剪贴板/IME/返回键另有坑）
- T013 XML 直载链评估（见 ideas/inbox.md）
