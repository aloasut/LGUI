# 证据：T009 `lgui cocos export` 落地（2026-11-08）

## 结论

M2 第一项落地：正式 CLI 命令 `lgui cocos export --to <CC 工程路径>`（`plugin/tools/lib/commands/cocos-export.mjs`，registry 注册）。范围按 [decisions/005](../decisions/005-cocos-export-command.md)：目标校验 CC 3.8.x + fairygui-cc@1.2.2（`LGUI-CLI-053`）、五类生成物 owned-path 整目录替换（`LGUI-CLI-054`）、模板场景缺失才创建、staging 两段式、`.lgui/project.json` 记录 `cocosProject`（schema 已加字段，`project-layout.md` 同步）。

## 验证

- **单测 6/6**（`tests/unit/cocos/export.test.mjs` + 新 helper `tests/helpers/cocos.mjs` 假 CC 工程）：用法 006、版本/依赖 053（三种不合法组合各一个用例，且失败不写目标与工程配置）、无 package.json 053、成功导出五类生成物 + 模板场景 + project.json 记录、重导出幂等（字节级 files hash deepEqual）+ 用户改动的场景不覆盖 + 框架版本不符 003 且不更新、符号链接 054 且不覆盖链接目标。
- **真机验证**：对 `examples/inventory`（真实工程，5 包 + transition 动效）导出到临时 CC 工程：
  - `Bag.bin` 与 example 工程 sync.mjs 灌入的产物 **SHA256 字节级一致**（同一条 generateCocos 链）；
  - `hintPulse` transition 在包里；`app-src` 的 lgui 别名按深度重写（`'../lgui-framework/index'`）；
  - 场景/VERSION 落盘；`.lgui/project.json` 的 `cocosProject` 正确。
- **一致性测试同步**：`cli.test.mjs` 命令清单加 `cocos export`；`project.test.mjs` 字段表比对（project-layout.md 补 `cocosProject` 行——第一版漏写被测试拦下）。
- **npm test 全量**：除 3 个已知环境/存量失败（doctor 的 node 22、dev 两个）外全过。

## 过程排坑

- `project.json` schema 是白名单校验（`project.mjs` fields），新字段必须同时加 schema + `project-layout.md` + `project.test.mjs` 的字段表比对——三处一个都不能漏（第一版漏了文档，被 test 220 拦下）。
- ui-types 产物来自 `generateProjectTypes` 的 `.lgui/build/types`（staging 外的既有缓存），复制时注意 staging 内外路径不要混淆。
- 幂等测试第一次失败即暴露真 bug：VERSION 写 framework、检查读 boot——版本核对空转。测试先行撞出来的。

## 边界（决策 005 的「不做」）

不触发 Creator 构建、不代装 fairygui-cc、不在场景里挂 Boot 组件（自动启动钩子）。~~Creator 打开导出工程的实机端到端预览留待后续补记录~~ **当日已补，见下**。

## 2026-11-08（续）：实机闭环——导出工程 Creator 构建 + 无头验收全通

对 inventory 真实工程的导出产物跑完整链路：目标工程 `npm install fairygui-cc@1.2.2` → Creator CLI 构建（web-mobile）→ 静态服务 + 无头 Chrome：`__lgui` 挂上、boot 后 HudView/MainView 就位、真实鼠标点开背包、截图确认界面完整渲染（标题/页签/列表/详情/按钮）。**启动链全通**。

实机构建抓出两颗雷（都已修，单测同步更新 6/6）：

1. **project-template 混进框架源码**：`backends/cocos/` 整目录拷贝会把新加的 `project-template/`（Boot/场景模板）一起带进 `lgui-framework/backends/cocos/`，模板 Boot.ts 的相对 import 在那个深度解析不了 → CC 编译报模块解析错误。修：cpSync filter 排除 `project-template`；staging boot 目录改为只拷 Boot.ts（原整目录拷会把 main.scene 带进 lgui-boot）。
2. **lgui-ui 缺 bundle 配置**：backend 的 `bundleReady` 按 bundle 名 `lgui-ui` 加载，CC 里目录成为 bundle 要靠文件夹 meta 的 `userData.isBundle + bundleName`——没有它构建产物里没有 bundle 脚本入口，运行时 `Load assets/lgui-ui/index.js failed` 404、启动链挂死。修：导出时写 `lgui-ui.meta`（`isBundle: true, bundleName: 'lgui-ui'`，uuid 每次 randomUUID 防多工程撞 uuid；幂等测试对比排除该文件的 uuid）。

复现路径：`lgui cocos export --to <CC 工程>` → 目标工程 `npm i fairygui-cc@1.2.2` → Creator CLI 构建 → 无头 Chrome 打开 `index.html` 验证 `__lgui` 与界面栈。
