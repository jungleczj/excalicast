'use client';

/**
 * 提词器跟读「识别编排器」：Google 为首 → 离线回落。
 *
 *  - **Primary = Web Speech（Google）**：云端识别、不占本地 CPU（录制更顺）。新 Chrome（135+，
 *    `SpeechRecognition.available` 存在）支持 `start(audioTrack)` → 直接吃录制的 MediaStreamTrack，
 *    与录制**共用麦克风**、录制中也能识别；旧版退回 `start()`（默认麦克风，仅适合不录制）。
 *  - **看门狗 + 回落**：网络错（大陆不可达）/被拒/不支持/监听后久无结果（抢占·静默失败）→ 自动
 *    回落到**离线 vosk**（`voskRecognizer`，喂同一路 MediaStream，AudioWorklet 取帧不卡）。
 *
 * 调用方只管 `onText`（partial/final 都回调同一函数做匹配高亮）与 `onStatus`。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { VoskLang } from '@/services/voskRecognizer';

export type ReadalongStatus = 'loading' | 'listening' | 'error' | 'fallback';

export interface StartReadalongOptions {
  stream: MediaStream;
  lang: VoskLang;
  onText: (text: string) => void;
  onStatus: (status: ReadalongStatus, detail?: string) => void;
}

export interface ReadalongHandle {
  stop: () => void;
}

const SR: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
const hasWebSpeech = !!SR;
// 新 API（可对 MediaStreamTrack 识别）的探针：静态 available() 方法存在即认为支持 start(track)。
const hasTrackInput = hasWebSpeech && typeof SR.available === 'function';
const NO_RESULT_FALLBACK_MS = 5000;

export async function startReadalong(opts: StartReadalongOptions): Promise<ReadalongHandle> {
  const { stream, lang, onText, onStatus } = opts;
  let stopped = false;
  let rec: any = null;
  let voskHandle: { stop: () => void } | null = null;
  let watchdog: number | undefined;
  let fellBack = false;

  const clearWatchdog = () => { if (watchdog) { window.clearTimeout(watchdog); watchdog = undefined; } };

  const toOffline = async (reason: string) => {
    if (stopped || fellBack) return;
    fellBack = true;
    clearWatchdog();
    try { rec && (rec.onresult = rec.onerror = rec.onend = rec.onstart = null); rec?.abort?.(); } catch { /* */ }
    rec = null;
    onStatus('fallback', reason);
    try {
      const { startVosk } = await import('@/services/voskRecognizer');
      if (stopped) return;
      voskHandle = await startVosk({
        stream, lang,
        onPartial: onText,
        onFinal: onText,
        onStatus: (s) => onStatus(s === 'listening' ? 'listening' : s === 'error' ? 'error' : 'loading'),
      });
      if (stopped) voskHandle.stop();
    } catch (e: any) { onStatus('error', String(e?.message || e)); }
  };

  const startArgs = (): any[] => {
    if (hasTrackInput) { const tr = stream.getAudioTracks?.()[0]; if (tr) return [tr]; }
    return [];
  };

  // 先试 Google
  if (hasWebSpeech) {
    onStatus('loading');
    try {
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
      rec.onstart = () => {
        if (stopped) return;
        onStatus('listening');
        clearWatchdog();
        // 监听后久无结果 → 多半是录制抢占/静默失败 → 回落
        watchdog = window.setTimeout(() => void toOffline('no-result'), NO_RESULT_FALLBACK_MS);
      };
      rec.onresult = (e: any) => {
        clearWatchdog();
        const r = e.results[e.results.length - 1];
        const t = String(r?.[0]?.transcript || '').trim();
        if (t) onText(t);
      };
      rec.onerror = (ev: any) => {
        const err = ev?.error;
        if (err === 'network' || err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
          void toOffline(`error:${err}`);
        }
        // no-speech / aborted：交给 onend 重启或看门狗
      };
      rec.onend = () => { if (!stopped && !fellBack) { try { rec.start(...startArgs()); } catch { /* */ } } };

      try { rec.start(...startArgs()); } catch { void toOffline('start-throw'); }
    } catch { void toOffline('init-throw'); }
  } else {
    // 没有 Web Speech（非 Chrome 系）直接离线
    void toOffline('no-webspeech');
  }

  return {
    stop() {
      stopped = true;
      clearWatchdog();
      try { rec && (rec.onresult = rec.onerror = rec.onend = rec.onstart = null); rec?.abort?.(); } catch { /* */ }
      rec = null;
      voskHandle?.stop();
      voskHandle = null;
    },
  };
}
