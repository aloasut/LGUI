# example —— LGUI 示例的独立 Cocos Creator 工程

把 `examples/inventory`（背包示例）完整跑在 Cocos Creator 里，**不复用 testbed**（决策 004：回归场与例子场分离）。CC 3.8.8 + 官方 `fairygui-cc@1.2.2`。

## 跑起来

```sh
node sync.mjs        # 灌界面包/翻译/框架/生成类型/示例 src（别名重写）到 assets/
CocosCreator --project . --build "platform=web-mobile;debug=true"   # CLI 构建（~7s，无需 GUI 预导入）
node verify.mjs      # 无头验收：boot → 点背包 → 关闭 → 切语言，截图到 /tmp/lgui-example/
node verify-flows.mjs  # 扩展流：商店开关 + 领奖 modal 排队连弹
```

工程约定：**CC 设计分辨率 == LGUI 设计尺寸**（settings/v2/packages/project.json，1920×1080）——GRoot vanilla 挂载下 fairygui 的坐标换算和手势坐标系才自洽，改分辨率会让全部点击打偏。

`assets/lgui-ui`（bundle）、`assets/lgui-framework`、`assets/ui-types`、`assets/app-src`、`assets/scripts/lgui-config.ts` 都是 sync.mjs 生成物，不进 git；手写的只有 `sync.mjs`、`Boot.ts`、两个 verify 脚本和工程配置。
