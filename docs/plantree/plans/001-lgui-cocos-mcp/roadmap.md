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

- T008a 完成：sync --conformance（fixture 六包 → assets/conf-ui、src/cases 拷贝进 conf-src 并重写 lgui 别名 ×30）。待 T008b：Boot 的 ?conf= 模式 + __confRun 桥（conf-ui 第二 bundle、confDesign、testing.start 接线）（`lgui-cocos-mcp/testbed/`：package.json/settings/tsconfig 抄自 fork demo；`sync.mjs` 灌界面包+翻译+框架副本+生成 lgui-config；`Boot.ts` 桥接冒烟）。校准点 7（i18n）已在代码里消除——setLanguage 改走 bundle TextAsset。**待办：在 Creator 3.8.2 里实际打开（本机已装），设 lgui-ui 为 bundle、场景挂 LGUIBoot、跑预览**，然后按[校准清单](evidence/2026-11-07-t005-cocos-backend-skeleton.md)逐条核对；五层栈/换版 swap 等测试 View 接入。

## Next

- T008 conformance 四方快照：headless/h5/unity/cocos（桥的实现按 Q3）

## Deferred

- T009 `lgui cocos export` 命令与工程模板（M2 一起考虑 CLI 面）
- T010 MCP server（M2，工具面草案在 topics/mcp-server.md）
- T011 启动/控制 Cocos Creator（M3，自动化面按 Q4）
- T012 原生目标（native shell：剪贴板/IME/返回键另有坑）
- T013 XML 直载链评估（见 ideas/inbox.md）
