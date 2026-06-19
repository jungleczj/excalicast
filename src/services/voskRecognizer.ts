'use client';

/**
 * 提词器实时识别层 —— 离线 vosk-browser（WASM）。
 *
 * 关键：**与录制共用同一路 `MediaStream`**（拾音与识别解耦）—— 解决 `webkitSpeechRecognition`
 * 独占麦克风、录制时拿不到音频的硬伤。音频经 Web Audio API 取帧喂给 vosk，本地识别、不传云、任意地区可用。
 *
 * 模型：vosk-browser 专用的 gzipped-tar（含 `model/` 目录结构）。放 `public/models/vosk/`，可用
 * `NEXT_PUBLIC_VOSK_MODEL_ZH_URL` / `NEXT_PUBLIC_VOSK_MODEL_EN_URL` 覆盖（如换 CDN）。模型懒加载 + 进程内缓存。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createModel, type Model } from 'vosk-browser';

export type VoskLang = 'zh' | 'en';
export type VoskStatus = 'loading' | 'listening' | 'error';

export interface StartVoskOptions {
  stream: MediaStream;
  lang: VoskLang;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onStatus: (status: VoskStatus, detail?: string) => void;
}

export interface VoskHandle {
  stop: () => void;
}

const MODEL_URL: Record<VoskLang, string> = {
  zh:
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_VOSK_MODEL_ZH_URL) ||
    '/models/vosk/vosk-model-small-cn.tar.gz',
  en:
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_VOSK_MODEL_EN_URL) ||
    '/models/vosk/vosk-model-small-en-us.tar.gz',
};

// 进程内缓存：同一语言模型只下载/初始化一次（懒加载，仅首次启用跟读时触发）。
const modelCache: Partial<Record<VoskLang, Promise<Model>>> = {};
function getModel(lang: VoskLang): Promise<Model> {
  if (!modelCache[lang]) {
    modelCache[lang] = createModel(MODEL_URL[lang]).catch((e) => {
      // 失败别污染缓存，下次可重试
      delete modelCache[lang];
      throw e;
    });
  }
  return modelCache[lang]!;
}

/** 启动跟读识别。返回 `stop()`；模型保留缓存以便复用。 */
export async function startVosk(opts: StartVoskOptions): Promise<VoskHandle> {
  const { stream, lang, onPartial, onFinal, onStatus } = opts;
  let stopped = false;
  let recognizer: any = null;
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let worklet: AudioWorkletNode | null = null;
  let processor: ScriptProcessorNode | null = null;

  const cleanup = () => {
    stopped = true;
    try { if (processor) processor.onaudioprocess = null as any; } catch { /* */ }
    try { if (worklet) worklet.port.onmessage = null; } catch { /* */ }
    try { source?.disconnect(); } catch { /* */ }
    try { worklet?.disconnect(); } catch { /* */ }
    try { processor?.disconnect(); } catch { /* */ }
    try { recognizer?.remove?.(); } catch { /* */ }
    try { void audioCtx?.close(); } catch { /* */ }
  };

  onStatus('loading');
  try {
    const model = await getModel(lang);
    if (stopped) return { stop: cleanup };

    recognizer = new model.KaldiRecognizer(16000);
    try { recognizer.setWords(true); } catch { /* */ }
    recognizer.on('partialresult', (m: any) => {
      const t = m?.result?.partial;
      if (t) onPartial(String(t));
    });
    recognizer.on('result', (m: any) => {
      const t = m?.result?.text;
      if (t) onFinal(String(t));
    });
    recognizer.on('error', (m: any) => onStatus('error', String(m?.error || 'vosk error')));

    // AudioContext 强制 16kHz（Chrome 会把麦克风重采样进来），vosk 模型按 16kHz 创建。
    audioCtx = new AudioContext({ sampleRate: 16000 });
    source = audioCtx.createMediaStreamSource(stream);
    const sr = audioCtx.sampleRate;
    const feed = (buf: Float32Array) => { if (!stopped && recognizer) { try { recognizer.acceptWaveformFloat(buf, sr); } catch { /* */ } } };

    // 优先 AudioWorklet（音频线程取帧，录制时不被主线程饿死 → 不卡）；不支持则退回 ScriptProcessor。
    let useWorklet = false;
    if (audioCtx.audioWorklet) {
      try {
        await audioCtx.audioWorklet.addModule('/worklets/pcm-forwarder.js');
        if (stopped) { cleanup(); return { stop: cleanup }; }
        worklet = new AudioWorkletNode(audioCtx, 'pcm-forwarder');
        worklet.port.onmessage = (e: MessageEvent) => feed(e.data as Float32Array);
        source.connect(worklet);
        worklet.connect(audioCtx.destination);
        useWorklet = true;
      } catch { useWorklet = false; }
    }
    if (!useWorklet) {
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => feed(e.inputBuffer.getChannelData(0));
      source.connect(processor);
      processor.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch { /* */ } }

    if (stopped) { cleanup(); return { stop: cleanup }; }
    onStatus('listening');
  } catch (e: any) {
    cleanup();
    onStatus('error', String(e?.message || e));
  }

  return { stop: cleanup };
}
