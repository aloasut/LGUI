# 004：example 跑通用独立工程，不复用 testbed

日期：2026-11-08 · 状态：已定（用户指示）

## 决定

把 LGUI 的 example（`examples/inventory`）在 Cocos Creator 里完整跑起来时，**新建一个独立的 CC 工程**（落点 `lgui-cocos-mcp/example/`，dev-only），不在 testbed 工程里跑。

## 理由

- testbed 是 M1 冒烟 + T008 conformance 的回归场（`?conf=` 模式、TestbedViews 假 View、conf-ui/conf-src 灌入）。example 要的是完整 MVC 链（真实 View/Controller/Service、存档、音频、i18n、横竖屏），混进去会把回归场污染成例子场，两边互相干扰（RT-062 那次包名冲突就是前车之鉴）。
- 独立工程同时是 M2「工程初始化/包同步」工具面的第一个真实用户——example 跑通即验证 sync 链路可复用到用户工程。

## 工程配方（与 testbed 同源）

- CC **3.8.8**、官方 npm `fairygui-cc@1.2.2`（fork dist 类顺序损坏，见 T007 证据）。
- `assets/lgui-ui/` 为 bundle（generateCocos 产物 + i18n 翻译），场景用 testbed 同款纯 cc 组件 `main.scene`。
- 首次导入需 Creator GUI 打开一次，之后 CLI 构建迭代（T007 校准结论）。
- example 的 `src/` 拷进 `assets/app-src/`，`from 'lgui'` 按深度重写为 `lgui-framework` 相对路径；`from 'lgui/ui'` 全部是 `import type`（编译期擦除），重写到同步进来的生成类型 `assets/ui-types/` 保 typecheck。

## 对其他任务的影响

- T008 四方快照不受影响，仍在 testbed 做。
- M2 的 `lgui cocos export` / 工程模板（T009）以本工程为参照。
