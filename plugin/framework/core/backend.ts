// 接口层的后端：每个引擎实现一份（h5、headless、unity）。
import type {Platform} from './platform';
import type {UIComponent, UIObject} from './ui';

/** 后端启动参数，来自工程配置。 */
export interface BackendConfig {
  /** 工程名（存储键名的前缀）。 */
  projectName: string;
  /** 默认字体：项目字体的名字（ui/fonts/<名字>.ttf），null 表示用系统默认字体。 */
  defaultFont: string | null;
  /** 项目字体的名字（ui/fonts/ 里的文件名去掉扩展名）。启动时在创建任何界面之前加载好；不写就是没有项目字体。 */
  fonts?: readonly string[];
  /** 界面包所在的地址或目录（h5 是生成目录里 ui/ 对应的网址：lgui dev 是 .lgui/build/dev/ui/，lgui verify 是 .lgui/build/verify/site/ui/；生成的启动入口传 ./ui）。 */
  uiBase: string;
  /** 翻译文件所在的地址（h5 是生成目录里 i18n/ 对应的网址，比如 .lgui/build/dev/i18n/；生成的启动入口传 ./i18n）。不写时只能用默认语言，换语言报 LGUI-RT-173。 */
  i18nBase?: string;
}

/** 一个后端。 */
export interface Backend {
  /** 后端名。 */
  readonly name: 'h5' | 'headless' | 'unity' | 'cocos';
  /** 启动：建好根节点和平台服务。 */
  init(config: BackendConfig): Promise<void>;
  /** 根节点，UIManager 在它下面放 5 个层。 */
  readonly root: UIComponent;
  /** 加载一个界面包（按包名）。 */
  loadPackage(name: string): Promise<void>;
  /** 释放一个界面包。 */
  releasePackage(name: string): void;
  /** 创建一个组件实例；包没加载或组件不存在时报 LGUI-RT 错误。 */
  create<Name extends string>(packageName: string, componentName: string): UIComponent<Name>;
  /** 换界面上固定文字的语言：加载这种语言的翻译，并重新加载已经加载的界面包（翻译只在组件创建时生效）。之后创建的组件都是新语言。 */
  setLanguage(language: string): Promise<void>;
  /** 包里有没有这个组件（包要先加载）。换横竖版时用。 */
  has(packageName: string, componentName: string): boolean;
  /** 包里一张图片的尺寸（地址写成 ui://包名/图片名，包要先加载）；没有这张图片返回 null。 */
  imageSize(url: string): {width: number; height: number} | null;
  /** 按地址创建一张图片（ArtText 用它拼字）。 */
  createImage(url: string): UIObject;
  /** 创建一个空容器（UIManager 的层用它）。 */
  createContainer(name: string): UIComponent;
  /** 平台服务。 */
  readonly platform: Platform;
}
