// 接口层（相当于 RHI）：只导出类型和错误类。
export type {
  Unsubscribe, Rect, PointerInput, UIObject, UIComponent, UIText, UIRichText, UIInput, UIButton,
  UIImage, UILoader, UIList, UIController, UITransition, UIProgress, UIGraph, UILabel, UISlider, UIComboBox, UIMovieClip, UITree, UITreeNode, UIKinds, UIKind, TweenProp, TransitionTouch
} from './ui';
export type {
  Platform, TimeService, StorageService, ResourceService, InputService, KeyInput, WheelInput,
  TextInputService, ScreenService, Insets, AudioService, LocaleService, Logger, LogLevel,
  NetService, NetResponse, NetSocket, ClipboardService
} from './platform';
export type {Backend, BackendConfig} from './backend';
export {LgRuntimeError, notImplemented} from './errors';
