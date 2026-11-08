# 从 FairyGUI 迁移到 LGUI：功能对照

给正在评估或从 FGUI（FairyGUI 编辑器 + 官方运行库工作流）迁移到 LGUI 的团队。LGUI 的界面源就是 FairyGUI 格式（`ui/`），生成链基于 OpenFairyGUI，运行库在三个引擎上都是 FairyGUI（网页用 FairyGUI-dom、Unity 用 FairyGUI-unity、Cocos 用 fairygui-cc）——所以**包格式与运行时渲染能力是同源的**；差异集中在工作流、框架层与个别平台的边界，本文逐项列明。写法细节以 [ui-spec.md](ui-spec.md) 与 [mvc-spec.md](mvc-spec.md) 为准；Unity 与 Cocos 的接入差异见 [unity.md](unity.md) 与 [cocos.md](cocos.md)。

## 工作流对照

| 环节 | FGUI 工作流 | LGUI 工作流 |
| --- | --- | --- |
| 设计 UI | 官方 FGUI 编辑器 | 同源在线编辑器（`lgui editor`，fork 自 FairyGUI-Editor-Online） |
| 发布 | 编辑器导出包文件，手动拷进工程 | `lgui cocos export` / `unity export` / `lgui dev` 自动生成到各端目录 |
| 写逻辑 | 引擎代码直接操作 GComponent/GObject（`CS.*`、`cc.*`、DOM） | 绑定表驱动（Model → 控件），不碰引擎 API（`lgui check` 拦截违例） |
| 验证 | 打开引擎/浏览器人工看 | `lgui test`（headless 快照测试）+ `lgui verify`（横竖屏标准截图）+ 四端一致性运行器 |
| 多语言 | 手工管理 | `lgui i18n extract` 提取 + 文本表 + `lgui check` 校验占位符与漏翻 |
| 美术资源 | 手动切图 | `lgui art split/cut`（AI 生成的大图/图集拆包入 `ui/`） |

## 已对齐的能力（有测试背书）

- **包格式与工程**：FGUI 编辑器保存的工程 LGUI 能读能生成（编辑器实测覆盖模板工程与旧示例）；跨包子组件与跨包图片均支持。
- **核心控件**：image、text、richtext、loader（fill 模式）、graph（矩形/椭圆/多边形命中）、group、list（虚拟化、tree、拖拽滚动）、label、button（Check/Radio）、slider、combobox、inputtext、movieclip、ArtText（动态美术字），以及关联（relation）、转场（transition）、控制器与显示齿轮（gearDisplay）。
- **动效**：编辑器做的转场（tween/yoyo/循环/多目标）在各端原样执行；绑定表用 `playing`/`play`/`done` 驱动。
- **运行时渲染**：三端的渲染层就是 FairyGUI 运行库本身——九宫格、灰度、滤镜、遮罩、像素命中、BMFont 位图字体等渲染能力跟随各端 FairyGUI 版本。
- **四端一致性**：15 个一致性用例（覆盖绑定语言、控件交互、拖放、树、滚轮、横竖屏换版、多语言等）在 headless/h5/Cocos 三端与基准快照**逐字段深比较**全绿；Unity 侧另有完整验证记录（见 [unity.md](unity.md) 末节）。

## LGUI 多出的能力（FGUI 工作流没有的）

- **五层界面栈**：hud/page/popup/modal/toast，激活与遮挡语义（被遮挡的界面定时器和动效自动暂停）、modal 排队、界面包按需加载与引用计数、关闭自动清理。
- **声明式横竖屏**：`@portrait` 组件自动换版，同一个 View 实例换绑保留滚动与选中，游戏代码不写方向判断。
- **headless 可测**：不渲染的后端让业务与界面快照在假时钟下确定性输出；`t.*` 操作（点击/拖拽/打字/滑条/下拉框/安全区注入）语义与真实后端一致。
- **i18n 体系**：固定文字自动提取、占位符校验、`Intl.PluralRules` 复数、数字缩写三端一致。
- **错误码体系**：所有失败带 code/message/next 三元组，不悄悄兜底。
- **AI 工具链**：MCP server（规范检索、骨架生成、校验、测试、截图、导出、引擎预览与运行时检查）让 AI 助手在对话里完成全流程。

## 已知不对齐（现状）

- **从右往左排版的语言**：第一版不支持（RTL）。
- **Unity 的 WebSocket**：未实现（`LGUI-RT-001`）；网页端已实现。
- **MovieClip 画面在网页端不渲染**：h5 端只有 `playing` 与当前帧状态（Unity/Cocos 正常渲染画面）。
- **属性齿轮（gearXY/gearText 等）在 headless 不模拟**：headless 读这类齿轮决定的位置尺寸报 `LGUI-RT-260`；真实后端（h5/Unity/Cocos）按 FairyGUI 原生行为生效。
- **编辑器功能面**：LGUI 的编辑器是 fork 的在线编辑器形态，与官方 FGUI 桌面编辑器的功能集有差距；FairyGUI 相关名称与品牌在 LGUI 分发面已清理。

## 迁移注意事项

- 游戏代码不能调用引擎 API（`CS.*`、`cc.*`、引擎 DOM），一律走 `lgui` 接口——`lgui check` 拦截违例。
- LGUI 工程的界面在 `ui/` 里以 XML 源文件维护（与 FGUI 工程的组件结构同构）；从 FGUI 工程迁移就是把组件 XML 与资源放进 `ui/assets/` 并按 [ui-spec.md](ui-spec.md) 的命名与 ID 规则调整。
- 平台边界（存储/网络/声音/剪贴板）走框架的平台服务，各端实现差异见 [unity.md](unity.md) 与 [cocos.md](cocos.md) 的「已知差异」节。
