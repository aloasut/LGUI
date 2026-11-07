# Topic：T008 conformance 四方快照（解法图）

目标：`tests/conformance/` 的用例在 cocos 后端跑出与 headless/h5 相同格式的快照并比对。现状：runner.mjs 的 `conformanceProject()`（lgui init + new module ×3 + writeControls 生成 fixture 工程）、`runHeadless`（Node+esbuild）、`runH5`（playwright 真输入）都可直接复用；**缺的是 cocos 端的「怎么跑」**。

## 架构决策

1. **cocos 端跑在 testbed 的构建里**（与 M1 验收同一条无头链），不复用 h5 的 serveBuilt 页面——cocos 的运行时是 CC 引擎，页面由 CC 构建产物提供。
2. **fixture 产物进 testbed**：`sync.mjs --conformance` 调 `conformanceProject()` 拿到 fixture 工程，`generateCocos` 产 `<testbed>/assets/conf-ui/<包名>/`，并在 Boot（EDITOR 守卫外）按 query 参数 `?conf=<用例名>` 进入 conformance 模式（不进普通冒烟）。
3. **views/别名问题**：cases 与 harness `import 'lgui'` + `../src/...`——CC 工程没有 esbuild alias。方案：sync 时把 fixture 的 src/conformance 拷进 `<testbed>/assets/conf-src/` 并把 `import 'lgui'` 重写为相对路径 `../lgui-framework/index`（脚本内做，不碰仓库源）；cases 里的 `src/` 符号链接同重写。
4. **输入操作**：headless 用 simulate、h5 用真实输入；**cocos 用 simulate**（同 headless 的 sim 对象，跑在真引擎的控件上）——这是「四方」里 cocos 的独特价值：真渲染、假输入，定位引擎差异。触摸类用例（drag/swipe 走真实坐标的）cocos 暂用 sim 等价操作，标注差异。
5. **快照回传**：页面暴露 `window.__confRun(name) => snapshot`，Node 侧 playwright 取回，`assert.deepEqual` 对 headless。
6. **跑法**：先做手动 runner（`tests/cocos/run-conformance.mjs`，同 tests/unity 的手动定位）：构建已存在时直接跑；`--build` 才触发构建。进 npm test 的时机等四层全绿再议（Q：构建耗时 ~1min）。

## 步骤

- T008a sync --conformance（fixture UI + src 重写拷贝）
- T008b Boot 的 conf 模式 + __confRun 桥
- T008c 手动 runner + 首个用例（挑无输入的快照类用例先通，如 binding-language）
- T008d 全用例 + 快照差异逐个修（预期集中在坐标/布局类——headless 不算布局的已知差异在 cocos 上不存在，反而更接近 h5）

## 风险

- cases 若用了 h5 专有内部字段（FairyGUI-dom 的 element/htmlInput）在 cocos 端不存在——按用例逐个适配，cocos 走 native 对应物。
- fixture 的 designSize 与 testbed 场景分辨率不匹配会让控件不可见——conf 模式下 applyDesignSize 用 fixture 工程的 designSize。
