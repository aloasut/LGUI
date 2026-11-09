// lgui 生成的 headless 描述（.lgui/build/headless/<包名>.json）的类型。
import type {TransitionTouch, UIKind} from '../../core/index';

/** 控制显示的齿轮（页名已经从页 ID 换好）。 */
export interface GearsDescriptor {
  /** gearDisplay：控制器在这些页时显示。 */
  display?: {controller: string; pages: string[]};
  /** gearDisplay2：再加一个条件，condition 0 是「并且」、1 是「或者」。 */
  display2?: {controller: string; pages: string[]; condition: number};
  /** 改属性的齿轮（gearText、gearColor、gearIcon、gearLook、gearFontSize）和它跟的控制器：headless 不模拟，读到它管的属性时报 LGUI-RT-260；代码补间碰它管的属性报 LGUI-RT-282。 */
  props?: {gear: PropGear; controller: string}[];
}

/** 改属性的齿轮：gearText 改文字，gearColor 改颜色，gearIcon 改图标（加载器的地址），gearLook 改透明度、旋转、变灰和能不能点，gearFontSize 改字号。 */
export type PropGear = 'gearText' | 'gearColor' | 'gearIcon' | 'gearLook' | 'gearFontSize';

/** 位置和尺寸由谁决定（headless 不算这些布局，读到受影响的位置、尺寸时报 LGUI-RT-260）。 */
export interface LayoutDescriptor {
  /** 关联（relation 的 sidePair，比如 left-left、width-width）。 */
  relations?: string[];
  /** 有改位置的齿轮（gearXY）。 */
  gearXY?: boolean;
  /** 有改尺寸的齿轮（gearSize）。 */
  gearSize?: boolean;
}

/** 一个组（不进控件树，只管组里控件的显隐）。 */
export interface GroupDescriptor {
  /** 元素 ID（控件的 group 写它）。 */
  id: string;
  /** 组名。 */
  name: string;
  /** 初始是否显示。 */
  visible: boolean;
  /** 所在的上一级组。 */
  group: string | null;
  /** 齿轮。 */
  gears?: GearsDescriptor;
  /** 组的自动排布（hz 横排、vt 竖排），排布会挪动组里的控件。 */
  layout?: string;
  /** 组自己的关联（组挪动时组里的控件跟着动）。 */
  relations?: string[];
  /** 组上有改位置的齿轮（gearXY）：组挪动时组里的控件跟着动。 */
  gearXY?: boolean;
  /** 组上有改尺寸的齿轮（gearSize）：有自动排布（layout）的组改尺寸时，组里的控件跟着改尺寸。 */
  gearSize?: boolean;
}

/** 一个子控件。 */
export interface ChildDescriptor {
  /** 控件名。 */
  name: string;
  /** 元素 ID（翻译文件用它定位）。 */
  elementId?: string;
  /** 控件类型。 */
  kind: UIKind;
  /** 子组件引用的「包/组件」。 */
  ref: string | null;
  /** 列表的子项组件。 */
  defaultItem: string | null;
  /** [x, y, 宽, 高]（设计尺寸）。 */
  rect: [number, number, number, number];
  /** 初始属性。 */
  props: {
    visible: boolean; enabled: boolean; touchable: boolean; customData?: string; text?: string; promptText?: string; url?: string; title?: string; icon?: string;
    selected?: boolean; selectedIndex?: number; value?: number; max?: number; min?: number; color?: string; items?: string[]; playing?: boolean; frame?: number; clickToExpand?: number; sound?: string; soundVolume?: number; scrollable?: boolean;
    /** 文字的自动大小（none、both、height、shrink、ellipsis）；加载器写 true 是尺寸跟着图片。 */
    autoSize?: string;
    /** 输入框最多能输入几个字（UTF-16 长度），不写是不限。 */
    maxLength?: number;
    /** 轴心（0–1），不写是 (0, 0)。 */
    pivot?: [number, number];
    /** 缩放，不写是 (1, 1)。 */
    scale?: [number, number];
    /** 旋转（度），不写是 0。 */
    rotation?: number;
    /** 透明度，不写是 1。 */
    alpha?: number;
    /** 文字的字号（像素）。 */
    fontSize?: number;
    /** 图片、加载器的填充方式（不写是不填充）。 */
    fillMethod?: 'none' | 'horizontal' | 'vertical' | 'radial90' | 'radial180' | 'radial360';
    /** 图片、加载器的填充比例 0–1。 */
    fillAmount?: number;
  };
  /** 所在的组（组的元素 ID）。 */
  group?: string | null;
  /** 齿轮。 */
  gears?: GearsDescriptor;
  /** 位置和尺寸由谁决定。 */
  layout?: LayoutDescriptor;
}

/** 一个组件。 */
export interface ComponentDescriptor {
  /** 「包/组件」。 */
  name: string;
  /** 资源 ID。 */
  id: string;
  /** 是否导出。 */
  exported: boolean;
  /** 扩展类型（Button、ProgressBar 等）。 */
  extension: string | null;
  /** 按钮的模式：Common 不保持选中；Check、Radio 保持（列表的选中项靠它显示）。 */
  buttonMode?: string | null;
  /** 滑动条：用户拖动时是否取整。 */
  wholeNumbers?: boolean;
  /** 按钮组件自己设的点击音效（ui://包名/声音名）。 */
  sound?: string;
  /** 按钮组件自己设的音效音量（0–1，0 是不出声）。 */
  soundVolume?: number;
  /** 组件自己的轴心（0–1），没写是 (0, 0)；实例上写的优先。 */
  pivot?: [number, number];
  /** 按钮组件的按下效果（downEffect、downEffectValue），没写是没有。 */
  downEffect?: {type: 'dark' | 'scale'; value: number};
  /** [宽, 高]。 */
  size: [number, number];
  /** 控制器。 */
  controllers: {name: string; pages: string[]; selected: string | null}[];
  /** 动效：名字、放一遍要多少毫秒（-1 是永远放不完）、自动播放、播放次数、自动播放前等多久（毫秒）；每一项改哪个控件（控件名，组件自己是 null）的哪一类属性。 */
  transitions: {name: string; ms: number; autoPlay: boolean; times: number; delay: number; items?: {target: string | null; what: TransitionTouch}[]}[];
  /** 组。 */
  groups?: GroupDescriptor[];
  /** 子控件。 */
  children: ChildDescriptor[];
}

/** 一个包。 */
export interface PackageDescriptor {
  /** 格式版本。 */
  schemaVersion: 1;
  /** 包名。 */
  package: string;
  /** 包 ID。 */
  id: string;
  /** 组件。 */
  components: ComponentDescriptor[];
  /** 图片：名字和尺寸（ArtText 拼字时要用）。 */
  images: {name: string; width: number; height: number}[];
  /** 声音：资源 ID 和名字。 */
  sounds?: {id: string; name: string}[];
}
