# 决策 005：`lgui cocos export` 命令的范围与形态（T009）

日期：2026-11-08。状态：已采纳。

## 背景

T009（M2）：把 examples/testbed 两个 sync.mjs dev 脚本验证过的「LGUI 工程 → Cocos Creator 工程」产物链做成正式 CLI 命令，形态对齐 `lgui unity export`（--to 目标工程、owned-path 保护、staging 构建、幂等重导出）。

## 决策

1. **用法**：`lgui cocos export --to <CC 工程路径>`，不接受位置参数（同 unity export）。
2. **目标校验**（错误码 **LGUI-CLI-053**）：
   - 目标有 `package.json` 且 `creator.version` 是 **3.8.x**（当前锚定 3.8.8；`^3.8.` 前缀匹配放宽到 3.8 小版本）。
   - `dependencies` 里必须有 `fairygui-cc@1.2.2`（后端 vendor 官方包的运行时依赖）。
3. **写入面**（整目录替换、防 symlink 逃逸，复用 unity 的 owned-path 思路，错误码 **LGUI-CLI-054**）：
   - `assets/lgui-ui/`：generateCocos 产物（`<包名>/<包名>.bin` + 图集）+ `i18n/`。
   - `assets/lgui-framework/`：框架 TS 源子集（index.ts、env.d.ts、core、mvc、backends/cocos）——CC 只编译 assets/ 下的 TS，h5 vendor 不进（testbed/example sync.mjs 同款裁剪）。
   - `assets/ui-types/`：generateProjectTypes 产物（`'lgui/ui'` 别名落点，纯类型运行时擦除）。
   - `assets/lgui-boot/`：Boot.ts（模板生成：applyDesignSize + boot + `__lgui` 页面句柄）+ `lgui-config.ts`（config/deps/components/texts，生成不手改）。
   - `assets/app-src/`：用户工程 `src/` 拷贝 + `'lgui'`/`'lgui/ui'` 别名按目录深度重写（sync.mjs 同款规则）。
   - `assets/main.scene`：**仅当目标不存在时**创建（模板取自 testbed 清理后的 24 块内置组件场景：SceneAsset/Scene/Canvas/Camera/DirectionalLight，全内置组件、无脚本引用；Boot 是自动启动钩子不依赖场景挂载）。不拷 .meta（CC 导入自动生成 uuid，避免多工程撞 uuid）。已存在的场景永不覆盖——用户可能往里加了东西。
4. **staging**：产物先进 `<工程>/.lgui/build/cocos/export`（LGUI 自己的缓存），全量成功后一次性替换目标目录（unity 同款两段式）。
5. **工程记录**：`.lgui/project.json` 写 `cocosProject`（相对路径），同 unity 的 `unityProject`。
6. **不做**（留给 M2 后续/T010）：Creator CLI 构建触发（构建耗时且需要本机 Creator，导出命令保持纯文件操作）；fairygui-cc 的 npm 安装（校验但不代装，fix 提示 `npm i fairygui-cc@1.2.2`）；场景里自动挂 Boot 组件（自动启动钩子不需要）。
7. **错误码**：053（目标不是 3.8.x CC 工程/fairygui-cc 缺失错版）、054（导出路径链接逃逸/类型不对）；复用 006（用法）、003（已装框架版本不符 → lgui upgrade）、011（插件模板缺失）。

## 后果

- example/testbed 的 sync.mjs 保持 dev 用途（它们还灌 conf/app-src 特例）；正式用户链路走 export。两者产物布局一致（同 decisions/003），sync 的差异只在额外灌 conf-ui / 别名重写范围。
- 产物在 CC 工程里是普通 assets（TS 由 Creator 编译），不需要 UPM 包形态（与 unity 包模板不同——TS 源直接进 assets，Creator 天然支持）。
