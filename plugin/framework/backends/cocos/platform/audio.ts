// cocos 的声音出口：ui:// 声音从界面包里取（运行库把包里的 sound 资源加载成 AudioClip），
// 音效走 AudioSourceComponent.playOneShot；背景音乐一条常驻通道，换曲淡入淡出（帧回调里推音量）。
// Web 目标的自动播放限制：解锁（第一次点击/按键）之前要放的音乐先记着，解锁后再放。
import {AudioClip, AudioSourceComponent, director, Node as CcNode} from 'cc';
import * as fgui from 'fairygui-cc';
import type {AudioService} from '../../../core/index';
import {LgRuntimeError} from '../../../core/index';

export function createCocosAudio(): {service: AudioService; unlock(): void; tickMusic(dtMs: number): void} {
  let host: CcNode | null = null;
  let musicSource: AudioSourceComponent | null = null;
  let paused = false;
  // 想放的背景音乐（解锁之前也记着）和正在放的那一首（volume 是淡入淡出的目标音量）。
  let target: {url: string; volume: number; onError: (error: unknown) => void} | null = null;
  let current: {url: string; volume: number} | null = null;
  let fadeMs = 0;
  let unlocked = false;

  function ensureHost(): AudioSourceComponent {
    if (!host) {
      const scene = director.getScene();
      if (!scene) throw new LgRuntimeError('LGUI-RT-028', '声音出口建不起来：场景还没就绪。', '在场景加载完成后再调用 lgui.app()。');
      // cc 的 addChild 返回 void（不是子节点）——先建节点再挂，别把返回值当节点用（T008/example 校准发现）。
      host = new CcNode('LGUI-Audio');
      scene.addChild(host);
    }
    if (!musicSource) musicSource = host.addComponent(AudioSourceComponent);
    return musicSource;
  }

  // ui://包名/声音名（也认 ui://包ID资源ID）→ 包里的 AudioClip。没登记报 LGUI-RT-170。
  function clipOf(url: string): AudioClip {
    if (!url.startsWith('ui://')) throw new LgRuntimeError('LGUI-RT-170', `声音地址 ${url} 不是 ui:// 包内地址。`, '把 mp3 放进包目录并在 package.xml 登记，代码里用 ui://包名/声音名。');
    const match = /^ui:\/\/([^/]+)\/(.+)$/.exec(url);
    const pkg = match ? fgui.UIPackage.getByName(match[1]) : undefined;
    const item = pkg?.getItemByName(match![2]);
    const clip = item ? pkg!.getItemAsset(item) : null;
    if (!clip) throw new LgRuntimeError('LGUI-RT-170', `声音 ${url} 没有登记在 ui/ 的包里。`, '把 mp3 放进包目录，在 package.xml 里登记成 <sound … exported="true"/>，地址写成 ui://包名/声音名。');
    return clip as AudioClip;
  }

  // 每帧把音乐通道音量朝目标推一步（线性淡入淡出；时长是 fadeMs）。
  function tickMusic(dtMs: number): void {
    const source = musicSource;
    if (!source || !current || !source.playing) return;
    const step = (dtMs / Math.max(fadeMs, 1)) * current.volume;
    const diff = current.volume - source.volume;
    if (Math.abs(diff) <= step) source.volume = current.volume;
    else source.volume += Math.sign(diff) * step;
  }

  function sync(): void {
    const want = target;
    const source = ensureHost();
    if (current && want && current.url === want.url) { current.volume = want.volume; return; } // 同一首只改音量
    if (current) { // 换曲：骨架直接停旧的，交叉淡出 T007 再做
      source.stop();
      current = null;
    }
    if (!want || paused) return;
    let clip: AudioClip;
    try { clip = clipOf(want.url); } catch (error) { want.onError(error); return; }
    source.clip = clip;
    source.loop = true;
    source.volume = 0;
    source.play();
    current = {url: want.url, volume: want.volume};
  }

  const service: AudioService = {
    play(url, volume, onError) {
      if (paused) return;
      try {
        const clip = clipOf(url);
        ensureHost().playOneShot(clip, volume);
      } catch (error) { onError(error); }
    },
    music(url, volume, fade, onError) {
      fadeMs = fade;
      target = url === null ? null : {url, volume, onError};
      if (unlocked) sync();
      else if (url !== null) { try { clipOf(url); } catch (error) { onError(error); } } // 解锁后再放；先检查地址
    },
    setPaused(value) {
      paused = value;
      if (!musicSource) return;
      if (value) { musicSource.stop(); current = null; }
      else if (target) sync();
    }
  };

  /** 第一次点击或按键时调用：解锁自动播放，放之前记下的背景音乐。 */
  function unlock(): void {
    if (unlocked) return;
    unlocked = true;
    if (target) sync();
  }

  return {service, unlock, tickMusic};
}
