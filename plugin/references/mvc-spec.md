# MVC 开发规范

写功能代码时照这份规范做。游戏代码用 TypeScript，只 `import` 自 `lgui`（框架）和 `lgui/ui`（由 `ui/` 生成的控件类型），不直接用 `document`、`window`、`CS.` 这类引擎或平台的 API。这样网页和 Unity 用同一份代码。

## 1. 写功能的固定步骤

1. `lgui new module <名字>` 生成 Model、Controller 和测试的骨架；要连界面和 View 一起生成，加 `--pattern <模式>`（见 UI 开发规范第 7.4 节）。给已有模块加界面用 `lgui new view <包>/<组件> --pattern <模式>`。
2. 在 Model 里写数据和规则，在 Controller 里写操作，在 View 里写绑定表。
3. `lgui check`：类型检查和本规范的检查规则，把报错全部改掉。
4. `lgui test`：用 headless 后端在 Node 里跑测试。
5. `lgui dev` 预览，`lgui verify` 截图看一遍。

## 2. 目录和文件

```
src/
├── main.ts                       # 入口：选后端、注册服务、打开第一个界面
└── modules/
    └── bag/                      # 一个功能一个文件夹，小写
        ├── BagModel.ts           # 数据和规则
        ├── BagView.ts            # 一个界面一个文件；列表子项、部件 View 各自一个文件
        ├── ItemSlotView.ts
        ├── BagController.ts      # 处理操作
        └── BagService.ts         # 跟服务器打交道（需要时才有）
tests/
└── bag.test.ts                   # 测试，用 headless 后端
```

- 文件名 = 导出的类名或对象名的大写形式：`BagModel.ts` 导出 `bagModel`，`BagView.ts` 导出 `BagView`，`BagController.ts` 导出 `BagController` 和 `bagController`。
- 一个文件只写一个 View。

## 3. 角色和调用规则

| 角色 | 负责什么 | 可以调用 | 不可以 |
|---|---|---|---|
| Model | 数据和规则 | 纯逻辑代码 | 依赖界面、服务、平台 |
| View | 对应 `ui/` 里的一个组件，只负责显示和转发操作 | Controller；只读 Model | 修改 Model；访问服务和网络 |
| Controller | 处理操作：修改 Model、调用服务、打开或关闭界面 | Model、服务、`lgui.ui` | 直接操作控件 |
| Service | 向服务器发请求，接收服务器推送 | 平台服务（`lgui.platform.net`） | 操作界面 |

这些规则都由 `lgui check` 检查（第 13 节）。

## 4. 入口 `main.ts`

```ts
import { lgui } from 'lgui';
import { MainView } from './modules/main/MainView';
import { RealBagService } from './modules/bag/BagService';

export default lgui.app({
  backend: 'h5',                                   // 默认后端；lgui test 换成 headless，导出 Unity 时换成 unity
  services: { bag: () => new RealBagService() },   // 注册服务
  async start() {
    await lgui.ui.open(MainView);                  // 打开第一个界面
  },
});
```

要把日志、声音交给宿主（比如 Lumio 引擎）时，加一项 `platform`，见第 14.3 节。

## 5. Model

```ts
// src/modules/bag/BagModel.ts
import { lgui } from 'lgui';

export interface Item { id: string; name: string; count: number; iconUrl: string }

export const bagModel = lgui.Model(
  { gold: 0, items: [] as Item[], selectedId: null as string | null, tab: 'equip' as 'equip' | 'item' },
  (set, get) => ({
    select(id: string) { set({ selectedId: id }); },
    removeSelected() {
      const { items, selectedId } = get();
      set({ items: items.filter(it => it.id !== selectedId), selectedId: null });
    },
  }),
);
```

- `lgui.Model(初始数据, 规则?)`：`get()` 读当前数据；`set(部分字段)` 只改给出的字段；规则函数返回的方法直接挂在 Model 上（`bagModel.removeSelected()`）。
- 界面不需要知道 Model 怎么存，只用 `pick` 读。
- 只有 Model 自己的规则和 Controller 能调用 `set` 和规则方法。

## 6. View 和绑定表

```ts
// src/modules/bag/BagView.ts
import { View, pick, format } from 'lgui';
import type { Bind, Keys } from 'lgui';
import type { BagPanelUI } from 'lgui/ui';
import { bagModel } from './BagModel';
import { bagController } from './BagController';
import { ItemSlotView } from './ItemSlotView';
import { CurrencyBarView } from '../common/CurrencyBarView';

export class BagView extends View<BagPanelUI> {
  static component = 'Bag/BagPanel';
  static layer = 'page' as const;
  static fullScreen = true;
  static params: { tab?: 'equip' | 'item' } = {};

  bind: Bind<BagPanelUI> = {
    gold:       { text: pick(bagModel, s => s.gold, format.number) },
    emptyTip:   { visible: pick(bagModel, s => s.items.length === 0) },
    tabs:       { page: pick(bagModel, s => s.tab), change: tab => bagController.switchTab(tab) },
    list:       { items: pick(bagModel, s => s.items), item: ItemSlotView, key: (it: BagItem) => it.id,
                  selected: pick(bagModel, s => s.selectedId), select: id => bagController.select(id) },
    sellButton: { enabled: pick(bagModel, s => s.selectedId !== null),
                  click: () => bagController.sell(), lockWhilePending: true },
    sellingTip: { visible: pick(bagController.sellRequest, r => r.status === 'pending') },
    salvage:    { hold: { ms: 1000, action: () => bagController.salvage() } },
    equipTab:   { redDot: 'bag.equip' },
    'header.count': { text: pick(bagModel, s => s.items.length, format.number) },
    topBar:     { view: CurrencyBarView },
    keyHint:    { visibleOn: ['keyboardMouse'] },
  };
  keys: Keys = { back: 'close', confirm: { do: () => bagController.sell(), hint: 'bag.sell' } };
}
```

### 6.1 三种 View

| 基类 | 用于 | static |
|---|---|---|
| `View<组件UI>` | 一个界面（放在某一层） | 见 6.2 |
| `ItemView<组件UI, 数据>` | 列表的子项 | 只写 `component` |
| `PartView<组件UI>` | 好几个界面共用的部件（货币栏），跟着所在界面一起打开和关闭 | 只写 `component` |

`组件UI` 类型从 `lgui/ui` 引入，名字是组件名加 `UI`（`BagPanel` → `BagPanelUI`）。

**两处固定写法：**

- 绑定表一定写类型：`View` 写 `bind: Bind<组件UI> = {…}`，`ItemView` 写 `bind: ItemBind<组件UI, 数据> = {…}`，`PartView` 写 `bind: Bind<组件UI> = {…}`；按键表写 `keys: Keys = {…}`。不写类型时，TypeScript 查不出写错的键名。
- `static layer` 写成 `static layer = 'page' as const;`。

### 6.2 View 的 8 项 static

| 项 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `component` | 是 | — | `'<包>/<组件>'`，横版组件名，竖版由框架自动找 `@portrait` |
| `layer` | 是 | — | `'hud' \| 'page' \| 'popup' \| 'modal' \| 'toast'` |
| `fullScreen` | 否 | `false` | 是不是全屏 |
| `params` | 否 | 不收参数 | 打开时能传的参数，写成带默认值的对象 |
| `result` | 否 | 不交回 | 关闭时可以顺带交回什么，只写类型：`static result: { itemId: string };` |
| `inputMode` | 否 | `hud` 层是 `'game'`，其余是 `'ui'` | `'ui'`：只有界面收输入；`'game'`：只有游戏场景收；`'all'`：两边都收 |
| `bothOrientations` | 否 | `false` | 全屏界面没有竖版时写 `true`，表示两种方向共用这一版 |
| `music` | 否 | 不放 | 背景音乐 `'ui://<包>/<声音名>'`，见第 15.1 节 |

写了表外的 static，`lgui check` 报 `LGUI-MVC-003`。

### 6.3 绑定表的键

- 控件名，或者控制器名（控制器只能用 `page` 和 `change`），或者动效名（动效只能用 `playing`、`play`、`done`）。
- 只在这个界面里出现的子组件里的控件：用「.」连起来，`'header.count'`。
- 好几个界面共用的子组件：做成 `PartView`，写 `topBar: { view: CurrencyBarView }`。
- 键名和控件类型由 `ui/` 生成，写错编译就报错。

### 6.4 词表

| 词 | 用在 | 值 | 例子 |
|---|---|---|---|
| `text` | 文字、按钮和标签的标题、输入框、`ArtText` | `pick`（不写固定字符串：固定文字放在 `ui/` 里）；输入框显示 Model 的值，`input` 跑完后框里写回这个值（Model 截断了，框里也截断） | `text: pick(bagModel, s => s.gold, format.number)` |
| `visible` | 任意控件 | 布尔 | `visible: pick(bagModel, s => s.items.length === 0)` |
| `enabled` | 任意控件 | 布尔；`false` 时变灰、不可点 | `enabled: pick(bagModel, s => s.selectedId !== null)` |
| `icon` | 加载器、按钮和标签的图标 | 图片地址 | `icon: it => it.iconUrl` |
| `progress` | 进度条 | 0–100 | `progress: pick(taskModel, s => s.percent)` |
| `value` | 滑动条 | 数字，滑动条自己的单位（在 `ui/` 里写的 min 和 max 之间） | `value: pick(settingsModel, s => s.volume)` |
| `playing` | 序列帧动画 | 布尔：真就播，假就停 | `playing: pick(fxModel, s => s.spinning)` |
| `page` | 控制器 | 页名 | `page: pick(bagModel, s => s.tab)` |
| `redDot` | 有 `redDot` 子控件的控件 | 红点路径；`ItemView` 里可以写成函数，按这一项返回路径 | `redDot: 'bag.equip'`、`` redDot: it => `sign.day${it.day}` `` |
| `items` | 列表、树、下拉框 | 数组。树：每个节点的子节点放在 `children` 字段里；下拉框：每一项显示的文字。列表能滚动（`ui/` 里 `overflow="scroll"`）时自动用虚拟列表（只创建看得见的项），不滚动的列表每一项都创建 | `items: pick(bagModel, s => s.items)` |
| `item` | 列表、树 | 子项（节点）的 `ItemView` 类 | `item: ItemSlotView` |
| `key` | 列表、树 | 认出同一项的函数（参数要写上这一项的类型）；树必须写 | `key: (it: BagItem) => it.id` |
| `selected` | 列表、树、下拉框、Check / Radio 按钮 | 列表、树：选中项的 key；下拉框：选中项的序号，`-1` 表示没有选中；按钮：是否选中（布尔），用户点击时 `click` 交给 Controller 改，选中状态只跟 Model 走；普通按钮（Common 模式）绑定时就报 `LGUI-RT-242` | `selected: pick(bagModel, s => s.selectedId)`、`muteToggle: { selected: pick(soundModel, s => s.muted), click: () => settingsController.toggleMute() }` |
| `view` | 子组件（包括按钮、标签做成的） | `PartView` 类 | `view: CurrencyBarView` |
| `click` / `doubleClick` | 任意控件 | 调用 Controller 方法；写在 `ItemView` 里时参数是这一项的数据 | `click: () => bagController.sell()`、`click: it => shopController.buy(it.id)` |
| `hold` | 任意控件 | `{ ms, action }`，按满才执行；写在 `ItemView` 里时 `action` 的参数是这一项的数据 | `hold: { ms: 1000, action: () => bagController.salvage() }` |
| `drag` / `swipe` / `pinch` / `wheel` / `hover` | 任意控件 | 收到手势参数，调用 Controller 方法；`wheel` 只认落在这个控件（或它里面的控件）上的滚动 | `swipe: e => mapController.pan(e.dx, e.dy)` |
| `change` | 控制器、滑动条 | 用户切页时调用，参数是页名；用户拖动滑动条时调用，参数是新值 | `change: tab => bagController.switchTab(tab)` |
| `input` | 输入框 | 用户改了文字时调用，参数是新文字（输入法还在选字时不调用，选完调用一次）；跑完后框里显示 `text` 绑定的值 | `input: text => searchController.setKeyword(text)` |
| `select` | 列表、树、下拉框 | 用户点选时调用。列表、树：参数是 key；下拉框：参数是序号 | `select: id => bagController.select(id)` |
| `lockWhilePending` | 有 `click` 的控件 | `true`：动作返回的 Promise 结束前保持锁住；结束前界面关了就不再碰控件，动作照常跑完，失败照常报出来 | `lockWhilePending: true` |
| `visibleOn` | 任意控件 | 只在这些输入类型下显示 | `visibleOn: ['keyboardMouse']` |
| `placeholder` | 加载器 | 加载中和失败时显示的图，不写用工程配置的默认占位图 | `placeholder: 'ui://Bag/iconLoading'` |
| `playing` | 动效 | 布尔；为真就播（按 `ui/` 里的播放次数，`-1` 一直循环），为假就停 | `glow: { playing: pick(bagModel, s => s.hasNew) }` |
| `play` | 动效 | 值每变一次播一遍（打开时的值不播），比如一个递增的计数；不能和 `playing` 一起写，不能写在 `ItemView` 里 | `levelUp: { play: pick(heroModel, s => s.levelUps) }` |
| `done` | 动效 | 一次播放放完时调用，调用 Controller 方法（被停掉、重播、界面关闭时不调用） | `done: () => heroController.levelUpShown()` |
| `dragData` | 任意控件 | 能拖起来；值是松手时交给 `drop` 的数据，`null` 时拖不起来（比如空格子） | `dragData: it => it.id` |
| `dragIcon` | 写了 `dragData` 的控件 | 拖起时跟手的图标（图片地址），不写用加载器自己的图片或按钮的图标 | `dragIcon: it => it.iconUrl` |
| `drop` | 任意控件 | 别的控件拖到这里松手时调用，参数是那边的 `dragData`；写在 `ItemView` 里时第二个参数是这一项的数据 | `drop: id => bagController.equip(id)` |
| `roll` | 配 `text`（数字文字）或 `progress`（进度条） | `{ duration, ease? }`（毫秒，缓动默认 `'Quad.Out'`）：值从旧值平滑滚到新值。`text` 的 `pick` 取出的必须是数字，格式化函数每帧对滚动中的数字调用一次，结果变了才写；两端都是整数时每帧取整。打开时直接显示当前值，不滚；滚动中值又变了，从现在显示的数接着滚、重新计时。不能写在 `ItemView` 里 | `gold: { text: pick(walletModel, s => s.gold, format.number), roll: { duration: 500 } }` |
| `tick` | 有显示词的任意一项 | 毫秒（正数）：每隔这么久重新算一遍这一项的显示值（`pick` 的取值和格式化、`ItemView` 里的函数），结果变了才写。被全屏界面盖住时不算，露出来马上算一次 | `eventTimer: { text: pick(eventModel, s => s.endsAt, t => format.duration(t - lgui.time.now())), tick: 1000 }` |

- **显示类的值只有两种写法：** 固定值，或 `pick(数据, 取字段, 格式化?)`。`ItemView` 里写成函数：传入这一项的数据，返回要显示的内容。
- **动作类只调用 Controller 的方法**，一句话写完，View 里不写业务逻辑。
- **点击和手势绑在能接收输入的控件上：** 按钮、组件、列表、有填充的图形。文字、富文本、图片、序列帧动画自己收不到点击（FairyGUI 的各个运行时都这样），绑上去不会触发；`lgui test` 里点它们报 `LGUI-RT-032`。
- **用户改值的控件：** 输入框、滑动条、下拉框、Check / Radio 按钮都是「显示 Model 的值 + 用户改了就调用 Controller」：`text` / `value` / `selected` 显示，`input` / `change` / `select` / `click` 交给 Controller 改 Model，改完再显示回来。Controller 没改（比如截断成和原来一样、拒绝修改），控件也回到 Model 的值。`input` 里同步改 Model：先 `await` 别的再改，框里会先回到旧值。
- **手势速度按输入实际发生时间计算。** 网页保留原始 DOM `event.timeStamp`，浏览器主线程延迟处理事件时，也不会用消费时刻把慢拖压成快滑。
- **绑定表里不写死用户能看到的文字。** 固定文字放在 `ui/` 里，动态文字用 `lgui.t`。
- **动效：** `ui/` 里勾了自动播放的照旧自动播放，写了 `done` 时放完也通知。界面被全屏界面盖住时，它里面在放的动效（绑定的和自动播放的）都暂停，露出来接着放；界面关闭时停掉。动效放完不能当作业务完成（发奖、扣钱以 Controller 的结果为准）。
- **拖放（游戏式）：** 被拖的控件不动；拖起时框架在最上面放一个跟手的临时图标（不接收输入），松手就去掉。松在写了 `drop` 的控件上才调用 `drop`，由 Controller 改 Model，列表按数据重画；松在别处什么也不改。只认激活界面里可用的控件；落点重叠时取最里面的（格子在列表里面，算格子的）。
- **没写进绑定表的控件，代码里一律不碰。** 特殊情况用生命周期钩子（第 9 节），钩子里用 `this.ui.<控件名>`：可以读控件、调用控件的方法，但不给控件的属性赋值。旋转、换语言时组件会重建，钩子里赋的值就丢了；要显示的东西都写进绑定表（`lgui check` 报 `LGUI-MVC-020`）。
- **不写坐标和尺寸。**
- **倒计时：** `pick` 取截止时间，格式化函数里减去 `lgui.time.now()`（已和服务器对齐），配 `tick`。`tick` 不和整秒对齐，秒数最多晚不到一个 `tick` 跳；要跳得更准就把 `tick` 写小（比如 250），字符串没变不写，代价很小。归零以后的业务（活动结束）由 Controller 按服务器推送或自己的计时处理，界面上的倒计时只管显示。`this.countdown` 留给每秒要做别的事的特殊情况。
- **会动的东西：** 用到运行时才知道的（新旧数值、截止时间、第几个、有几个、出了什么事）写代码：绑定的 `roll` / `tick`，或者 `this.tween`（第 16 节）；固定的（入场、常驻的呼吸和闪烁、按钮按下）写进 `ui/`。

### 6.5 `pick`

`pick(来源, 取字段, 格式化?)`：来源可以是 Model、`lgui.request` 包好的请求，或者任何有 `get` 和 `subscribe` 的东西。数据一变就重新取值，取出的值没变（`Object.is`）就不刷新，所以只改金币时，监听道具列表的控件不会重画。订阅在界面关闭时自动取消。

## 7. Controller

```ts
// src/modules/bag/BagController.ts
import { lgui, Controller } from 'lgui';
import { bagModel } from './BagModel';
import type { BagService } from './BagService';

const bagService = lgui.service<BagService>('bag');

export class BagController extends Controller {
  sellRequest = lgui.request((id: string) => bagService.sell(id));

  select(id: string) { bagModel.select(id); }
  switchTab(tab: 'equip' | 'item') { bagModel.set({ tab }); }

  async sell() {
    const id = bagModel.get().selectedId;
    if (!id || !(await lgui.confirm({ title: 'bag.sellTitle', message: 'bag.sellAsk' }))) return;
    const r = await this.sellRequest.run(id);
    if (r.ok) {
      bagModel.removeSelected();
      lgui.toast('bag.sold', { count: 1 });
    }
  }
}
export const bagController = new BagController();
```

- `lgui.request(函数)` 把一个请求包一层，返回请求对象：
  - `run(...参数)` 返回 `{ ok, value, error }`；状态依次变成 `pending` → `succeeded` 或 `failed`，没跑过时是 `idle`；
  - 超时按工程配置 `requestTimeoutMs`（默认 10 秒），报 `LGUI-RT` 错误码；
  - 失败不抛错：`run` 返回 `{ ok: false, error }`，记一条 `warn` 日志（第 14 节）；工程配置 `requestErrorToast` 为 `true`（默认）时自动弹出统一的错误提示；
  - 界面用 `pick(bagController.sellRequest, r => r.status === 'pending')` 读状态。
- Controller 不能碰控件。
- `await` 之后要关界面、换界面时，目标界面已经关了，框架就跳过并记一条 `info` 日志（`LGUI-RT-082`）。
- 放音效用 `lgui.sound.play`（第 15.3 节），只在 Controller 里用。

## 8. Service

```ts
// src/modules/bag/BagService.ts
import { lgui } from 'lgui';

export interface BagService {
  sell(id: string): Promise<{ gold: number }>;
}

// 真实实现：通过平台服务发请求
export class RealBagService implements BagService {
  async sell(id: string) {
    const res = await lgui.platform.net.fetch(`/api/bag/sell?id=${encodeURIComponent(id)}`, { method: 'POST' });
    return (await res.json()) as { gold: number };
  }
}

// 测试用的假实现
export class FakeBagService implements BagService {
  async sell() { return { gold: 100 }; }
}
```

- 先写接口，再写真实实现和假实现。`main.ts` 注册真实实现，测试里注册假实现。
- Controller 用 `lgui.service<接口>('名字')` 拿服务，不直接 `new`。
- 服务器推送：Service 用 `lgui.defineEvent` 声明事件并广播，Controller 收听后改 Model。

## 9. 生命周期钩子

钩子都是可选的，写在 View 上。钩子里注册的监听、定时器，都由框架在关闭时自动清理。

| 钩子 | 什么时候 |
|---|---|
| `onOpen(params)` | 界面打开，资源准备好、绑定完成之后 |
| `onActivate()` / `onDeactivate()` | 变成激活的界面时 / 被别的界面压住时 |
| `onCovered()` / `onRevealed()` | 被全屏界面盖住时 / 重新露出来时 |
| `onOrientationChange(orientation)` | 屏幕方向变了，只在特殊情况用 |
| `onClose()` | 界面关闭前 |

**顺序：**

- 打开：加载资源 → 创建 → 绑定 → `onOpen` → `onActivate`
- 被压住：`onDeactivate`
- 关闭：`onDeactivate`（如果当时是激活的）→ `onClose` → 解绑和清理 → 销毁或缓存 → 释放资源

屏幕旋转、切换语言时，View 实例保留，只重建组件，不调用 `onOpen` 和 `onClose`。所以钩子里不写控件属性，只写绑定表（`lgui check` 警告 `LGUI-MVC-020`）。

- 绑定表在新组件上重新绑一遍，显示的内容按当前数据和语言重新取。
- View 里的 `PartView` 实例也保留，定时器和收听接着走；列表子项（`ItemView`）和子项里的部件跟着列表重建。
- 钩子里给控件属性赋的值不会重新赋，所以钩子里不写控件属性（第 6.4 节）。

## 10. UIManager：`lgui.ui`

| 写法 | 作用 |
|---|---|
| `lgui.ui.open(BagView, { tab: 'equip' })` | 压栈打开，返回 Promise；参数类型来自 `static params` |
| `lgui.ui.open(PickerView, { slot: 'weapon' }, { onClose: picked => … })` | 打开，并在它关闭时通知打开它的一方 |
| `lgui.ui.replace(ShopView)` | 替换当前栈顶 |
| `lgui.ui.close(BagView)` / `lgui.ui.close(PickerView, { itemId })` | 关闭；可以顺带交回 `static result` 声明的东西 |
| `lgui.ui.back()` | 和按返回键一样 |
| `lgui.ui.popTo(MainView)` | 一直关到指定界面 |
| `lgui.ui.closeAll('popup')` | 关闭某一层的全部界面 |
| `lgui.ui.isOpen(V)`、`get(V)`、`top(层?)`、`list(层)` | 查询 |
| `lgui.ui.find('Bag/BagPanel.sellButton')` | 控件在设计尺寸下的位置和大小，只读 |

- 5 层从下到上：`hud`、`page`、`popup`、`modal`、`toast`。`hud`、`page`、`popup` 各是一个栈；`toast` 不收输入。
- **`modal` 是队列：** 同一时间只显示一个，按打开的先后排。前一个关掉、打开失败、或者还没显示就被关掉，下一个照常弹出。`lgui.loading` 不进队列，直接盖在最上面。
- 所有层合起来最上面那个界面是激活的，只有它收输入。
- 打开全屏界面时，下面的界面都被盖住（隐藏、暂停定时器和动效）；关掉后自动露出来。
- `hud` 层的界面和 `page` 层最底下的主界面按返回键关不掉；`keys.back` 写成函数时照常调用。
- **再打开一个已经打开（或正在打开）的界面：** 参数相同时返回同一个 Promise（按值比较：普通对象、数组逐项比，不管键的顺序；不传参数等于传 `static params` 的默认值）；参数不同报 `LGUI-RT-240`，不静默丢掉这次的参数——要依次显示好几份（比如几份奖励），在 Controller 里排队，前一个关了再开下一个。这次又登记了 `onClose` 时报 `LGUI-RT-084`（这个回调不会被调用）。
- `popTo`、`closeAll` 全部关完才重新算一次激活：要关掉的界面收不到 `onActivate`、`onRevealed`。
- **`onClose`：** B 不管怎么关（自己关、返回键、`closeAll`、`replace`）都调用一次；没交回东西时参数是 `undefined`；打开 B 的界面先关了，回调自动取消；旋转、换语言不算关闭。
- 一个模块不能去改另一个界面的控件；要改就改它监听的 Model。

### 10.1 返回键和按键动作

```ts
keys: Keys = {
  back: 'close',                                                  // 'close' 关闭自己（默认）；'none' 不让返回；或者写一个函数
  confirm: { do: () => bagController.sell(), hint: 'bag.sell' },  // hint 是文本键，显示在操作提示栏
};
```

- 默认映射：`Escape`、安卓返回键 → `back`；`Enter` → `confirm`。工程配置 `keyMap` 可以按平台改写。
- 不带 `hint` 的动作不进操作提示栏，返回键例外（默认显示「返回」）。

## 11. 常用工具

| 写法 | 作用 |
|---|---|
| `lgui.toast('bag.sold', { count })` | 短提示，放在 `toast` 层 |
| `await lgui.confirm({ title, message, ok?, cancel?, params? })` | 确认框，返回 `true` / `false`；参数都是文本键，`params` 填占位符。一次只显示一个，后来的排队；被代码关掉（`closeAll`、`popTo`、`close`）或取消时，它和排队中的都返回 `false` |
| `lgui.loading.show()` / `hide()` | 加载中，按次数计数，最后一次 `hide` 才消失 |
| `lgui.redDot.set('bag.newItem', true \| false \| 3)` | 红点；上层路径自动汇总，数字显示合计 |
| `lgui.t('bag.sold', { count })` | 取文本，占位符写成 `{count}` |
| `format.number(n)`、`format.compact(n)`、`format.date(d)`、`format.currency(n, 'CNY')` | 按当前语言格式化；`compact` 是数字缩写：中文 `1.6万`、`1.2亿`、`1万亿`（日文、繁体中文是 `兆`，韩文 `조`），英文 `16.3K`、`1.2M`、`1T`，最多一位小数，四舍五入后够到下一个单位就进位（`999.95` → `1K`，中文 `9999.95` → `1万`），不到缩写的单位时原样（中文 `9999`、英文 `999`）；三端都用框架内置的规则、不用 Intl，同一个数各端显示一样 |
| `lgui.setLanguage('en')` | 切换语言，已打开的界面自动重建。同时调用几次按调用顺序一个一个切；切换期间（后端换界面包的那一段）已打开的界面先不刷新，切完按当时的数据显示，期间打开的界面（包括排队轮到的 modal）等切完再显示 |
| `format.duration(毫秒, 'clock' \| 'units')` | 时长，向上取整到秒，负数当 0。`'clock'`（默认）是 `05:09`，满 1 小时是 `1:02:03`；`'units'` 取最大的两个单位：`1天2小时`、`5分9秒`（第二个单位是 0 就不写：`1天`），单位用框架文本键 `lgui.time.day` / `hour` / `minute` / `second`（和 `lgui.back` 一样放在每种语言的文本表里，`lgui check` 查），三端一样、不用 Intl。写法不认识报 `LGUI-RT-285` |
| `lgui.time.now()`、`lgui.time.setServerOffset(毫秒)` | 当前时间（和服务器对齐） |
| `await lgui.time.wait(毫秒)` | 等一段时间（Service 模拟延迟、重试间隔用；界面上的定时器用 View 的 `this.after`）。按帧累计，切到后台时不走；请求超时也是这样算的 |
| `lgui.log.info('bag_opened', { count })` | 写日志（第 14.2 节） |
| `await lgui.platform.clipboard.writeText(uid)`、`readText()` | 剪贴板（只在 Controller 里用）：放进文字、读出文字。读写不了时 Promise 失败（`LGUI-RT-241`，比如网页不是 https、浏览器拒绝），用 `lgui.request` 包一层拿 `{ ok }`；网页里写入放在点击动作里直接调用，不要先 `await` 别的 |
| `lgui.sound.play(…)`、`setVolume`、`setMuted`、`settings` | 声音（第 15 节） |

**文本表 `i18n/<语言>.json`：** 扁平的「键 → 文字」，键名是可读的点号键。要按数量变化的文字，值写成按复数形式分开的对象，用参数 `count` 选（形式名和 `Intl.PluralRules` 一致；中文、日文、韩文只写 `other`）：

```json
{
  "bag.sold": "已售出 {count} 件",
  "bag.items": { "one": "{count} item", "other": "{count} items" }
}
```

找不到键是写错了（`LGUI-RT-090`，第 14.1 节）：`lgui dev`、`lgui test` 里直接抛错；正式构建里界面上显示键名，并记一条 `error` 日志（同一个键只记一次）。框架自己用到的键 `lgui.back`、`lgui.requestFailed` 也要在每种语言的文本表里（`lgui init` 生成的文本表里有）。启动时的语言：系统语言里第一个工程支持的，都不支持就用 `defaultLanguage`。

**定时器**（写在 View 里用 `this.`，跟着界面走：被盖住时暂停，关闭时取消）：

```ts
onOpen() {
  this.after(500, () => …);                       // 延时一次
  this.every(1000, () => …);                      // 重复
  this.countdown(eventModel.get().endsAt, left => eventController.tick(left), () => eventController.end());
  this.onUpdate(dt => …);                         // 每帧
}
```

倒计时每次都按「结束时间 − 现在」算，切到后台再回来也不会走偏。

回调出错时，错误照常报出来（网页上是页面里未捕获的错误，`lgui test` 里这个测试失败），但不影响别的定时器和以后的帧；`after` 和倒计时的结束回调出错也只执行这一次。

**广播站：**

```ts
// 声明（放在发事件的模块里）
export const rewardClaimed = lgui.defineEvent<{ id: string }>('rewardClaimed');
// 发
lgui.emit(rewardClaimed, { id });
// 收（View 里关闭时自动取消；Controller、Service 里跟着整个游戏走）
this.on(rewardClaimed, e => …);
this.on(lgui.events.viewClosed, e => { if (e.view === ShopView) bagController.reload(); });
```

框架自己的事件在 `lgui.events` 下：`viewOpened`、`viewClosed`、`viewCovered`、`viewRevealed`、`orientationChange`、`languageChange`、`inputTypeChange`、`inputModeChange`。

要显示的数据放 Model；「发生了一件事」用广播站；只有打开它的界面需要知道的，用 `onClose`。

## 12. 测试

```ts
// tests/bag.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgui } from 'lgui';
import app from '../src/main';
import { FakeBagService } from '../src/modules/bag/BagService';
import { BagView } from '../src/modules/bag/BagView';

test('选中道具后出售，金币增加', async () => {
  const t = await lgui.testing.start(app, { services: { bag: () => new FakeBagService() } });
  await t.open(BagView);
  await t.click('Bag/BagPanel.list[0]');           // 列表第 1 项
  await t.click('Bag/BagPanel.sellButton');
  await t.click('Common/Confirm.ok');
  assert.equal(t.text('Bag/BagPanel.gold'), '100');
  t.end();
});
```

`lgui.testing.start(app, 选项?)` 用 headless 后端和假时钟启动（`lgui test --browser` 换成 h5 后端和真浏览器，写法一样），返回的对象有：

| 方法 | 作用 |
|---|---|
| `open(View, 参数?)` | 打开界面 |
| `click(路径)`、`hold(路径, 毫秒)`、`drag(路径, dx, dy)`、`dragTo(从哪, 到哪)`、`swipe(路径, dx, dy)`、`pinch(路径, 比例)`、`wheel(路径, dy)`、`key(按键名)` | 模拟操作；`dragTo` 是拖放：从一个控件拖到另一个控件上松手 |
| `type(路径, 文字)`、`setValue(路径, 值)`、`choose(路径, 序号)` | 模拟改值：在输入框里打字（先点一下、全选，再一个字一个字地输入，每个字调用一次 `input`，第二个字起接在框里现在的文字后面；遵守 `ui/` 里的 `maxLength`，满了以后再打的字进不去；空字符串清空）；把滑动条拖到某个值（夹在范围内、按 `ui/` 的设置取整，值变了才调用 `change`）；点开下拉框选第几项（从 0 开始） |
| `text(路径)`、`visible(路径)`、`enabled(路径)`、`page(路径)`、`items(路径)`、`value(路径)`、`playing(路径)` | 读控件属性：文字（字符串；按钮、标签的文字显示在名为 `title` 的子控件里，没有这个子控件时报 `LGUI-RT-262`）；显示（布尔，「真的显示」：自己和各级父组件都显示，也没被齿轮或组藏起来）；可用（布尔）；控制器当前页（页名）；列表项数、树显示着的节点数（数字）；滑动条、进度条的值，下拉框的选中序号（数字）；序列帧动画是否在播放（布尔）。headless 里文字、可用状态由改属性的齿轮（`gearText`、`gearLook`）决定时报 `LGUI-RT-260` |
| `setScreen(宽, 高)`、`setLanguage(语言)`、`setInputType('touch' \| 'keyboardMouse')` | 模拟旋转、换语言、换输入设备 |
| `advance(毫秒)` | 让时钟往前走：headless 是假时钟，按每帧 16 毫秒走；`--browser` 是真的等（一次最多 10 秒） |
| `sounds()` | 放过的音效，按顺序：`[{ url: 'ui://Common/click', volume: 1 }]`（音量是最终音量） |
| `music()` | 正在放的背景音乐（`'ui://Common/bgm'`），没有是 `null` |
| `look(路径)` | 控件现在的样子：`{ dx, dy, scaleX, scaleY, rotation, alpha, width, height, color?, fontSize?, fillAmount? }`，每一项和 `this.tween` 同一个意思（`dx`、`dy` 是相对 `ui/` 里位置的偏移，其余是绝对值；缩放含按钮的按下效果），控件没有的几项是 `undefined`。打字机露到哪用 `text` 读，进度条用 `value` 读。headless 里尺寸由布局决定、补间又没碰过时，读 `width` / `height` 报 `LGUI-RT-260`；透明度、旋转归 `gearLook` 管时也报 |
| `snapshot()` | 返回 `lgui.debug.snapshot()`；`views[i].tweens` 是这个界面正在跑的补间数（含 `roll` 和按钮的按下效果） |
| `end()` | 关闭所有界面、清掉界面缓存（`uiCache.keepClosedViews`），检查监听、定时器和补间都已清理（补间的帧回调也退订了） |

路径写成 `<包>/<组件>.<控件路径>`；列表子项用 `list[序号]`，树的节点也一样（`tree[序号]` 是显示着的第几个节点）。

**怎么跑：**

```bash
lgui test                                   # tests/ 里的全部测试，headless
lgui test tests/bag.test.ts tests/shop/     # 只跑这些文件、这些目录里的测试文件
lgui test --name 出售                        # 只跑名字（连同所在 describe 的名字）里含「出售」的测试
lgui test tests/layout.test.ts --browser    # 在真浏览器里跑（h5 后端）
```

输出写清跑了几个文件（指定了文件时还有 `tests/` 里一共几个）、几个测试，通过、失败、跳过（`skip`、`todo`）、按 `--name` 筛掉了几个；`--json` 里每个失败的测试带原因。路径写错报 `LGUI-CLI-130`，`--name` 一个也没匹配到报 `LGUI-CLI-131`。

**headless 照浏览器的规则执行，不算渲染：**

- **规则和浏览器一样，照样报错：** 控件树、属性、控制器、显示齿轮（`gearDisplay`、`gearDisplay2`）和组；动效按 `ui/` 里写的时长走；点不到的控件报 `LGUI-RT-032`；只有能滚动（`overflow="scroll"`）的列表能设成虚拟列表（`LGUI-RT-261`）；按钮、标签的文字写进 `title` 子控件；点 Check 按钮切换选中、点 Radio 按钮选中；打字遵守 `maxLength`。
- **渲染 headless 不算，读到就报 `LGUI-RT-260`：** 关联（relation）、列表和组的排布、文字自动大小和排版度量（`autoSize` 是 both、height）、加载器的自动大小（`autoSize="true"`，尺寸跟着图片）、控件或组上的 `gearXY` / `gearSize`（组上的 `gearSize` 只有带排布的组才改组里控件的尺寸，和 FairyGUI 一样）决定的位置和尺寸。`lgui.ui.find` 读到它们（控件自己或路径上的上级受影响）时报错，写明是哪个控件、哪个原因；不受影响的照常返回（`ui/` 里写的值、框架摆的界面和 `safe`）。屏幕尺寸、安全区变了以后，受关联影响的控件位置会变，这些在 headless 里本来就报不支持。
- **改属性的齿轮 headless 不模拟，读到就报 `LGUI-RT-260`：** `gearText`（文字）、`gearColor`（颜色）、`gearIcon`（图标、加载器的地址）、`gearLook`（可用、能不能点，还有透明度、旋转）、`gearFontSize`（字号）管着的属性跟着控制器的页变。读它（`t.text`、`t.enabled`，或者代码里直接读）、点它（有 `gearLook` 的控件和它的上级 headless 不知道能不能点）都报错，写明是哪个控件、哪个齿轮、哪个控制器。代码自己写过这个属性以后（比如绑定写了文字）headless 就知道它，直到这个控制器再换页。
- **headless 不模拟、也不报错的（要看就用 `--browser` 或 `lgui verify`）：** 命中测试（被同级控件挡住的按钮 headless 照样点得到，`--browser` 报 `LGUI-RT-032`）；虚拟列表的回收（headless 里每一项都有对象；浏览器里看不见的项没有对象，`list[序号]` 拿不到，先滚过去）；按钮直接绑控制器、按钮选中时的 `selectedTitle`；悬停时按钮的 over 页。

**什么时候用 `--browser`：** 要测位置、尺寸、安全区、文字排版、谁挡住了谁、改属性的齿轮换页以后的样子，或者确认 headless 绿了的测试在浏览器里也对。同一个测试文件、同一套 `t.*`，在 Chrome 或 Edge 里用 h5 后端跑，点击、拖拽、打字发的是真实的鼠标、触摸、键盘输入。和 headless 的差别：

- 每个测试开一个新页面：Model 等模块状态每个测试都是新的，`before`、`after` 每个测试各跑一次。
- `t.advance` 是真的等，一次最多 10 秒；动效、请求按真实时间走。
- 测试文件只能 import `node:test` 和 `node:assert/strict`（别的 Node 模块打包时报错）；子测试（`t.test`）、`mock`、`done` 回调、`async` 的 `describe` 报 `LGUI-RT-263`，这样的测试只在 headless 里跑。
- 要装 Chrome 或 Edge（没有报 `LGUI-CLI-132`）；生成物在 `.lgui/build/test/browser/`。

- **假时钟：** 点了按钮以后，打开新界面、请求返回都要等一帧，先 `await t.advance(16)` 再读；一串请求就多等几帧。动效按 `ui/` 里写的时长走：要等 `done`，就 `await t.advance(动效的毫秒数)`。**跨天、几小时这类长时间推进用 `lgui.time.setServerOffset(毫秒)`，不要用 `t.advance` 一帧一帧推**（headless 按帧走，推一天要五百多万帧；`--browser` 里是真的等）。
- **每个测试结束时都清干净：** 没调 `t.end()` 的，`lgui test` 在测试结束时补上：测试通过了照样关界面、查泄漏和 `error` 日志（有问题这个测试失败）；测试已经失败了（比如 `t.end()` 之前的断言没过）只把界面全关掉、缓存清掉，不再加新的错，同一个文件后面的测试不受连带。
- **记了 `error` 日志也算失败：** 代码或界面写错了（第 14.1 节），或者游戏代码自己 `lgui.log.error(…)`，这个测试失败，报 `LGUI-RT-176` 并写明是哪条日志。外部失败（请求、网络图片、声音加载）记 `warn`，不算失败。`--browser` 一样。
- **日志和声音总是记进测试：** `lgui.app({ platform })` 在 `lgui test` 里不生效。
- **整个文件没跑起来也算失败：** 测试文件加载时出错（顶层抛错、import 失败）或者测试结束后还有没处理的错误，`lgui test` 把这个文件记为失败（失败项是 `tests/` 里的文件名）。
- **Model 在测试之间不重置**（headless 里同一个测试文件的测试共用一份）：给 Model 加一个 `reset()` 规则，在 `beforeEach` 里调用：

```ts
import { test, beforeEach } from 'node:test';
beforeEach(() => bagModel.reset());
```

## 13. 检查规则表

`lgui check` 用语法树检查，不靠字符串匹配。报错格式：`文件:行:列  错误码  说明  → 怎么改`。

| 错误码 | 规则 | 正确写法 | 错误写法 |
|---|---|---|---|
| `LGUI-MVC-001` | 游戏代码只 import `lgui`、`lgui/ui` 和工程内的相对路径；不用 `document`、`window`、`globalThis`、`CS`、`localStorage`、`fetch` 等平台全局对象（工程里自己声明的同名变量、参数不算） | `lgui.platform.net.fetch(…)` | `fetch(…)`、`document.body` |
| `LGUI-MVC-002` | View 写了必填的 `component` 和 `layer` | `static layer = 'page'` | 没写 `layer` |
| `LGUI-MVC-003` | View 只写 6.2 表里列出的 static；`ItemView`、`PartView` 只写 `component` | — | `static cache = true` |
| `LGUI-MVC-004` | static 的值合法：`layer` 是 5 层之一，`component` 是存在的导出组件，`inputMode` 是 `ui`/`game`/`all`，`music` 是登记在 `ui/` 里的 mp3 音效（`ui://包名/音效名`） | `static layer = 'popup'`、`static music = 'ui://Bag/bgm'` | `static layer = 'dialog'`、`static music = 'bgm.mp3'` |
| `LGUI-MVC-005` | 绑定表的键是组件里真实存在的控件、控制器、动效或点号路径 | `'header.count'` | `'header.cnt'` |
| `LGUI-MVC-006` | 绑定表只用词表里的词；控制器只用 `page`、`change`；动效只用 `playing`、`play`、`done` | `{ text: … }` | `{ label: … }`、控制器上写 `visible` |
| `LGUI-MVC-007` | View 里显示类的值是固定值或 `pick(…)`；`ItemView` 里是函数 | `pick(bagModel, s => s.gold)` | `bagModel.get().gold` |
| `LGUI-MVC-008` | 动作类的值只调用一个 Controller 方法 | `() => bagController.sell()` | `() => { bagModel.set(…) }` |
| `LGUI-MVC-009` | View 不改 Model | — | View 里调用 `bagModel.set` 或规则方法 |
| `LGUI-MVC-010` | View 不访问服务和网络 | — | View 里调用 `lgui.service`、`lgui.platform.net` |
| `LGUI-MVC-011` | Controller 不碰控件 | 改 Model | Controller 里用 `lgui.ui.get(BagView).ui.gold` |
| `LGUI-MVC-012` | Model 不依赖界面、服务、平台 | 纯逻辑 | Model 里 import View 或调用 `lgui.ui` |
| `LGUI-MVC-013` | Service 不操作界面 | 广播事件 | Service 里调用 `lgui.ui.open`、`lgui.toast` |
| `LGUI-MVC-014` | 不写死用户能看到的文字：绑定表的 `text` 不写固定字符串（固定文字放在 `ui/` 里，动态文字用 `pick(…, lgui.t(键))`）；`lgui.toast` / `lgui.confirm` 的参数是文本键 | `lgui.toast('bag.sold')`、`text: pick(bagModel, s => lgui.t('bag.gold', { n: s.gold }))` | `lgui.toast('已售出')`、`text: '金币'`、`text: 'bag.title'` |
| `LGUI-MVC-015` | 代码里不写坐标和尺寸 | 在 `ui/` 里用关联 | `this.ui.list.width = 800` |
| `LGUI-MVC-016` | 全屏界面要么有 `@portrait` 竖版，要么写 `static bothOrientations = true` | 有 `BagPanel@portrait` | 全屏、没竖版、也没写 `bothOrientations` |
| `LGUI-MVC-017` | 文件位置和命名照第 2 节；一个文件只写一个 View | `src/modules/bag/BagView.ts` | 一个文件里写两个 View |
| `LGUI-MVC-018`（警告） | 不跨界面修改控件 | 改 Model | `lgui.ui.get(ShopView)` 之后改它的控件 |
| `LGUI-MVC-019` | `keys` 表：`back` 是 `'close'`、`'none'` 或函数；其他动作是 `{ do, hint? }`，`hint` 是文本键 | `confirm: { do: …, hint: 'bag.sell' }` | `confirm: 'sell'` |
| `LGUI-MVC-020`（警告） | View 里不直接改控件属性（坐标尺寸归 `LGUI-MVC-015`）：旋转、换语言重建组件后改的值就没了 | 绑定表 `title: { visible: pick(…) }` | 钩子里写 `this.ui.title.visible = false` |

TypeScript 自己的类型错误也一起报出来（带 TS 的错误码）。靠人看、机器查不出的：Model 的规则写得对不对、交互是否顺手。

## 14. 报错、日志和平台服务

### 14.1 报错分三类

| 类 | 什么情况 | 框架怎么做 | 例子 |
|---|---|---|---|
| ① 写错了 | 代码或界面写错了 | 抛 `LgRuntimeError`，并记一条 `error` 日志 | 缺文本键 `LGUI-RT-090`、加载器的图片所在的包没加载 `LGUI-RT-071`、ArtText 缺字符 `LGUI-RT-130`、字体的包没加载 `LGUI-RT-171`、没有 `Common/ActionHintBar` `LGUI-RT-172`、没配 `i18nBase` 就换语言 `LGUI-RT-173`、声音没登记 `LGUI-RT-170`、`lgui.sound` 参数不对 `LGUI-RT-174` |
| ② 外部失败 | 网络、加载这类外部的东西失败了 | 不抛错，把失败交回给代码；记一条 `warn` 日志 | 请求失败 `LGUI-RT-100` / `101`（`run` 返回 `{ ok: false }`）、网络图片加载失败 `LGUI-RT-070`（留着占位图）、声音加载失败 `LGUI-RT-026`、存着的声音设置读不出来 `LGUI-RT-175`、剪贴板读写不了 `LGUI-RT-241`（用 `lgui.request` 包着时） |
| ③ 正常的先后顺序 | 不是错，只是先后顺序 | 记一条 `info` 日志 | `await` 之后要关的界面已经关了 `LGUI-RT-082` |

**第 ① 类在开发和正式构建里不一样：**

- **开发和测试**（`lgui dev`、`lgui verify`、`lgui test`）：直接抛错。`lgui dev` 的页面上显示报错，`lgui test` 里这个测试失败。
- **正式构建：** 只记 `error` 日志（宿主的日志出口会把它上报），界面照常运行：缺文本键显示键名，ArtText 缺的字符跳过，没有提示栏就不显示提示栏，`lgui.sound` 参数不对这次调用不生效。

框架靠打包时 esbuild 的 `define` 知道是不是开发模式：`LGUI_DEV` 为 `true` 是开发模式（`lgui dev`、`lgui verify`、`lgui test` 都这样打包），正式构建定义成 `false`；没定义时按开发模式。

### 14.2 日志：`lgui.log`

```ts
lgui.log.info('bag_opened', { count: items.length });
lgui.log.warn('save_slow', { ms });
lgui.log.error('save_failed', error, { slot });
const log = lgui.log.child({ module: 'shop' }, 'shop');   // 可以写在模块顶层
log.debug('price_loaded', () => ({ prices }));             // 数据写成函数时，这一级真要记才算
```

- 四级：`debug`、`info`、`warn`、`error`；`enabled(级别)` 查这一级记不记。`error` 的第二个参数是错误，第三个是数据；其余几级第二个参数是数据（`warn` 第三个参数可以带错误）。
- **事件名是固定的 `snake_case`，不带变化的文字**；变化的内容放数据里。
- 框架自己记的日志，事件名由错误码得来（`LGUI-RT-090` → `lgui_rt_090`），数据里有 `code`、`message`、`fix` 和相关字段（比如 `key`、`url`）。
- 框架还没启动时写日志报 `LGUI-RT-050`；`lgui.log.child(…)` 本身可以写在模块顶层，到真正写的时候才找日志出口。
- 写到哪里由日志出口决定（14.3）：h5 默认写到浏览器控制台，headless 记进测试状态。

### 14.3 换掉平台服务：`lgui.app({ platform })`

游戏代码只用 `lgui.log.*`、`lgui.sound.*` 和 `lgui.platform.clipboard`；日志、声音、剪贴板真正写到哪里、从哪里来，由宿主在 `main.ts` 里决定。只换给出的几项，其余用后端自带的：

```ts
export default lgui.app({
  backend: 'h5',
  platform: {
    log: sdk.logger.child({}, 'ui'),   // 日志出口：形状和 Lumio 引擎的 Logger 一样，可以直接交进来
    // audio: myAudio,                 // 声音出口：play、music、setPaused（见 AudioService）
    // clipboard: myClipboard,         // 剪贴板：writeText、readText（见 ClipboardService）
  },
  async start() { await lgui.ui.open(MainView); },
});
```

| 服务 | 后端自带的 |
|---|---|
| `log`（`Logger`：`enabled`、`debug`、`info`、`warn`、`error`、`child`） | h5：浏览器控制台；headless：记进测试状态，`error` 级的让测试失败 |
| `audio`（`AudioService`：`play`、`music`、`setPaused`） | h5：浏览器的 Web Audio；headless：记下放过的音效和当前的背景音乐 |
| `clipboard`（`ClipboardService`：`writeText`、`readText`） | h5：浏览器的 `navigator.clipboard`（只有 https 或 localhost 的页面能用）；Unity：系统剪贴板（Unity 包里 `LGUI.Platform` 的 `ClipboardGet` / `ClipboardSet`）；headless：存在内存里，测试里 `lgui.platform.clipboard.readText()` 读得到 |

LGUI 不依赖 Lumio 引擎，只是日志接口照抄了引擎 `Logger` 的形状。`lgui test` 里 `platform` 不生效。

## 15. 界面声音

声音文件是 mp3，登记在 `ui/` 的包里（UI 开发规范第 5 节），地址写成 `ui://<包>/<声音名>`。分两个声道：背景音乐 `music`、音效 `sfx`（按钮音和 `lgui.sound.play`）。

### 15.1 背景音乐：`static music`

```ts
export class MainView extends View<MainViewUI> {
  static component = 'Main/MainView';
  static layer = 'page' as const;
  static fullScreen = true;
  static music = 'ui://Common/bgm';
}
```

- 界面栈里从上往下（`modal`、`popup`、`page`、`hud`，`toast` 层不算）第一个写了 `music` 的界面（已打开或正在打开；排队中的 modal 不算）决定放哪首；都没写就停。
- 同一首接着放，不从头来（比如 `replace` 成放同一首的界面）。换曲时新旧两首固定淡入淡出 500 毫秒。
- 切到后台时暂停，回来接着放。
- 网页里浏览器要求用户先点一下或按一下键才能出声：之前要放的背景音乐先记着，解锁后再放；之前的音效不放。
- 背景音乐整首解码进内存循环播放，用短的循环曲。

### 15.2 按钮音

- 按钮在 `ui/` 里写的音效（`<Button sound="…" volume="…"/>`，UI 开发规范第 6 节）优先；按钮组件自己写的是它所有实例的默认值；都没写就用工程配置 `sounds.click`。
- **不出声：** 把按钮的音量写成 0（`volume="0"`），实例上写就是这一个按钮，按钮组件上写就是这个组件的所有按钮。
- 只有绑定表里写了 `click`、点击真的执行了（界面激活、控件可用、没在 `lockWhilePending` 里）才出声。不是按钮的控件绑了 `click`，用 `sounds.click`。

### 15.3 代码播放和音量

| 写法 | 作用 |
|---|---|
| `lgui.sound.play('ui://Bag/coin', { volume: 0.8 })` | 放一次音效（只在 Controller 里用）；最终音量 = `volume` × 音效声道的音量 |
| `lgui.sound.setVolume('music', 0.5)` | 设一个声道的音量（0–1） |
| `lgui.sound.setMuted('sfx', true)` | 一个声道静音或取消静音 |
| `pick(lgui.sound.settings, s => s.music.volume)` | 界面读当前设置：`{ music: { volume, muted }, sfx: { volume, muted } }` |

- 音量和静音改了自动存进本地存储（键 `lgui.sound`），下次启动恢复；存的东西坏了记 `warn`（`LGUI-RT-175`），用默认值（都是 1、不静音）。
- 静音的声道：音效不放；背景音乐照常往下走，只是音量是 0，取消静音时接着放。
- 声道不是 `music` / `sfx`、音量不在 0–1、静音不是布尔值，报 `LGUI-RT-174`；`ui://` 声音没登记报 `LGUI-RT-170`；声音文件加载失败记 `warn`（`LGUI-RT-026`）。

## 16. 代码补间

代码里让控件动起来只有三个方法，写在 View 和 `PartView` 里（`ItemView`、Controller、Model 里没有，写了是 TypeScript 编译错误）：

```ts
this.tween(目标, 终值, 选项): Promise<void>      // 目标是 this.ui.<控件> 或它们的数组
this.stopTweens(目标?, { complete?: boolean })    // 不写目标是这个界面的全部
this.itemsOf(列表): UIComponent[]                 // 列表的子项，按序号排好；虚拟列表报 LGUI-RT-281
```

在生命周期钩子、`this.after` / `this.every` 的回调、`this.on` 的收听回调里调用。Model、Controller 那边出了事要动一下：用广播站通知 View（`this.on`），或者用 `ui/` 动效的 `play` 绑定。

**属性**（一次可以写好几项；控件不支持某一项报 `LGUI-RT-280`）：

| 属性 | 用在 | 值 |
|---|---|---|
| `dx`、`dy` | 任意控件 | 相对 `ui/` 里位置的偏移（设计尺寸的像素），0 就是原位 |
| `scale`、`scaleX`、`scaleY` | 任意控件 | 倍数。`scale` 等于同时写 `scaleX` 和 `scaleY`，不能和它们写在一起 |
| `rotation` | 任意控件 | 角度（度） |
| `alpha` | 任意控件 | 0–1；中间值夹在 0–1（`Back.Out` 这类会冲过头） |
| `width`、`height` | 任意控件 | 设计尺寸的像素，会重新排版 |
| `color` | 文字、富文本、输入框（字色）；按钮、标签（标题颜色）；图片、加载器、序列帧（着色，白色是原色）；图形（填充色） | `'#rrggbb'`，R、G、B 分别插值；透明度用 `alpha` |
| `fontSize` | 文字、富文本、输入框；按钮、标签（标题字号） | 像素，每帧取整，会重新排版 |
| `fillAmount` | 图片、加载器 | 0–1；`ui/` 里要先设了填充方式 |
| `progress` | 进度条 | 0–100，和绑定词 `progress` 同一个单位 |
| `chars` | 文字、富文本、输入框；按钮、标签（标题） | 显示到第几个字（打字机），每帧向下取整 |

- 只有 `dx`、`dy` 是相对值，其余都是绝对值，和 `ui/` 里的属性同一个意思。原位跟着关联走：补间结束以后控件又被关联挪过、拉过（屏幕尺寸变了），下一次补间的偏移和关闭时的还原都按关联算出来的位置、尺寸。`LGUI-MVC-015`（不写坐标和尺寸）管的是直接给控件赋值，不管 `tween` 的终值。
- **`chars`：** 文字本身照旧由绑定表的 `text` 决定，`chars` 只管露出前几个字。富文本里的 UBB 标签整段带上、不拆开，只数看得见的字（一张 `[img]…[/img]` 图片算一个，不在地址中间截断）。放完、终值不少于字数时恢复成「全部显示」；没有 `chars` 补间在走时文字换了，也恢复全部显示。

**选项：** `duration`（毫秒，必填；有重复时是一轮的时长）、`ease`（写法和 `ui/` 的 XML 一样，31 个，默认 `'Quad.Out'`）、`delay`（毫秒，只在开头等一次；目标是数组时可以写成 `i => i * 80`）、`from`（起点：调用时马上生效，在 `delay` 之前）、`repeat`（再重复几次，`-1` 一直循环）、`yoyo`（重复时来回走）。抖动、回弹不另开接口：

| 效果 | 写法 |
|---|---|
| 弹一下（回到原样） | `{ scale: 1.3 }`，`{ duration: 120, repeat: 1, yoyo: true }` |
| 弹出来（冲过头一点再停） | `{ scale: 1 }`，`{ from: { scale: 0 }, duration: 250, ease: 'Back.Out' }` |
| 来回抖几下（回到原位） | `{ dx: 10 }`，`{ duration: 40, repeat: 5, yoyo: true, ease: 'Sine.InOut' }` |
| 越抖越小 | `{ dx: 0 }`，`{ from: { dx: 12 }, duration: 500, ease: 'Elastic.Out' }` |

```ts
async onOpen() {
  // 道具逐个弹出（道具和按钮在 ui/ 里的轴心是 (0.5, 0.5)），全部放完再淡入按钮
  await this.tween(this.itemsOf(this.ui.rewards), { scale: 1 }, { from: { scale: 0 }, duration: 250, ease: 'Back.Out', delay: i => i * 80 });
  await this.tween(this.ui.okButton, { alpha: 1 }, { from: { alpha: 0 }, duration: 150 });
}
```

**Promise：** 放完时 resolve（`stopTweens(…, { complete: true })` 跳到终值也算放完）；目标是数组时全部放完才 resolve；一直循环的只有被 `complete` 停下才 resolve。别的停止（`stopTweens` 不带 `complete`、被同一属性的新补间接管完、界面关闭）都不 resolve：`await` 链只在上一步真的放完才往下走，被打断的链自然断掉。要「点一下跳过整段」的，用 `delay` 错开、一次全部创建，再 `stopTweens(undefined, { complete: true })`。补间放完不能当作业务完成（发奖、扣钱以 Controller 的结果为准）。

**跟着界面走：**

| 情况 | 补间 |
|---|---|
| 被全屏界面盖住 | 暂停（`delay` 也停），露出来接着走；被弹窗压住但没盖住照常走 |
| 旋转、换语言重建 | 正在走的按同一路径（`header.icon`、`rewards[2]`）换到新组件上接着走，进度不变；放完的不带过去，新组件是 `ui/` 里的样子（终值尽量就是 `ui/` 里的样子）；新组件上找不到报 `LGUI-RT-281` |
| 列表的 `items` 变了 | 这个列表子项上的补间跳到终值（子项会重新分配），算放完 |
| 界面关闭 | 全部停掉；碰过的属性还原成 `ui/` 里的值（界面可能被缓存，下次打开要是原样） |

**一个属性一个主人：** 两个补间改同一个控件的同一个属性，后来的接管，从当前值接着走（按属性算，`scale` 拆成 `scaleX`、`scaleY`）。补间碰上别的主人报 `LGUI-RT-282`：齿轮（`gearXY` 管 `dx`/`dy`，`gearSize` 管尺寸和缩放，`gearLook` 管透明度和旋转，`gearColor`、`gearFontSize`）、正在放的 `ui/` 动效里改这个属性的项（绑定表开始放动效时也反过来查）、按钮的 `downEffect="scale"`（缩放）和 `downEffect="dark"`（按钮里各控件的颜色）、绑定表的 `progress` 和长按的 `holdProgress`、写了 `roll` 的文字（`chars`）。两方都要动同一个属性就套一层：外层归一方、里层归另一方，效果相乘（缩放、透明度）或相加（位置、旋转）。补间进行中位置被关联挪了，按新的原位接着算偏移；尺寸被关联拉了，接着往终值写；别的属性被改了开发模式下报 `LGUI-RT-282`。

**轴心：** 补缩放或旋转时控件的轴心是 (0, 0) 报 `LGUI-RT-283`（会从左上角缩放、绕左上角转）。要从一边拉长（血条用 `scaleX`），在 `ui/` 里把轴心设成 (0, 0.5) 这类。

**按钮的按下与回弹：** 按钮组件写了 `downEffect="scale"`（`downEffectValue` 是按下时的缩放，不写是 0.8）的，框架接管 FairyGUI 原来「一下子缩小」的效果：按下 50 毫秒缩到 `downEffectValue`（`Quad.Out`），松开 100 毫秒弹回（`Back.Out`），参数写死。不用写代码、不用进绑定表（没绑 `click` 的按钮照样有），盖住暂停、关闭停掉和补间一样；连点时松开的接管按下的；按下和松开来自框架的手势识别，按住以后手指移出点击的范围（比如在可滚动列表里开始拖动）就弹回。只是视觉效果，不改按钮的位置、尺寸。加载器加载出来的组件里的按钮框架走不到，保持 FairyGUI 原来的一下子缩小（三端一样）。

**报错**（都是写错了：开发和测试里抛错，正式构建记 `error` 日志、这次调用不生效，不抛进 Controller——绑定开始放的动效和补间抢属性时这次不放，`roll` / `tick` 写错时照常显示、不滚、不定时重算，`itemsOf` 返回空数组）：`LGUI-RT-280` 参数不对，`LGUI-RT-281` 目标不对，`LGUI-RT-282` 属性还有别的主人，`LGUI-RT-283` 轴心是 (0, 0)，`LGUI-RT-284` `roll` / `tick` 写法不对。详见 [error-codes.md](error-codes.md)。

**代价**（从便宜到贵）：`scale`、`rotation`、`alpha` 不重新排版；文字、图形的 `color` 只重画这一块；浏览器端图片着色每次换一个颜色滤镜，最贵，只用在少数几个上；`dx`、`dy` 带动关联它的控件；`width`、`height`、`fontSize` 会重新排版整棵子树。成片错开优先用 `scale`、`alpha`；滚动的数字、倒计时、打字机用定宽加对齐，不要用 Shrink 和自动宽度。没有补间时零开销（不订阅帧回调）；`lgui.debug.snapshot()` 里有每个界面的补间数。
