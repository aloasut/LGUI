# UI 开发规范

拼界面、改界面时照这份规范做。界面只在 `ui/` 里定义；网页和 Unity 用的界面文件都由命令生成，不手改。文档里的 `lgui xxx` 指 `node <插件目录>/tools/lgui.mjs xxx`。

## 1. 改界面的固定步骤

1. 先 `lgui ui list` 看现有的包、组件和控件。
2. 新界面用 `lgui new view <包>/<组件> --pattern <模式>` 一次生成横竖两版骨架（第 7 节）；改已有界面就直接编辑 `ui/` 里的 XML。
3. 改完运行 `lgui check`，把报错全部改掉。
4. `lgui dev` 打开预览看效果。地址是 `http://127.0.0.1:<端口>/`：开发服务只监听、也只认 `127.0.0.1`，用 `localhost` 打不开（设计如此，挡住 DNS 重绑定）。改 `ui/`、`src/`、`i18n/` 会自动刷新；工程用到的别的目录（宿主代码、仓库根的 `Config/` 等）写进工程配置 `devWatch`（相对工程根目录，比如 `["../Config"]`），改了也会刷新。`devWatch` 写成工程根目录（`.`）或它的上级时不监视 `.lgui/build/`（生成物在这里，监视它会自己触发自己）。
5. `lgui verify` 按标准尺寸横竖截图（同一个画面只截一次，按尺寸模拟刘海），逐张看一遍。只截一个界面写 `--view <View 名>`；它要参数就再写 `--params '<JSON 对象>'`（字段见这个 View 的 `static params`，比如 `--view ShopView --params '{"tab":"gift"}'`）。

`lgui dev`、`lgui verify`、`lgui test` 各用各的生成目录（`.lgui/build/<命令>/`），`lgui dev` 开着时照样可以跑另外两个。

编辑器开着时不要直接改 XML：同一时间只有一方修改 `ui/`。

## 2. 工程结构

```
ui/
├── UI.fairy                    # 工程文件，不用改
├── assets/
│   ├── Common/                 # 公共包：通用弹窗、红点、占位图等（第 10 节）
│   │   ├── package.xml         #   包的资源清单
│   │   ├── Toast.xml           #   组件
│   │   └── placeholder.png     #   图片
│   └── Bag/                    # 一个功能一个包
│       ├── package.xml
│       ├── BagPanel.xml
│       ├── BagPanel@portrait.xml
│       └── icons/sword.png     #   可以分子目录，路径写在 package.xml 的 path 里
└── art-src/                    # AI 生成的原始大图，只作来源，界面不引用
```

- **一个功能一个包**（背包一个 `Bag`、商店一个 `Shop`）。好几个功能都用的东西（组件、图片）放进 `Common` 或单独的公共包，存一份，别的包直接引用。
- 跨包引用只能引用对方包里 `exported="true"` 的资源。
- **跨包引用的写法**：子组件和图片都写 `pkg`（对方的包 ID）和 `src`（资源 ID），比如 `<image … pkg="cmn00001" src="placehd1">`；打开界面时框架会一起加载对方的包。**唯一不能写的是子组件跨包时的 `fileName`**（`lgui check` 警告 `LGUI-UI-020`）：编辑器（OpenFairyGUI 0.2.4）读进来时会丢掉它，判定工程「不能无损保存」，整个工程都存不了。这是设计如此，删掉 `fileName` 就行，不用换别的写法绕。
- XML 以 **OpenFairyGUI 0.7.0** 能读写的格式为准。编辑器保存的格式也要能被 0.7.0 生成；有冲突时以 0.7.0 为准。

## 3. 命名

| 对象 | 写法 | 例子 |
|---|---|---|
| 包名 | 大写开头的驼峰 | `Bag`、`Common` |
| 组件名 | 大写开头的驼峰 | `BagPanel`、`ItemSlot` |
| 竖版组件 | 横版名加 `@portrait` | `BagPanel@portrait` |
| 控件名、控制器名、动效名 | 小写开头的驼峰，只用字母和数字 | `sellButton`、`tabs`、`enter` |
| 带字图片的各语言版本 | 图片名加 `@<语言>` | `title.png`、`title@en.png` |
| 图片名 | 小写开头的驼峰或带数字 | `sword`、`btnBg` |

- **控件名就是绑定表的键名。** 每个要在代码里用到的控件都要起名；只做装饰的控件也要起名（`deco1` 这类），因为名字要在组件内唯一。
- 同一个组件里，控件名不能重复，控件、控制器、动效也不能重名（动效名也是绑定表的键）。
- **要生成类型的组件标「导出」**：在 `package.xml` 里写 `exported="true"`。代码里用 `View`、`ItemView`、`PartView` 对应的组件都必须导出；只在别的组件里当子组件、代码不直接绑的，可以不导出。

## 4. ID 规则

手写 XML 最容易错的地方。

| ID | 规则 | 例子 |
|---|---|---|
| 包 ID | 8 位，小写字母和数字，整个工程里唯一。写在 `package.xml` 的 `<packageDescription id="…">` | `bag00001` |
| 资源 ID | 8 位，小写字母和数字，同一个包里唯一。组件、图片都是资源 | `bagpnl01` |
| 元素 ID | 组件内唯一。写 `n` 加数字，按出现顺序递增 | `n0`、`n1` |

- **已有的 ID 一律不改**，改了会让别处的引用失效。新加资源时取一个没用过的 ID。
- 引用资源的地址：`ui://<包ID><资源ID>`，比如 `ui://bag00001bagpnl01`。同包内的 `src` 只写资源 ID。
- `lgui new view`、`lgui art split`、`lgui art cut` 生成的 ID 已经满足规则。

## 5. 资源登记（`package.xml`）

```xml
<?xml version="1.0" encoding="utf-8"?>
<packageDescription id="bag00001">
  <resources>
    <component id="bagpnl01" name="BagPanel.xml" path="/" exported="true"/>
    <component id="bagpnl02" name="BagPanel@portrait.xml" path="/" exported="true"/>
    <image id="sword001" name="sword.png" path="/icons/" exported="true"/>
    <image id="frame001" name="frame.png" path="/" scale="9grid" scale9grid="12,12,40,40"/>
    <sound id="coin0001" name="coin.mp3" path="/sfx/" exported="true"/>
  </resources>
</packageDescription>
```

- 每个组件 XML 和图片都要登记；登记的文件必须存在，存在的文件也都要登记。
- **九宫格：** 在图片上写 `scale="9grid"` 和 `scale9grid="左,上,宽,高"`（中间可拉伸区域），区域不能超出图片。边距按图片真实的边框像素取，不要统一取边长的四分之一。
- **图集：** 生成时按包自动打图集，一般不用管。每张图不能比所在包的图集上限大。全局上限是 `ui/settings/Publish.json` 里的 `atlasSetting.maxSize`（编辑器「发布设置」里改的就是它），没写是 4096×4096；超了生成时报 `LGUI-CLI-113`，写明是哪张图、上限是从哪来的。某个包确实要更大的图，在它的 `package.xml` 已有的 `<publish name="包名">` 上加 `maxAtlasSize="8192"`（`lgui init`、`lgui new` 建的包都已经有一个空的 `<publish>`，再加第二个不生效；没有才在 `</resources>` 后面写 `<publish name="包名" maxAtlasSize="8192"/>`）。多数手机支持到 4096，更大先确认目标设备。
- **声音：** mp3，登记成 `<sound>` 并导出（`exported="true"`）。代码和 View 的 `static music` 里写 `ui://<包名>/<声音名>`（`ui://Bag/coin`）；按钮的 `sound` 属性和别的资源引用一样写 `ui://<包ID><资源ID>`（`ui://bag00001coin0001`）。用法见 MVC 开发规范第 15 节。
- `lgui art split`、`lgui art cut` 拆出来的小图会自动登记。

**AI 出的图集拆成小图：**

- 格子画得整齐、每格一样大：`lgui art split <大图> --grid 6x4 --size 128x128 --pkg <包> --names <名字>`，按格子平均切。
- 物件会漂过格线、大小不一、或者是自由排布的零件页：`lgui art cut <整页图> --pkg <包> --names <名字文件>`。它按透明区域找出每个物件（不按格子切），从上到下、每行从左到右对上名字。整页图要照第 5.1 节画。
  - 名字文件一行一项：`名字=宽x高`，后面可以跟：
    - `9grid=左,上,右,下`：拉伸图的边距，按导出尺寸量，0 表示这个方向不拉伸；
    - `tile`：横向平铺，`package.xml` 里写 `scale="tile"`；
    - `fit`：只用在九宫格或平铺图上，单独缩放这一项，让不拉伸的方向正好等于尺寸（比如 547×186 的大按钮出来正好 186 高）；它不用、也不影响整页的缩放比例；
    - `pkg=包名`：存进别的包，没写的存进 `--pkg`。图片可以跨包引用（第 2 节），好几个包都用的图存进 `Common` 一份就行，不用每个包存一份。
    
    空着的格子写 `EMPTY`。都是同一尺寸时可以直接写 `--names a,b,c --size 120x120`。
    ```
    btnYellowLarge=547x186 9grid=64,0,64,0 fit
    btnYellow=240x72 9grid=36,0,36,0 pkg=Common
    currencyBar=206x53 9grid=26,0,26,0
    tabBarBg=360x180 tile
    EMPTY
    iconClose=64x64 pkg=Common
    ```
  - 找到的物件数和名字数（不算 `EMPTY`）对不上就报错，列出找到的每个物件的位置和大小：贴着物件的小碎片（闪光之类）用 `--gap` 并进去（默认 24 像素以内），零碎杂点用 `--speck` 丢掉（默认面积小于 64 像素）。
  - 裁掉空白后，**整页用同一个缩放比例**（默认取最需要缩小的那个物件，让每个都放得进自己的尺寸），描边粗细才一致；物件居中，四边留 `--pad` 像素（默认 0）。几页要用同一个比例时写 `--scale`。写了 `fit` 的项不参与。九宫格拉伸的方向、平铺图的横向不受尺寸限制，按内容实际大小出。
  - 按这个比例缩放后，有物件在不拉伸的方向上都不到自己尺寸的一半，报 `LGUI-CLI-111`（同一页里画的比例差太多，不报的话图标会悄悄变得很小）：让 AI 按同一个比例重画，或者把尺寸差得多的物件分到另一页单独拆。
  - 自动去白边：挨着透明处的半透明边缘改用描边的颜色（`--defringe` 圈数，默认 2，0 是不处理）。
  - 九宫格的图整张按比例缩放，保留原图的拉伸区（渐变、装饰都在），`package.xml` 里写好 `scale="9grid"` 和 `scale9grid`（中间那一块）；平铺图检查最右一列能不能无缝接上最左一列，接不上报错。
  - **包里已经登记了同名图片就直接替换**：写到原来登记的位置，资源 ID、路径、导出都不变，引用它的组件一行不用改（先用占位图拼好界面，出图后同名替换）。原来登记成平铺的照样平铺；原来是九宫格的，名字文件里要写 `9grid`（没写报 `LGUI-CLI-112`）。包目录里有同名文件、却没登记，报 `LGUI-CLI-082`。
  - 每页出一张检查图 `.lgui/build/art/<--pkg>/<页名>-sheet.png`：中性灰底，按导出尺寸排开（九宫格拉到导出尺寸，平铺图并排两份看接缝），写着名字。拆完看一遍：描边粗细、颜色、大小是否一致，名字有没有对错。
  - 原图复制到 `ui/art-src/<--pkg>/`（那里已经有同名的原图就报 `LGUI-CLI-082`，给整页图换个文件名）。有一项不对（包括 `pkg=` 写的包不存在）就报错，什么都不写。

### 5.1 art cut 对输入图的要求

给 AI 出图的提示词照这一节写（这里是唯一的权威）。`lgui art cut` 按透明区域找物件、整页用一个比例缩放，整页图要这样画：

1. **透明底的 PNG。** 不要白底、黑底、底色，也不要画出来的棋盘格。
2. **物件之间留出间隔**，至少 32 像素，互相不挨着、不叠在一起；一页只画名字文件里列的那些物件，不画格子线、底座和多余的备选。挨得太近的小物件会被当成旁边物件的碎片并进去，数目对不上报 `LGUI-CLI-081`。
3. **阴影、光晕不画成半透明。** 要阴影就画成实心（不透明）的深色，或者不画、由界面加；半透明的部分认不准物件的边界。
4. **按导出尺寸的 2 倍画**（120×120 的图标画成约 240×240）。缩小出来边缘干净；画小了要放大，会发糊。
5. **面板、按钮这类九宫格零件画得比九宫格边距大得多**：边距按导出尺寸量，按 2 倍画时画出来的宽要明显大于 2 ×（左 + 右），高要明显大于 2 ×（上 + 下），中间留出能拉伸的部分；圆角要整个落在边距里，拉伸的地方不放装饰（会被拉长）。比边距还小报 `LGUI-CLI-085`。
6. **同一页里物件的尺寸别差太多**（比如 150 的头像框和 24 的小图标别放一页）：整页一个比例，差得多的分开画、分开拆（`LGUI-CLI-111`）。
7. 平铺图（`tile`）左右两端要能无缝接上（`LGUI-CLI-086`）。
8. 图里不画文字（第 8 节）。

## 6. 最小写法模板

组件文件的根节点：

```xml
<?xml version="1.0" encoding="utf-8"?>
<component size="1920,1080">
  <controller name="tabs" pages="0,equip,1,item" selected="0"/>
  <displayList>
    <!-- 控件按从下到上的顺序排列 -->
  </displayList>
</component>
```

控件（每种都可以照抄，改 `id`、`name`、位置、尺寸和内容）：

```xml
<!-- 图片：src 是资源 ID；别的包的图片再写 pkg（对方的包 ID），对方要导出（第 2 节） -->
<image id="n0" name="bg" src="frame001" xy="0,0" size="400,300"/>
<image id="n15" name="logo" pkg="cmn00001" src="placehd1" xy="20,20" size="64,64"/>

<!-- 文字：必须写 autoSize，单行的框再写 singleLine，见第 8 节；粗体、描边、投影见下面 -->
<text id="n1" name="title" xy="20,20" size="360,40" fontSize="28" color="#ffffff" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="背包"/>

<!-- 富文本 -->
<richtext id="n2" name="desc" xy="20,70" size="360,120" fontSize="22" color="#dddddd" autoSize="height" text="[color=#ffcc00]稀有[/color] 道具"/>

<!-- 输入框 -->
<inputtext id="n3" name="search" xy="20,200" size="360,40" fontSize="22" color="#ffffff" autoSize="none" singleLine="true" prompt="搜索"/>

<!-- 按钮：引用一个 extention="Button" 的组件（按钮组件本身可以写 <Button mode="Check"/> 或 "Radio"，让它保持选中，见第 12 节） -->
<component id="n4" name="sellButton" src="btn00001" xy="20,250" size="160,56">
  <Button title="出售" sound="ui://bag00001coin0001" volume="80"/>   <!-- 点击音效和音量（百分比），都可以不写 -->
</component>

<!-- 子组件 -->
<component id="n5" name="header" src="header01" xy="0,0" size="1920,120"/>

<!-- 加载器：显示动态图片，url 可以先留空 -->
<loader id="n6" name="icon" xy="0,0" size="128,128" align="center" vAlign="middle" fill="scale"/>

<!-- 列表：defaultItem 必须指向一个导出的组件 -->
<list id="n7" name="list" xy="40,160" size="840,600" layout="flow_hz" lineGap="12" colGap="12" defaultItem="ui://bag00001slot0001" overflow="scroll" scrollBar="hidden"/>

<!-- 树：列表加 treeView="true"；clickToExpand="1" 单击节点展开或收起（"2" 双击，不写或 "0" 点了不展开），见第 12 节 -->
<list id="n10" name="tree" xy="40,160" size="400,600" layout="column" treeView="true" indent="20" clickToExpand="1" defaultItem="ui://bag00001node0001" overflow="scroll"/>

<!-- 序列帧动画：src 是同包登记的 movieclip 资源（.jta）；playing 是初始是否播放 -->
<movieclip id="n11" name="spin" src="spin0001" xy="0,0" size="64,64" playing="true"/>

<!-- 标签、滑动条、下拉框：引用一个扩展类型是 Label / Slider / ComboBox 的组件（组件模板见下面）；实例上写初始值 -->
<component id="n12" name="badge" src="label001" xy="20,320" size="300,60">
  <Label title="徽章"/>
</component>
<component id="n13" name="volume" src="slider01" xy="20,400" size="400,40">
  <Slider value="50" max="100"/>
</component>
<component id="n14" name="mode" src="combo001" xy="20,460" size="300,60"/>

<!-- 图形 -->
<graph id="n8" name="mask" xy="0,0" size="1920,1080" type="rect" lineSize="0" fillColor="#80000000"/>

<!-- 组：普通组只在编辑时有，生成界面包时会被去掉；要用动效动整组写 advanced="true"（高级组） -->
<group id="n9" name="footer" xy="0,980" size="1920,100"/>
```

**文字的粗体、描边、投影**（`text`、`richtext`、`inputtext` 都能写）：

| 属性 | 写法 | 说明 |
|---|---|---|
| `bold` | `bold="true"` | 粗体 |
| `strokeColor` | `strokeColor="#3a1f00"` | 描边颜色；写了它才有描边 |
| `strokeSize` | `strokeSize="2"` | 描边粗细（设计像素），不写是 1 |
| `shadowColor` | `shadowColor="#80000000"` | 投影颜色（`#AARRGGBB` 可以带透明度）；写了它才有投影 |
| `shadowOffset` | `shadowOffset="2,2"` | 投影偏移 `x,y`，不写是 `1,1` |

```xml
<text id="n1" name="gold" xy="20,20" size="200,48" fontSize="32" color="#ffd84a" bold="true" strokeColor="#3a1f00" strokeSize="2" shadowColor="#80000000" shadowOffset="0,2" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="1436"/>
```

**按钮组件**（`extention="Button"`，标题和图标控件名固定为 `title`、`icon`：实例上的 `<Button title>`、绑定表的 `text` 只写进名为 `title` 的子控件，按钮组件里有文字却没有 `title` 时网页上显示不出来，`lgui check` 报 `LGUI-UI-066`；标签、下拉框也一样）：

```xml
<component size="160,56" extention="Button">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <image id="n0" name="bg" src="btnbg001" xy="0,0" size="160,56">
      <relation target="" sidePair="width-width,height-height"/>
    </image>
    <text id="n1" name="title" xy="0,0" size="160,56" fontSize="24" color="#ffffff" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="按钮">
      <relation target="" sidePair="width-width,height-height"/>
    </text>
  </displayList>
  <Button/>
</component>
```

**按下效果**写在按钮组件根节点的 `<Button>` 上：`<Button downEffect="scale" downEffectValue="0.95"/>` 按下缩到 95%，由框架带缓动地补：按下 50 毫秒缩小（`Quad.Out`），松开 100 毫秒弹回（`Back.Out`），参数固定；只是视觉效果，按按钮中间缩放，不改位置和尺寸。按钮本身的缩放归它管，别的动效、代码补间要缩放就放在里面的子组件上（运行时报 `LGUI-RT-282`）；加载器加载出来的组件里的按钮保持 FairyGUI 原来的一下子缩小，`<Button downEffect="dark" downEffectValue="0.8"/>` 按下变暗到 80%；不写是没有效果。`downEffectValue` 不写是 0.8。

**标签组件**（`extention="Label"`，标题和图标控件名固定为 `title`、`icon`，实例上的 `<Label title>`、绑定表的 `text` 只写进 `title`；不能点选，要点的用按钮）：

```xml
<component size="300,60" extention="Label">
  <displayList>
    <loader id="n0" name="icon" xy="0,0" size="60,60" align="center" vAlign="middle" fill="scale"/>
    <text id="n1" name="title" xy="70,0" size="230,60" fontSize="24" color="#ffffff" vAlign="middle" autoSize="shrink" singleLine="true" text=""/>
  </displayList>
  <Label/>
</component>
```

**滑动条组件**（`extention="Slider"`，控件名固定：`bar` 是随值变长的条，`grip` 是滑块，`grip` 用关联贴在 `bar` 的右边；`wholeNumbers="true"` 时用户拖出来的值取整）：

```xml
<component size="400,40" extention="Slider">
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="400,40" type="rect" lineSize="0" fillColor="#22344d">
      <relation target="" sidePair="width-width,height-height"/>
    </graph>
    <graph id="n1" name="bar" xy="0,0" size="400,40" type="rect" lineSize="0" fillColor="#6aa7ff"/>
    <graph id="n2" name="grip" xy="390,0" size="20,40" type="rect" lineSize="0" fillColor="#ffffff">
      <relation target="n1" sidePair="left-right"/>
    </graph>
  </displayList>
  <Slider wholeNumbers="true" changeOnClick="true"/>
</component>
```

**下拉框组件**（`extention="ComboBox"`，选中项的文字（实例上的 `<item title>`、绑定表的 `items`）显示在 `title` 里，没有 `title` 报 `LGUI-UI-066`；`dropdown` 指向弹出的组件，它里面要有一个名为 `list` 的列表，子项是按钮。弹出组件和子项要导出；放在别的包里也行，打开界面时会一起加载那个包）：

```xml
<!-- ComboBox.xml -->
<component size="300,60" extention="ComboBox">
  <controller name="button" pages="0,up,1,down,2,over,3,selectedOver" selected="0"/>
  <displayList>
    <graph id="n0" name="bg" xy="0,0" size="300,60" type="rect" lineSize="2" lineColor="#6aa7ff" fillColor="#22344d">
      <relation target="" sidePair="width-width,height-height"/>
    </graph>
    <text id="n1" name="title" xy="0,0" size="300,60" fontSize="24" color="#ffffff" align="center" vAlign="middle" autoSize="shrink" singleLine="true" text="">
      <relation target="" sidePair="width-width,height-height"/>
    </text>
  </displayList>
  <ComboBox dropdown="ui://bag00001cbpopup1"/>
</component>

<!-- ComboBoxPopup.xml（cbpopup1）：子项 cbitem01 是一个带 title 的按钮组件 -->
<component size="300,180">
  <displayList>
    <list id="n0" name="list" xy="0,0" size="300,180" layout="column" defaultItem="ui://bag00001cbitem01" overflow="scroll">
      <relation target="" sidePair="width-width,height-height"/>
    </list>
  </displayList>
</component>
```

**按钮音效：** 按钮实例上的 `sound`、`volume` 优先，其次是按钮组件自己 `<Button sound="…" volume="…"/>` 写的；都没写就用工程配置 `sounds.click`。**`volume="0"` 表示这个按钮不出声**（写在按钮组件上就是这个组件的所有按钮）。编辑器里在按钮的「音效」「音量」里设。

**控制器、齿轮：** `pages` 是「页ID,页名」成对排列；齿轮的 `pages` 写页 ID，不是页名。

```xml
<controller name="state" pages="0,locked,1,ready,2,claimed" selected="0"/>
<image id="n4" name="doneMark" src="done0001" xy="0,0" size="40,40">
  <gearDisplay controller="state" pages="2"/>
</image>
```

- **用户能看到的文字不写在 `gearText` 里**：这些字不会被提取翻译，`lgui test` 里也看不到，`lgui check` 报 `LGUI-UI-060`。随状态变的文字在绑定表里写：`` stateText: { text: pick(taskModel, s => lgui.t(`task.${s.state}`)) } ``，文字放进 `i18n/<语言>.json`。
- **按钮不直接绑控制器**（`<Button controller="tabs" page="1"/>`，点了就切页）：这样切页不经过 Model，`lgui test` 里也不会切，`lgui check` 报 `LGUI-UI-061`。点击写在绑定表里调用 Controller（`click: () => shopController.switchTab('second')`），控制器的页由 `page: pick(…)` 决定。
- 显示齿轮（`gearDisplay`，再加条件的 `gearDisplay2`：`condition="0"` 是「并且」、`"1"` 是「或者」）和组（`<group>`，控件上写 `group="组的元素 ID"`）在网页和 `lgui test` 里一样生效：被藏起来的控件 `t.visible` 是 `false`，点它报 `LGUI-RT-032`。别的齿轮（`gearXY`、`gearText` 等）`lgui test` 不模拟。
- **序列帧动画：** 网页端（FairyGUI-dom）目前不画序列帧的画面，只有 `playing`、当前帧这些状态（绑定表的 `playing` 照常生效）。

**关联**（同一方向内适配不同宽高比，第 7.3 节）：

```xml
<image id="n0" name="bg" src="bg000001" xy="0,0" size="1920,1080">
  <relation target="" sidePair="width-width,height-height"/>   <!-- 跟着父组件拉伸 -->
</image>
<component id="n1" name="closeButton" src="btnclose" xy="1820,20" size="80,80">
  <relation target="" sidePair="right-right,top-top"/>          <!-- 贴右上角 -->
</component>
```

**动效：**

```xml
<transition name="enter" autoPlay="true">
  <item time="0" type="Alpha" target="n0" duration="12" tween="true" startValue="0" endValue="1"/>
</transition>
<transition name="glow" autoPlayRepeat="-1">
  <item time="0" type="Alpha" target="n1" duration="12" tween="true" startValue="1" endValue="0.6" repeat="1" yoyo="true"/>
</transition>
```

- `time`、`duration` 的单位是帧，帧率是 `frameRate`（不写是每秒 24 帧）；`repeat` 是这一项再重复几次（`-1` 一直重复）。
- **动效要动整组，组写成高级组**（`<group … advanced="true"/>`）：普通组只在编辑时有，生成界面包时会被去掉，动效找不到它、动不了，`lgui check` 报 `LGUI-UI-069`。
- **旋转（`Rotation`）、缩放（`Scale`）先给目标控件设轴心**：控件上写 `pivot="0.5,0.5"`（绕中心）；不写轴心是左上角，会绕左上角转、朝右下缩放。确实要绕左上角就写 `pivot="0,0"`。没设报 `LGUI-UI-067`（同一个动效里用 `Pivot` 项设了、按下缩放的按钮自动在中间的不报）。
- `autoPlay="true"`：界面创建时自动播放（旋转、换语言重建组件时会再播一次）；`autoPlayDelay` 是自动播放前等几秒。
- `autoPlayRepeat`：播放次数，`-1` 一直循环；绑定表里的 `playing` 也按它放。
- 代码里按条件播放、重播、放完通知，用动效名当绑定表的键（MVC 开发规范第 6.4 节）。
- `lgui test` 的 headless 后端按这里写的时长走假时钟，放完才算完，和网页一样。

动效的设计方法见技能 `lgui-ui`。

## 7. 横竖屏

### 7.1 设计尺寸

- 横屏 1920×1080，竖屏 1080×1920。两者短边相同，按钮、图标、字号在两种方向下一样大，美术资源直接共用。
- 全屏界面的根组件尺寸写设计尺寸：横版 `size="1920,1080"`，竖版 `size="1080,1920"`。
- 框架保证整个设计区域完整显示：缩放比 = min(屏幕宽 / 设计宽, 屏幕高 / 设计高)，所以一个方向刚好铺满，另一个方向多出空间。全屏界面的根组件被拉到整个可见区域（设计单位下比设计尺寸大），多出来的空间交给关联；不是全屏的界面（弹窗等）放在安全区正中（第 7.3 节）。

### 7.2 横竖两版组件

- 需要两种排法的界面做两个组件：横版 `BagPanel` 和竖版 `BagPanel@portrait`，都要导出。
- **两版的控件名和类型必须完全一致**（包括控制器和页名），代码只写一份。不一致时 `lgui check` 报 `LGUI-UI-007`。
- **两版的固定文字也要一样**：两版共用一个文本键（`<包>/<组件>/<控件>`），`lgui i18n extract` 和翻译都取横版的文字。两版写了不同的字，`lgui check` 警告 `LGUI-UI-063`：默认语言下两版各显示各的，换了语言竖版也显示横版的翻译。两版要说不一样的话，就用代码里的 `lgui.t`。
- 按钮、道具格子这类子组件两版共用。
- 弹窗这类没有竖版的组件，两种方向通用，只靠关联适配。
- **全屏界面必须有竖版**；确实两种方向都用同一版的，在 View 里写 `static bothOrientations = true`（见 MVC 开发规范）。
- 不要用控制器在一个组件里分横竖两页：齿轮切换不了关联。

### 7.3 同一方向内的适配

- **关联：** 写在控件里 `<relation target="" sidePair="…"/>`（`target=""` 表示父组件），多条用逗号连起来。常用的：

| 写法 | 效果 |
|---|---|
| `width-width`、`height-height` | 跟着父组件拉伸宽 / 高（全屏背景两个都写） |
| `left-left`、`right-right` | 贴左边 / 贴右边，离边的距离不变 |
| `top-top`、`bottom-bottom` | 贴上边 / 贴下边 |
| `center-center`、`middle-middle` | 水平居中 / 垂直居中 |

  一个方向只写一条（比如右上角的关闭按钮写 `right-right,top-top`）。其他取值照 FairyGUI 的关联规则。
- **安全区：** 手机的刘海、圆角、底部横条会挡住屏幕边上的一部分，剩下不被挡住的叫安全区。
  - 全屏界面的根组件照样铺满整个可见区域，背景画到屏幕边上。
  - 全屏界面的组件（横竖两版）在 `bg` 后面放一个名为 `safe` 的空图形，铺满组件。打开、旋转、屏幕尺寸变化时，框架把它摆到安全区（设计单位，平台给的屏幕像素按缩放比换算）。
  - 背景关联到组件本身（`target=""`）；贴边的控件和要点的内容关联到 `safe`（`target` 写它的元素 ID）。
  - 不是全屏的界面放在安全区正中。
  - 全屏界面没有 `safe` 时 `lgui check` 报 `LGUI-UI-064`。`lgui init` 和 `lgui new view` 生成的全屏界面已经这样写好了：

```xml
<graph id="n0" name="bg" xy="0,0" size="1920,1080" type="rect" lineSize="0" fillColor="#0e1621">
  <relation target="" sidePair="width-width,height-height"/>
</graph>
<graph id="n4" name="safe" xy="0,0" size="1920,1080" touchable="false">
  <relation target="" sidePair="width-width,height-height"/>
</graph>
<component id="n2" name="closeButton" pkg="cmn00001" src="button01" xy="1620,32" size="240,72">
  <relation target="n4" sidePair="right-right,top-top"/>
  <Button title="关闭"/>
</component>
<list id="n3" name="list" xy="60,140" size="1800,820" layout="flow_hz" defaultItem="ui://bag00001slot0001" overflow="scroll">
  <relation target="n4" sidePair="left-left,top-top,width-width,height-height"/>
</list>
```

  - 关联到 `safe` 时，`left-left` 这类写法表示跟着 `safe` 的边移动，`width-width` 表示跟着 `safe` 变宽变窄；铺满安全区的内容四条都写。
  - 测试里用 `t.setSafeArea({ top, right, bottom, left })`（屏幕像素）模拟刘海。
- **底部留空：** 操作提示栏（第 10 节）占屏幕底部 64 设计像素，全屏界面底部的按钮和内容要留出这段高度。
- **列表：** 用列表的自动排布（`layout="flow_hz"`），按宽度决定每行几个，不在代码里算列数。
- **代码里不写坐标和尺寸**，布局只在 `ui/` 里定义。

### 7.4 排布模式

`lgui new view --pattern <模式>` 按下面的模式生成横竖两版骨架。每种模式的完整范例在插件的 `templates/patterns/<模式>/` 里。

| 模式 | 横版 | 竖版 | 适合 |
|---|---|---|---|
| `split` | 左右分栏：左边列表，右边详情 | 上下堆叠：上面列表，下面详情 | 背包、图鉴 |
| `tabs` | 顶部标签栏 | 底部标签栏 | 商店、设置 |
| `grid` | 多列网格列表 | 少列网格列表（列数由宽度自动决定） | 关卡选择、商品列表 |
| `dialog` | 居中弹窗 | 底部弹出 | 道具详情、二次确认 |

## 8. 文字

- **字体**：项目自带的字体文件放 `ui/fonts/<名字>.ttf` 或 `.otf`，文件名（去掉扩展名）就是字体名，以大写字母开头、只用字母和数字（比如 `NotoSansSC.otf`、`TitleBold.ttf`），不能和 CSS 的通用字体名或关键字同名（`Serif`、`Monospace`、`Cursive`、`Fantasy`、`Math`、`Emoji`、`Fangsong`、`Inherit`、`Initial`、`Unset`、`Default`、`Revert`，不分大小写；网页上会按系统字体画）。默认字体在工程配置 `defaultFont` 里写这个名字；某一处要用别的字体，XML 写 `font="<名字>"`，富文本写 `[font=<名字>]…[/font]`。`font` 只能写 `ui/fonts/` 里有的名字，系统字体名（各平台不一样）、包里的 `ui://` 字体资源都报 `LGUI-UI-080`。`defaultFont` 是 `null` 时用系统默认字体。
  - **自动精简**：`lgui dev`、`verify`、`test --browser`、`unity export` 按项目实际用到的字做子集（网页 WOFF2，Unity 原格式）：ASCII 可见字符、`ui/` 里写的文字、`i18n/` 全部语言的文案、框架自己显示的字（`format.compact` 的「万」「亿」等）。几 MB 的中文字体一般只剩几十 KB。
  - **缺字报错**（`lgui check` 和上面这些命令都报 `LGUI-CLI-141`，写明是哪个字、在哪里）：`ui/` 里的每段固定文字按显示它的那个文字控件的字体查。文字控件看自己的 `font`；按钮、标签、下拉框、列表项的标题（`title`、`selectedTitle`、下拉框的选项、`<item title>`）看那个组件里名为 `title` 的文字控件的 `font`；`gearText` 的值跟着它所在的控件；没写 `font` 的是默认字体。`i18n/` 里和 `ui/` 文字同一个键的翻译跟着那个控件的字体，其余文案和框架自己显示的字查默认字体。表情符号这类字体里没有的字改用图片或 ArtText。
  - **多语言工程的默认字体要覆盖所有语言**：所有字体用同一个字集，`i18n/` 里全部语言的文案都按上面的规则查（代码里 `lgui.t` 用的文案查默认字体）。比如中文加韩文的工程，默认字体要同时有中文和韩文，否则报 `LGUI-CLI-141`。
  - **运行时才知道的文字**（玩家名、服务器下发的数据、输入框里打的字）不在子集里的字，按字换成系统字体显示，不报错。网页上由浏览器换；Unity 上每个项目字体后面挂一个系统字体做的 TMP 回退字体（iOS、macOS 用苹方，Android 用系统自带的 Noto Sans CJK 等，Windows 用微软雅黑）。这只对 iOS、Android、电脑的原生包有效：Unity 出微信小游戏或 WebGL 时读不到系统字体，子集外的字会显示成方框，到时要在 `ui/fonts/` 里带一个常用字字体。设备上一个候选的系统字体都没找到时，Unity 只记一次 `LGUI-RT-182` 错误日志，游戏照常运行，缺的字显示方框。
  - **Unity 上用 TextMesh Pro**：TMP 建字体要用 Unity 工程里的 TMP 必需资源（TMP Essential Resources，里面有 TMP Settings）。`lgui unity export` 发现工程里没有 TMP Settings 时，会从 Unity 自带的 `com.unity.ugui` 资源包里导入它们（不联网，只写工程里还没有的文件；已有 TMP Settings 的工程不动），不用手动点菜单。项目字体在 Unity 上是动态 TMP 字体，字第一次出现时才画进图集（不在编辑器里提前烘），图集满了自动开新的一张。字第一次出现时要现画，一次出很多新字的界面要在真机上看耗时，卡了再改成提前烘。
  - **表情符号不支持**（网页、Unity 都是）：字体里没有的表情由系统按字回退，各平台显示不一样，Unity 上可能是方框。以后要支持，在 Unity 上用 TMP 的 Sprite Asset 做。
  - 粗体照旧写 `bold="true"`（由浏览器、Unity 加粗）；要真正的粗体字重，再放一个粗体文件当另一个字体用。可变字体、字体集（TTC）、WOFF 不收（`LGUI-CLI-140`），用单字重的 TTF / OTF。
  - **字体许可由项目自己负责**。生成子集算修改了字体（OFL FAQ 2.6）。LGUI 不改字体内部的名字（字体文件里的 name 表照原样留着），只是网页上按文件名引用。OFL 字体如果声明了保留字体名（Reserved Font Name，写在许可里版权声明的后面），修改版不能用这个名字，包括字体内部用来选字体的名字（OFL FAQ 5.3），只改文件名可能不够。这种字体要项目自己处理（比如取得作者许可，或者先自己改好字体内部的名字再放进 `ui/fonts/`），或者换一个没有保留字体名的字体。具体要求请对照字体自带的许可。
- **最小字号 20**（按设计尺寸）。小于 20 时 `lgui check` 报 `LGUI-UI-011`；没写 `fontSize` 的按 FairyGUI 默认的 12 号算，也报。
- **每个文字控件都要声明文字超长时怎么处理**，就是 `autoSize` 的取值：

| 写法 | 效果 |
|---|---|
| `autoSize="shrink"` + `singleLine="true"` | 缩小字号塞进框里（按钮标题、短标签） |
| `autoSize="height"` | 换行，框的高度跟着变（说明文字） |
| `autoSize="ellipsis"` + `singleLine="true"` | 截断，末尾加省略号（道具名、玩家名） |
| `autoSize="both"` | 框跟着文字变大（只用于确定不会超长的数字） |

  写 `autoSize="none"` 或不写时 `lgui check` 报 `LGUI-UI-010`（输入框除外）。
- **只放得下一行的框写 `singleLine="true"`**：`shrink`、`ellipsis` 不写它时，字长了会先折成两行，再缩成小字或者被截掉。框高小于「2 × 字号 + 行距（`leading`，不写是 3）」就算只放得下一行，这时没写 `singleLine` 报 `LGUI-UI-068`；要显示多行就把框加高，或者用 `autoSize="height"`。
- **用户能看到的固定文字写在 `ui/` 里**，会被 `lgui i18n extract` 提取翻译。代码里动态生成的文字用 `lgui.t`。
- 图里不放文字；实在要用带字图片，按第 9 节提供各语言版本。
- 美术风格的数字（伤害、金币）用 `ArtText`（第 11 节）。

## 9. 多语言

- 第一版不支持从右往左排版的语言。
- **固定文字**写在 `ui/` 里，`lgui i18n extract` 把它们提取到默认语言的 `i18n/<语言>.json`，键名是 `<包>/<组件>/<控件路径>`，比如 `Bag/BagPanel/sellButton`、`Bag/BagPanel/header.count`。按钮和标签的标题、输入框的提示文字（键名后加 `@prompt`）、下拉框写在 `ui/` 里的固定选项（第 j 项加 `@item<j>`，选中项的标题跟着那一项翻译）也一样提取。
- **默认语言的固定文字以 `ui/` 为准**：要改默认语言的文字，直接改 `ui/`；默认语言文本表里的这些键只是给翻译看的原文。
- 其他语言的 `i18n/<语言>.json` 照同样的键翻译。只编辑这些 JSON，不碰生成的翻译 XML。翻译和默认语言的原文一字不差时，`lgui check` 警告 `LGUI-UI-062`（多半是还没翻，比如 `lgui new` 先填进去的原文）。
- 占位符写成 `{count}`，各语言的占位符必须一致。
- **带字的图片**按 `@<语言>` 命名提供各语言版本，比如 `title.png`（默认）和 `title@en.png`。必须有不带后缀的默认版本；后缀的语言必须在工程配置 `languages` 里。界面里用**装载器**放它，在绑定表里写 `icon: 'ui://<包>/<图片名>'`（不带后缀），框架按当前语言换成对应版本；图片控件（`<image>`）、在 `ui/` 里写死的装载器 `url` 和按钮 `icon` 都不会随语言换，`lgui check` 报 `LGUI-UI-017`。
- 布局要给翻译留空间：英文、德文通常比中文长 40% 以上。用 `lgui verify --lang pseudo` 检查（文字加长 40%）。

## 10. Common 包（`lgui init` 自带）

框架的通用功能用这些组件，名字和必有控件固定。可以改它们的样子，不能改名字、不能删必有控件。

| 组件 | 用途 | 必有控件 |
|---|---|---|
| `Common/Toast` | `lgui.toast` 的提示 | `text`（文字） |
| `Common/Confirm` | `lgui.confirm` 的确认框 | `title`、`message`（文字），`ok`、`cancel`（按钮） |
| `Common/Loading` | `lgui.loading` 的加载中 | `text`（文字） |
| `Common/ActionHintBar` | 操作提示栏 | `list`（列表），子项组件 `Common/ActionHint` 里有 `key`、`label`（文字） |
| `Common/RedDot` | 红点 | `count`（文字，显示数字时用） |
| `Common/HoldProgress` | 长按进度 | 本身是一个进度条组件（`extention="ProgressBar"`） |
| `Common/ArtText` | 美术字的空容器（第 11 节） | 无 |
| `Common/placeholder`（图片） | 默认占位图 | — |

**操作提示栏：** 框架把 `Common/ActionHintBar` 放在最上面的 toast 层（不收输入），贴着屏幕底部，宽度铺满。它列出激活界面里带 `hint` 的按键动作，每一项用 `Common/ActionHint` 显示按键名（`key`，比如 Esc、Enter）和提示文字（`label`）；返回键默认显示文本键 `lgui.back`（「返回」）。触屏上没有按键，输入类型是触摸时提示栏隐藏。提示栏高 64 设计像素，全屏界面底部要给它留位置（第 7.3 节）。

**红点：** 要显示红点的控件（按钮、子组件）里放一个名字固定为 `redDot` 的子控件，通常就是 `Common/RedDot` 的实例。绑定表写了 `redDot` 的控件里缺这个子控件时，`lgui check` 报 `LGUI-UI-012`。

```xml
<!-- 在按钮组件 TabButton.xml 的 displayList 末尾 -->
<component id="n5" name="redDot" pkg="cmn00001" src="reddot01" xy="120,-8" size="32,32" visible="false"/>
```

**长按进度：** 用 `hold` 的按钮里放一个名字固定为 `holdProgress` 的进度条子控件。按住时框架让它从 0 涨到 100%，松手归零。没有这个子控件也能长按，只是不显示进度。

## 11. ArtText 美术字

伤害数字、金币数这类美术风格的文字，由美术画好每个字符的小图，`ArtText` 把它们一个个拼起来。网页和 Unity 都只用最基础的图片，显示一定一致。

- **字符图片**放在某个包的 `artfont/<字体名>/` 目录下，文件名是 `<字体名>_<字符名>.png`，都要在 `package.xml` 里登记并导出。
- **字符名：** `0`–`9` 直接用数字；其他字符用下面的名字：

| 字符 | `+` | `-` | `x` | `%` | `.` | `,` | `:` | `/` |
|---|---|---|---|---|---|---|---|---|
| 字符名 | `plus` | `minus` | `x` | `percent` | `dot` | `comma` | `colon` | `slash` |

- **在界面里放 ArtText：** 放一个 `Common/ArtText` 的实例，用 `customData` 写配置：

```xml
<component id="n9" name="damage" pkg="cmn00001" src="arttext1" xy="800,400" size="320,80"
  customData="font=Bag/dmg;align=center;spacing=2"/>
```

  - `font=<包>/<字体名>`：必填；
  - `align=left|center|right`：默认 `left`；
  - `spacing=<像素>`：字间距，默认 `0`。
- 绑定表里照常用 `text` 给它赋值。字符图片缺了某个字符时，运行时报 `LGUI-RT` 错误并指出是哪个字符；`customData` 写错或字体目录不存在时，`lgui check` 报 `LGUI-UI-013`。

## 12. 列表

- `defaultItem` 指向子项组件（导出），代码里用 `ItemView` 绑定。
- 自动排布：`layout="column"`（竖排一列）、`layout="row"`（横排一行）、`layout="flow_hz"`（横向排满换行，网格用这个）、`layout="flow_vt"`。
- 框架默认开虚拟列表，只创建看得见的子项，数据多也不卡。所以子项组件的尺寸要固定。
- **显示选中项：** 子项组件做成按钮（`extention="Button"`，带 `button` 控制器），根节点下写 `<Button mode="Radio"/>`；选中时 `button` 控制器在 `down` 页（鼠标悬停时是 `selectedOver`），用 `<gearDisplay controller="button" pages="1,3"/>` 挂一个选中框。普通模式（不写 `mode`）的按钮不保持选中，列表选了也看不出来。`lgui new view --pattern split|grid` 生成的子项已经这样写好了。
- 列表里不要放手写的子项，子项都由代码给数据生成。
- **拖放的格子：** 拖起时跟手的图标默认用被拖控件自己的图片，所以子项里放一个加载器（比如叫 `icon`），代码把 `dragData`、`drop` 写在它上面；格子本身不动，拖放以后由数据重新生成。
- **树：** 列表写 `treeView="true"` 就是树，每个节点用 `defaultItem` 的组件显示（做成 Radio 模式的按钮就能显示选中，和列表一样）。绑定表和列表用同样的词，节点的子节点放在数据的 `children` 字段里，`key` 必须写。节点默认展开；`clickToExpand="1"` 时单击有子节点的节点展开或收起，`"2"` 时双击；选中一个收起的节点里的子节点时，框架先展开它的父节点。树不是虚拟列表，节点多（几百个以上）时用列表。

## 13. 检查规则表

`lgui check` 用 OpenFairyGUI 读 `ui/` 来查。报错格式：`文件:行:列  错误码  说明  → 怎么改`。

| 错误码 | 规则 | 正确写法 | 错误写法 |
|---|---|---|---|
| `LGUI-UI-001` | 包 ID 是 8 位小写字母和数字，整个工程里唯一 | `id="bag00001"` | `id="Bag"`、两个包都叫 `bag00001` |
| `LGUI-UI-002` | 资源 ID 是 8 位小写字母和数字，包内唯一 | `id="sword001"` | `id="sword"`、两个资源都叫 `sword001` |
| `LGUI-UI-003` | 元素 ID 在组件内唯一 | `n0`、`n1` | 两个控件都是 `n3` |
| `LGUI-UI-004` | 控件名、控制器名是小写开头的驼峰，组件内唯一 | `sellButton` | `SellButton`、`sell_button`、两个 `title` |
| `LGUI-UI-005` | 控件、控制器、动效不能重名 | 控制器 `tabs`，控件 `tabBar` | 控制器 `tabs`，控件也叫 `tabs`；动效叫 `title`，控件也叫 `title` |
| `LGUI-UI-006` | 包名、组件名是大写开头的驼峰；后缀只能是 `@portrait`（组件）或 `@<语言>`（图片） | `BagPanel@portrait.xml` | `bagPanel.xml`、`BagPanel_portrait.xml` |
| `LGUI-UI-007` | 横竖两版的控件名、类型、控制器和页名完全一致 | 两版都有 `sellButton`（按钮） | 竖版少了 `sellButton`，或者竖版里它是文字 |
| `LGUI-UI-009` | 引用的资源存在；跨包引用的资源（子组件、图片）已导出 | `src="sword001"`（存在）；`<image pkg="cmn00001" src="placehd1">`（Common 里导出了） | 引用了已删掉的资源；引用别的包里没导出的图片 |
| `LGUI-UI-010` | 文字控件写了超长处理（`autoSize` 是 `shrink`、`height`、`ellipsis`、`both` 之一） | `autoSize="ellipsis" singleLine="true"` | 不写 `autoSize`，或写 `none` |
| `LGUI-UI-011` | 字号不小于 20；没写 `fontSize` 按 FairyGUI 默认的 12 号算 | `fontSize="22"` | `fontSize="14"`、不写 `fontSize` |
| `LGUI-UI-012` | 绑定了 `redDot` 的控件里有名为 `redDot` 的子控件 | 按钮里放了 `redDot` | 绑了 `redDot`，按钮里没有这个子控件 |
| `LGUI-UI-013` | ArtText 的 `customData` 格式对，字体目录存在 | `font=Bag/dmg;align=center` | `font=dmg`、字体目录不存在 |
| `LGUI-UI-014` | Common 包里的固定组件和必有控件都在 | `Common/Confirm` 里有 `ok`、`cancel` | 删了 `Common/Toast`，或 `Confirm` 里没有 `ok` |
| `LGUI-UI-015` | 九宫格：`scale="9grid"` 和 `scale9grid` 成对出现，区域不超出图片 | `scale="9grid" scale9grid="12,12,40,40"` | 只写了 `scale="9grid"` |
| `LGUI-UI-016` | 列表的 `defaultItem` 指向一个存在、已导出的组件 | `defaultItem="ui://bag00001slot0001"` | 不写 `defaultItem` |
| `LGUI-UI-017` | `@<语言>` 图片有默认版本，语言在 `languages` 里；带字图片用装载器放，地址写在绑定表里（图片控件、`ui/` 里写死的装载器 `url` 和按钮 `icon` 都不随语言换） | `title.png` + `title@en.png`，装载器 + `icon: 'ui://Bag/title'` | 只有 `title@en.png`，或 `title@xx.png`；`<image src="title 的 ID">`；`<loader url="ui://Bag/title">` |
| `LGUI-UI-018` | `package.xml` 登记的文件都存在，包目录里的组件、图片和音效都已登记 | 新图片登记进 `package.xml` | 放了图片没登记 |
| `LGUI-UI-019` | 代码里用到的组件（View 的 `component`、列表子项）已导出 | `exported="true"` | 没写 `exported` |
| `LGUI-UI-020`（警告） | 跨包引用写成编辑器能保存的样子：子组件跨包只写 `pkg` + `src`，不写 `fileName` | `pkg="cmn00001" src="button01"` | `fileName="Button.xml" pkg="cmn00001"` |
| `LGUI-UI-030` | 代码里 `lgui.t` 用到的键（包括 View 的 `keys` 表里的 `hint`）、`ui/` 里的固定文字，在每种语言的文本表里都有 | 各语言都有 `bag.sold` | `en.json` 里缺 `bag.sold` |
| `LGUI-UI-031`（警告） | 文本表里没有用不到的键（用模板字符串拼的键 `` lgui.t(`item.${kind}.name`) ``、条件表达式两边的键都算用到了；用变量传进来的键查不出来，所以只是警告） | — | 删掉了按钮，`Bag/BagPanel/oldButton` 还在表里 |
| `LGUI-UI-032` | 同一个键在各语言里的占位符一致 | `已售出 {count} 件` / `Sold {count}` | `Sold {num}` |
| `LGUI-UI-060` | 用户能看到的文字不写在 `gearText` 里 | `gearDisplay` + 绑定表 `text: pick(…, s => lgui.t(…))` | `<gearText … values="未达成\|可领取"/>` |
| `LGUI-UI-061` | 按钮不直接绑控制器（点了就切页） | 绑定表 `click: () => shopController.switchTab('second')` | `<Button controller="tabs" page="1"/>` |
| `LGUI-UI-062`（警告） | 别的语言的翻译和默认语言的原文不一样（一字不差多半是还没翻；不含文字的值不算） | `"Main/MainView/button": "Tap me"` | `en.json` 里写 `"点我"` |
| `LGUI-UI-063`（警告） | 横竖两版同一个控件的固定文字一样 | 两版都是 `text="背包"` | 竖版写 `text="我的背包"` |
| `LGUI-UI-064` | 全屏界面（`static fullScreen = true`）的组件，横竖两版都有名为 `safe` 的直接子控件 | 见第 7.3 节 | 全屏界面没有 `safe` |
| `LGUI-UI-065` | 音效（按钮的 `sound`、工程配置的 `sounds.click`）指向存在、已登记的 mp3；`sound=""` 表示不出声 | `<Button sound="ui://Bag/click"/>`，`click.mp3` 登记在 Bag 包里 | 没登记、文件不存在、`click.wav` |
| `LGUI-UI-066` | 给按钮、标签写了标题（实例上的 `<Button title>`、`<Label title>`，绑定表的 `text`），给下拉框写了选项（实例上的 `<item title>`，绑定表的 `items`），组件里就要有名为 `title` 的子控件 | 组件里的文字叫 `title` | 文字叫 `text`、`label`，绑定表还给它写 `text` / `items` |
| `LGUI-UI-067` | 动效里旋转、缩放的控件设了轴心 | `pivot="0.5,0.5"`（要绕左上角写 `pivot="0,0"`） | 不写 `pivot` 就做 `Rotation` / `Scale` |
| `LGUI-UI-068` | `shrink`、`ellipsis` 的文字，框只放得下一行时写 `singleLine="true"` | `size="300,40" fontSize="28" autoSize="shrink" singleLine="true"` | `size="300,40" fontSize="28" autoSize="shrink"` |
| `LGUI-UI-069` | 动效的目标不是普通组（普通组只在编辑时有，生成界面包时会被去掉，动效动不了它） | 要动整组就用高级组 `<group … advanced="true"/>`，或者让动效直接动组里的控件 | `<group id="n8" …/>` + `<item type="XY" target="n8" …/>` |
| `LGUI-UI-080` | XML 的 `font`、富文本的 `[font=…]`（也查 `i18n/` 的文案）只写 `ui/fonts/` 里的字体名 | `font="NotoSansSC"` | `font="Microsoft YaHei"`、`font="ui://bag00001font0001"` |

靠人看、机器查不出的：图里不放文字；同一个工程的图风格一致；文字在各尺寸下没有被截断（看 `lgui verify` 的截图）。
