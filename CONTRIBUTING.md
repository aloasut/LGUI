# 参与开发

## 仓库怎么分

- `plugin/`：发布面。插件市场只下发这个文件夹，用户机器上看到的就是它的全部内容。这里不能放测试、CI、`package.json`、`node_modules/` 之类的开发文件（随插件带的工具 `plugin/tools/vendor/`、Unity 包模板和新建工程模板除外），`npm run check` 会检查。
- `examples/`：示例工程，不下发。
- `tests/`：开发用测试。
- `scripts/`：开发用脚本（生成清单、发版前校验、编译编辑器等）。

## 日常流程

1. 用 Node 24.22.1。
2. 每个任务从最新的 `origin/main` 建自己的 worktree 和分支：`git worktree add ../LGUI-wt/<任务号> -b lgui/<任务号>-<短名> origin/main`。不在主目录里直接改，因为可能有别的 Agent 同时在这个仓库干活。
3. 改了插件版本或身份，只改 `plugin/plugin.json`，再运行 `npm run generate`。改了根目录的 `CHANGELOG.md` 也要运行它（会复制成 `plugin/CHANGELOG.md`，`lgui upgrade` 要读）。
4. 提交前跑 `npm run check` 和 `npm test`。
5. 一个任务一个 PR。PR 里写：任务号、做了什么、跑了哪些命令和关键输出；没跑的写「未执行」。CI 是红是绿都不拦合入；CI 跑不起来时在 PR 里写明。
6. 合入 main、打 tag、推 tag、删除远端分支、任何对外发布，都要先问 Owner。

## 写代码的约定

- 命令行工具写 `.mjs`（ESM）；框架和用户代码写 TypeScript，不用 `any`。
- 报错一律带错误码（`LGUI-CLI-xxx`、`LGUI-RT-xxx`、`LGUI-UI-xxx`、`LGUI-MVC-xxx`），写明文件和行号（如果有）、出了什么问题、下一步怎么改。不悄悄兜底。新的错误码同步写进 `plugin/references/error-codes.md`。
- 每加一个第三方组件，同一个 PR 里更新 `plugin/THIRD_PARTY_NOTICES.md`。
- 改了用户能感知的行为，同一个 PR 里更新 `plugin/references/` 和技能。文档只写现状。
- 不提交令牌、浏览器配置、凭据、个人绝对路径。

## 怎么更新随插件带的工具

随插件带的工具放在 `plugin/tools/vendor/`（TypeScript、esbuild、OpenFairyGUI、sharp、playwright-core），连同 `node_modules/` 一起提交进 git，用户不用装任何东西。

1. 改 `scripts/vendor-tools.mjs` 开头的版本表。
2. 运行 `node scripts/vendor-tools.mjs`（需要能访问 npm 仓库）。它会在临时目录里按 macOS arm64、macOS x64、Linux x64（glibc）、Windows x64 各装一次（`--ignore-scripts`，不跑安装脚本），合并成一份 `node_modules/`，原生包每个平台留一份；再写 `package.json`、`package-lock.json` 和 `VERSIONS.md`（每个包的版本、许可、大小）。有单个文件超过 100 MB（GitHub 的上限）就停下报错。
3. 运行 `node scripts/tools-smoke.mjs`，5 个工具都要通过（没有 Chrome 也没有 Edge 时浏览器那一项会标「跳过」）。
4. 新增或换掉的第三方包，同一个 PR 里更新 `plugin/THIRD_PARTY_NOTICES.md`。

框架和命令行通过 `plugin/tools/lib/vendor.mjs` 加载这些工具；不在 4 个平台之内时报 `LGUI-CLI-005`。

## 怎么重新编译编辑器

```bash
node scripts/build-editor/build.mjs
```

克隆上游编辑器的固定提交、打补丁（实时会话中转、换品牌）、编译，产物放进 `plugin/editor/`，提交进 git。补丁、Logo 和品牌出现位置的清单都在 [scripts/build-editor/README.md](scripts/build-editor/README.md)。升级上游提交时：改 `build.mjs` 里的 `COMMIT`，重新生成三个补丁，按清单再查一遍页面上有没有 FairyGUI 的名称和 Logo。

## 编辑器实测（S2-I3，2026-10-29）

用 `node scripts/build-editor/check-compat.mjs` 测的，编辑器是 FairyGUI-Editor-Online `45f0bef`（OpenFairyGUI 0.2.4）。

1. **版本兼容：** 模板工程和旧背包示例（当时的 `examples/inventory/legacy/project`，现在在 tag `v0.2.0-final` 里）在编辑器里保存后，0.7.0 都能生成，浏览器里每个包都能加载、每个导出的组件都能创建；模板工程保存后 `lgui check` 没有错误和警告，`lgui verify` 正常。编辑器保存时会重写 XML（属性顺序变了、`package.xml` 多一个空的 `<publish>`、多出 `settings/*.json`），内容不变。
   - **不兼容的地方（已处理）：** 编辑器读工程时会丢掉跨包子组件的 `fileName` 和跨包图片的 `pkg`，于是判定工程「不能无损保存」（`uam_fidelity_unsupported`），整个工程都存不了——官方 FairyGUI 编辑器做的工程（跨包引用都带 `fileName`）也一样。处理：模板和排布模式里的跨包引用去掉 `fileName`；UI 开发规范写明「跨包只写 `pkg` + `src`，图片不跨包」；`lgui check` 加了警告 `LGUI-UI-020`。
   - **2026-11-06 起跨包图片可以用：** `scripts/build-editor/patches/cross-package-image.patch` 让编辑器读写跨包图片时保留 `pkg`，「图片不跨包」的规则和 `LGUI-UI-020` 里图片那一条已经去掉；`check-compat.mjs` 加了跨包图片的用例。跨包子组件写 `fileName` 的情况没改，仍然存不了。
   - **2026-11-08 起模板就是编辑器保存的格式：** 以前 `lgui init` 的工程第一次在编辑器里保存，11 个 XML 被重写、多出 3 份 `settings/*.json`（之后再保存只改动过的那行）。现在 `plugin/templates/project/ui/`、排布模式的 XML（`plugin/templates/patterns/`）和 `lgui new` 新建的 `package.xml` 都按编辑器写出的格式：`<text>` 的 `text` 紧跟在 `size` 后面，跨包子组件的 `pkg` 放在 `size` 后面，`<gear…>` 写在 `<relation>` 前面，图片登记带 `width`、`height`，`package.xml` 带空的 `<publish>`，没有子控件的组件不写 `<displayList/>`，图形写 `ellipse` 不写 `eclipse`，`settings/` 下 `Adaptation.json`、`Common.json`、`Publish.json` 都是 `{}`（没有换行）。改模板以后跑 `check-compat.mjs`：模板工程的 `files.changed` 应该只有被移动的那个文件，`added` 为空。
2. **重新打开会不会读到旧内容：** 会。编辑器的工作副本存在浏览器里，重新打开时恢复的是浏览器里的副本，不会重新读 `ui/`（绑定的文件夹只在保存时比较、写回）。Agent 改了 `ui/` 以后再打开，显示的是旧内容。处理：`lgui editor` 提供只读的 `/__lgui_editor/project`，编辑器（`project-reload.patch`）由 `lgui editor` 打开时每次都从它重新导入；绑定过的文件夹保留，保存仍写回 `ui/`。代价：编辑器里没保存到 `ui/` 的改动，下次打开就没了。

## 许可

原创贡献按 [LICENSE](LICENSE) 提供（PolyForm Shield 1.0.0 加 LumioGames 的附加许可）。提交贡献，就表示你同意 LumioGames 按这份许可发布你的贡献，也可以按别的条件单独授权给他人（比如集成进别的引擎）。第三方素材要写明许可和来源。
