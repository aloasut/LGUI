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

## In Progress

- T008a 完成：sync --conformance（fixture 六包 → assets/conf-ui、src/cases 拷贝进 conf-src 并重写 lgui 别名 ×30、conf-ui 翻译）。T008b 完成：ConformanceBoot 桥通了（?conf= 模式、conf-ui bundle、__confRun、15 用例注册、场景 launch 等待；Boot.ts 冒烟按 `?conf=` 跳过）。**RT-062 已破案**（[证据](evidence/2026-11-08-t008-rt062.md)）：不是绑定引擎或横竖版差异，是 FairyGUI 按包名全局注册——conf 页面早先被 inventory 冒烟先灌了 lgui-ui 的 `Main` 包，conf 的 `loadPackage('Main')` 静默吞掉同名包，create 出 inventory 版 MainView（无 status）→ 绑定层报 RT-062。Boot.ts 的 `?conf=` 跳过落地后已消失；引擎补了归属校验（同名外来包报 **LGUI-RT-264**，不再静默）。顺带修掉 setLanguage 回归（2e972c6 把翻译目录名 'i18n' 当 bundle 名 → LGUI-RT-011、冒烟页挂死）：改回从 uiBase bundle 读 `<i18nBase>/<语言>` TextAsset。验证：typecheck ok、单测 94/94、conf 页 binding-language 整例通过（英文快照与 headless 逐项对齐，唯一差异是 T008d 待接的输入驱动值 clicks）、冒烟页全绿。T008c 剩手动 runner（`tests/cocos/run-conformance.mjs`），T008d 接 CDP 输入位。

## Next

- T008c 手动 runner + 四方快照（headless/h5/unity/cocos，桥的实现按 Q3）
- T008d 全用例输入位（CDP 合成触摸，方案见 topics/cocos-conformance.md 第 4 条）

## Deferred

- T009 `lgui cocos export` 命令与工程模板（M2 一起考虑 CLI 面）
- T010 MCP server（M2，工具面草案在 topics/mcp-server.md）
- T011 启动/控制 Cocos Creator（M3，自动化面按 Q4）
- T012 原生目标（native shell：剪贴板/IME/返回键另有坑）
- T013 XML 直载链评估（见 ideas/inbox.md）
