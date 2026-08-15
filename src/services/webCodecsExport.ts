'use client';

/**
 * WebCodecs 硬件编码导出（MP4）。
 *
 * 用浏览器内置 VideoEncoder（优先硬件）把逐帧 canvas 直接编码为 H.264，
 * 音频经 AudioEncoder 转 AAC，二者用 mp4-muxer 混流为 MP4 —— 全程不经过
 * PNG/JPEG 序列与 ffmpeg.wasm 软件编码，速度比 ffmpeg 路径快数倍。
 *
 * 仅在「无摄像头叠加」时启用（摄像头叠加仍走 ffmpeg overlay 路径）。
 * 任何不支持/异常都向上抛，由 exportPipeline 回退到 ffmpeg 路径。
 *
 * WebCodecs 类型在不同 TS lib 版本下可能缺失，这里从 globalThis 取构造器并以
 * 宽松类型使用，避免对 lib.dom 的强依赖导致编译失败。
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { createMp4TimestampMapper, MonotonicTimestampNormalizer } from '@/services/mediaTimestamps';
import {
  EXPORT_AUDIO_BITRATE,
  EXPORT_AUDIO_SAMPLE_RATE,
  createContinuousAacTimeline,
  type PreparedExportAudio,
} from '@/services/exportAudio';
import { createCameraFrameSource } from './webmCameraFrames';
import type { ExportQuality } from '@/types/recording';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface EncodeParams {
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  preparedAudio: Promise<PreparedExportAudio> | null;
  /** 容器/编码：'mp4'＝H.264+AAC+mp4-muxer；'webm'＝VP9+Opus+webm-muxer。缺省 mp4。 */
  format?: 'mp4' | 'webm';
  /** 码率倍率（质量档），乘到 estimateBitrate 上。缺省 1。 */
  bitrateMultiplier?: number;
  /** 质量优先的编码策略；Auto 优先恒定质量，旧调用仍可用 bitrateMultiplier。 */
  quality?: ExportQuality;
  renderFrame: (i: number) => Promise<HTMLCanvasElement>;
  onProgress?: (p: number) => void; // 0..1
  signal?: AbortSignal;
}

export type WebCodecsAudioMode = 'none' | 'direct' | 'remux';

export function resolveWebCodecsAudioMode(input: {
  hasAudio: boolean;
  audioEncoderAvailable: boolean;
  audioConfigSupported: boolean;
}): WebCodecsAudioMode {
  if (!input.hasAudio) return 'none';
  return input.audioEncoderAvailable && input.audioConfigSupported ? 'direct' : 'remux';
}

export interface WebCodecsEncodeResult {
  blob: Blob;
  audioEncoded: boolean;
}

interface Mp4VideoChunkTarget {
  addVideoChunk: (
    chunk: any,
    meta: any,
    presentationTimestampUs: number,
    compositionTimeOffsetUs: number,
  ) => void;
}

interface Mp4AudioChunkTarget {
  addAudioChunk: (chunk: any, meta: any, timestamp: number) => void;
}

interface BufferedAudioChunk {
  chunk: any;
  meta: any;
  order: number;
}

interface BufferedMuxAudioChunk {
  chunk: any;
  meta: any;
  timestamp?: number;
}

export async function settleDirectAudioEncoding<T>(
  direct: boolean,
  encode: () => Promise<T>,
): Promise<{ mode: 'direct'; value: T; reason?: undefined } | { mode: 'remux'; value: null; reason?: string }> {
  if (!direct) return { mode: 'remux', value: null };
  try {
    return { mode: 'direct', value: await encode() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error || 'audio_encoder_failed');
    return { mode: 'remux', value: null, reason };
  }
}

/** Keep H.264 presentation order separate from the monotonic MP4 decode timeline. */
export function createMp4VideoChunkWriter(fps: number, target: Mp4VideoChunkTarget) {
  const mapTimestamp = createMp4TimestampMapper(fps);
  return (chunk: any, meta: any): void => {
    const timestamp = mapTimestamp(chunk.timestamp as number);
    target.addVideoChunk(
      chunk,
      meta,
      timestamp.presentationTimestampUs,
      timestamp.compositionTimeOffsetUs,
    );
  };
}

/** AAC callbacks may be delivered out of timestamp order; MP4 requires monotonic audio DTS. */
export function createMp4AudioChunkBuffer(target: Mp4AudioChunkTarget) {
  const pending: BufferedAudioChunk[] = [];
  return {
    push(chunk: any, meta: any): void {
      pending.push({ chunk, meta, order: pending.length });
    },
    flush(): void {
      const timeline = createContinuousAacTimeline(pending.map(({ chunk }) => ({
        timestamp: Number(chunk.timestamp),
        duration: Number(chunk.duration),
      })));
      for (let index = 0; index < timeline.order.length; index += 1) {
        const { chunk, meta } = pending[timeline.order[index]];
        target.addAudioChunk(chunk, meta, timeline.timestamps[index]);
      }
      pending.length = 0;
    },
  };
}

export async function drainEncoderBackpressure(
  encoder: { encodeQueueSize: number; flush: () => Promise<void> },
  maxQueueSize = 8,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  if (encoder.encodeQueueSize <= maxQueueSize) return;
  // flush() is driven by the codec implementation. Unlike setTimeout polling it
  // is not clamped when the page is hidden, and rejects immediately if Chrome
  // has reclaimed the codec.
  if (!signal) {
    await encoder.flush();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Export cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    encoder.flush().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const G = globalThis as any;

function avcCodecString(width: number, height: number): string {
  // Main profile（4d00）；按分辨率挑 level：≤1080p → 4.1(0x29)，更大 → 5.1(0x33)
  const level = width * height > 1920 * 1080 ? '33' : '29';
  return `avc1.4d00${level}`;
}

function vp9CodecString(width: number, height: number): string {
  // profile 0 / 8-bit；按分辨率挑 level：≤1080p → 4.1，更大(含 1440p/4K) → 5.1。
  // level 太低会被 isConfigSupported 拒（默认 1.0 仅 ~256×144）。
  const level = width * height > 1920 * 1080 ? '51' : '41';
  return `vp09.00.${level}.08`;
}

export type VideoRateControl =
  | { bitrateMode: 'quantizer'; quantizer: number }
  | { bitrateMode: 'variable'; bitrate: number };

export function resolveVideoRateControl(input: {
  width: number;
  height: number;
  fps: number;
  quality: ExportQuality;
  quantizerSupported: boolean;
}): VideoRateControl {
  const quantizer: Record<ExportQuality, number> = { auto: 23, high: 18, medium: 27, low: 31 };
  if (input.quantizerSupported) {
    return { bitrateMode: 'quantizer', quantizer: quantizer[input.quality] };
  }
  // VBR 是不支持 per-frame quantizer 时的兼容路径。按内容质量留出峰值空间，
  // 不再把 Auto 锁成接近 CBR 的 width*height*fps*0.1。
  const bitsPerPixel: Record<ExportQuality, number> = { auto: 0.065, high: 0.12, medium: 0.052, low: 0.038 };
  const bitrate = Math.round(input.width * input.height * input.fps * bitsPerPixel[input.quality]);
  return {
    bitrateMode: 'variable',
    bitrate: Math.min(14_000_000, Math.max(1_000_000, bitrate)),
  };
}

export async function encodeWebCodecsMp4(params: EncodeParams): Promise<WebCodecsEncodeResult> {
  const { totalFrames, fps, width, height, preparedAudio, renderFrame, onProgress, signal } = params;
  const format = params.format ?? 'mp4';
  const bitrateMul = params.bitrateMultiplier ?? 1;
  const quality = params.quality ?? 'auto';
  const isWebm = format === 'webm';
  const VideoEncoderCtor = G.VideoEncoder;
  const AudioEncoderCtor = G.AudioEncoder;
  const VideoFrameCtor = G.VideoFrame;
  const AudioDataCtor = G.AudioData;
  if (!VideoEncoderCtor || !VideoFrameCtor) throw new Error('webcodecs_unavailable');
  const checkAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };
  checkAborted();

  // 1) 仅在浏览器具备直接音频编码能力时解码音频。若缺少 AAC/Opus
  // AudioEncoder，视频仍走硬件编码，调用方随后只用 ffmpeg remux 音频。
  let audioConfigSupported = false;
  const audioEncoderAvailable = !!AudioEncoderCtor && !!AudioDataCtor;
  if (preparedAudio && audioEncoderAvailable) {
    try {
      const audioConfig = {
        codec: isWebm ? 'opus' : 'mp4a.40.2',
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        numberOfChannels: 1,
        bitrate: EXPORT_AUDIO_BITRATE,
      };
      const audioSupport = await AudioEncoderCtor.isConfigSupported(audioConfig);
      audioConfigSupported = !!audioSupport?.supported;
    } catch {
      audioConfigSupported = false;
    }
  }

  // 2) 校验视频编码器配置（先试硬件，不支持再试默认）。mp4→H.264(avc1)；webm→VP9(vp09)。
  const codecConfig: any = isWebm
    ? { codec: vp9CodecString(width, height), width, height, framerate: fps }
    : { codec: avcCodecString(width, height), width, height, framerate: fps, avc: { format: 'avc' } };
  const quantizerCandidate: any = {
    ...codecConfig,
    bitrateMode: 'quantizer',
    hardwareAcceleration: 'prefer-hardware',
  };
  let quantizerSupported = false;
  try {
    quantizerSupported = !!(await VideoEncoderCtor.isConfigSupported(quantizerCandidate))?.supported;
  } catch { /* older browsers reject the bitrateMode member */ }
  const rateControl = resolveVideoRateControl({ width, height, fps, quality, quantizerSupported });
  const baseCfg: any = rateControl.bitrateMode === 'quantizer'
    ? { ...codecConfig, bitrateMode: 'quantizer' }
    : { ...codecConfig, bitrateMode: 'variable', bitrate: Math.round(rateControl.bitrate * bitrateMul) };
  let videoCfg: any = { ...baseCfg, hardwareAcceleration: 'prefer-hardware' };
  let support = await VideoEncoderCtor.isConfigSupported(videoCfg);
  if (!support?.supported) {
    videoCfg = { ...baseCfg };
    support = await VideoEncoderCtor.isConfigSupported(videoCfg);
    if (!support?.supported) throw new Error('video_encoder_config_unsupported');
  }

  const audioMode = resolveWebCodecsAudioMode({
    hasAudio: !!preparedAudio,
    audioEncoderAvailable,
    audioConfigSupported,
  });
  const directAudio = audioMode === 'direct';
  const audioEncoding = directAudio
    ? preparedAudio!.then((audio) => settleDirectAudioEncoding(true, async () => {
        const chunks: BufferedMuxAudioChunk[] = [];
        const target = {
          addAudioChunk: (chunk: any, meta: any, timestamp?: number) => {
            chunks.push({ chunk, meta, timestamp });
          },
        };
        await encodeAudioTrack(
          audio,
          isWebm ? 'opus' : 'mp4a.40.2',
          AudioEncoderCtor,
          AudioDataCtor,
          target,
          (progress) => onProgress?.(progress * 0.05),
          signal,
        );
        return chunks;
      }))
    : Promise.resolve({ mode: 'remux' as const, value: null });

  const createMuxer = (withAudio: boolean): any => isWebm
    ? new WebmMuxer({
        target: new WebmTarget(),
        video: { codec: 'V_VP9', width, height, frameRate: fps },
        audio: withAudio ? { codec: 'A_OPUS', numberOfChannels: 1, sampleRate: EXPORT_AUDIO_SAMPLE_RATE } : undefined,
      })
    : new Muxer({
        target: new ArrayBufferTarget(),
        fastStart: 'in-memory',
        video: { codec: 'avc', width, height },
        audio: withAudio ? { codec: 'aac', numberOfChannels: 1, sampleRate: EXPORT_AUDIO_SAMPLE_RATE } : undefined,
      });

  // 3) Video and audio encoding overlap. Only video chunks produced before audio
  // capability settles are buffered; afterwards chunks stream straight to muxer.
  let muxer: any = null;
  let audioEncoded = false;
  let writeVideoChunk: ((chunk: any, meta: any) => void) | null = null;
  const pendingVideoChunks: Array<{ chunk: any; meta: any }> = [];
  const initializeMuxer = (encodedAudio: Awaited<typeof audioEncoding>): void => {
    if (muxer) return;
    audioEncoded = encodedAudio.mode === 'direct';
    muxer = createMuxer(audioEncoded);
    if (encodedAudio.mode === 'direct') {
      try {
        for (const buffered of encodedAudio.value) {
          if (isWebm) muxer.addAudioChunk(buffered.chunk, buffered.meta);
          else muxer.addAudioChunk(buffered.chunk, buffered.meta, buffered.timestamp);
        }
      } catch {
        audioEncoded = false;
        muxer = createMuxer(false);
      }
    }
    if (isWebm) writeVideoChunk = (chunk, meta) => muxer.addVideoChunk(chunk, meta);
    else writeVideoChunk = createMp4VideoChunkWriter(fps, muxer);
    for (const buffered of pendingVideoChunks) writeVideoChunk(buffered.chunk, buffered.meta);
    pendingVideoChunks.length = 0;
  };
  void audioEncoding.then(initializeMuxer).catch(() => undefined);

  let encErr: unknown = null;
  const videoEncoder = new VideoEncoderCtor({
    output: (chunk: any, meta: any) => {
      if (writeVideoChunk) writeVideoChunk(chunk, meta);
      else pendingVideoChunks.push({ chunk, meta });
    },
    error: (e: unknown) => { encErr = e; },
  });
  videoEncoder.configure(videoCfg);

  const frameDurUs = Math.round(1_000_000 / fps);
  const keyInterval = Math.max(1, fps * 2);
  const videoOffset = directAudio ? 0.05 : 0;
  const videoShare = 1 - videoOffset;
  try {
    for (let i = 0; i < totalFrames; i++) {
      checkAborted();
      if (encErr) throw encErr;
      const canvas = await renderFrame(i);
      checkAborted();
      const frame = new VideoFrameCtor(canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: frameDurUs,
      });
      try {
        const encodeOptions: any = { keyFrame: i % keyInterval === 0 };
        if (rateControl.bitrateMode === 'quantizer') {
          if (isWebm) encodeOptions.vp9 = { quantizer: rateControl.quantizer };
          else encodeOptions.avc = { quantizer: rateControl.quantizer };
        }
        videoEncoder.encode(frame, encodeOptions);
      } finally {
        frame.close();
      }
      await drainEncoderBackpressure(videoEncoder, 8, signal);
      if (encErr) throw encErr;
      if (!muxer && pendingVideoChunks.length >= 64) initializeMuxer(await audioEncoding);
      onProgress?.(videoOffset + ((i + 1) / totalFrames) * videoShare);
    }
    await drainEncoderBackpressure({ encodeQueueSize: 9, flush: () => videoEncoder.flush() }, 8, signal);
  } finally {
    try { videoEncoder.close(); } catch { /* codec may already be reclaimed */ }
  }
  if (encErr) throw encErr;

  initializeMuxer(await audioEncoding);

  muxer.finalize();
  const { buffer } = muxer.target as { buffer: ArrayBuffer };
  return {
    blob: new Blob([buffer], { type: isWebm ? 'video/webm' : 'video/mp4' }),
    audioEncoded,
  };
}

/**
 * 上传前把摄像头 webm 转成更小的代理（VP9 ~220kbps / ~15fps，保持原分辨率），
 * 仍输出 webm（同名 camera.webm，分享/播放零改动）。
 * 不支持/任何失败 → 抛错，调用方原样上传。
 */
export async function transcodeCameraForUpload(blob: Blob): Promise<Blob> {
  const VideoEncoderCtor = G.VideoEncoder;
  const VideoFrameCtor = G.VideoFrame;
  if (!VideoEncoderCtor || !VideoFrameCtor) throw new Error('videoencoder_unavailable');

  const source = await createCameraFrameSource(blob); // 解复用 + VideoDecoder（失败抛错）
  const width = source.width;
  const height = source.height;
  const targetFps = 15;
  const minGapUs = Math.round(1_000_000 / targetFps);

  const cfg: any = {
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: 220_000,
    framerate: targetFps,
  };
  const support = await VideoEncoderCtor.isConfigSupported(cfg);
  if (!support?.supported) { source.close(); throw new Error('vp9_encoder_unsupported'); }

  const muxer = new WebmMuxer({
    target: new WebmTarget(),
    video: { codec: 'V_VP9', width, height, frameRate: targetFps },
  });
  let encErr: unknown = null;
  const encoder = new VideoEncoderCtor({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: unknown) => { encErr = e; },
  });
  encoder.configure(cfg);

  try {
    let lastKeptUs = -Infinity;
    let lastKeyUs = -Infinity;
    let n = 0;
    const timestampNormalizer = new MonotonicTimestampNormalizer(minGapUs);
    for await (const frame of source.frames()) {
      if (encErr) throw encErr;
      const sourceTimestamp = frame.timestamp as number;
      const ts = timestampNormalizer.push(sourceTimestamp);
      // 抽帧到 ~15fps
      if (ts - lastKeptUs < minGapUs) { continue; }
      lastKeptUs = ts;
      const keyFrame = n === 0 || ts - lastKeyUs >= 2_000_000;
      if (keyFrame) lastKeyUs = ts;
      const normalizedFrame = ts === sourceTimestamp
        ? frame
        : new VideoFrameCtor(frame, { timestamp: ts, duration: minGapUs });
      try {
        encoder.encode(normalizedFrame, { keyFrame });
      } finally {
        if (normalizedFrame !== frame) normalizedFrame.close();
      }
      n++;
      await drainEncoderBackpressure(encoder, 8);
      if (encErr) throw encErr;
    }
    await encoder.flush();
    encoder.close();
    if (encErr) throw encErr;
    if (n === 0) throw new Error('camera_transcode_no_frames');
    muxer.finalize();
    const { buffer } = muxer.target as InstanceType<typeof WebmTarget>;
    return new Blob([buffer], { type: 'video/webm' });
  } finally {
    source.close();
  }
}

async function encodeAudioTrack(
  audio: PreparedExportAudio,
  audioCodec: string,
  AudioEncoderCtor: any,
  AudioDataCtor: any,
  muxer: any,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const sampleRate = audio.sampleRate;
  const channels = audio.channels;
  let err: unknown = null;
  const mp4AudioChunks = audioCodec === 'mp4a.40.2' ? createMp4AudioChunkBuffer(muxer) : null;
  const audioEncoder = new AudioEncoderCtor({
    output: (chunk: any, meta: any) => {
      if (mp4AudioChunks) mp4AudioChunks.push(chunk, meta);
      else muxer.addAudioChunk(chunk, meta);
    },
    error: (e: unknown) => { err = e; },
  });
  audioEncoder.configure({ codec: audioCodec, sampleRate, numberOfChannels: channels, bitrate: EXPORT_AUDIO_BITRATE });

  const total = audio.totalFrames;
  const block = 1024;
  const chData = [audio.samples];

  try {
    for (let off = 0; off < total; off += block) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (err) throw err;
      const n = Math.min(block, total - off);
      // AAC-LC 编码器要求输入按 1024 帧对齐。最后一块不足 1024 时用静音补齐，
      // 否则 WebCodecs 会拒绝非整数帧块或输出尾部错位，导致导出音频卡顿/回退。
      const planar = new Float32Array(block * channels);
      for (let c = 0; c < channels; c++) planar.set(chData[c].subarray(off, off + n), c * block);
      const ad = new AudioDataCtor({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: block,
        numberOfChannels: channels,
        timestamp: Math.round((off / sampleRate) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(ad);
      ad.close();
      await drainEncoderBackpressure(audioEncoder, 16, signal);
      if (err) throw err;
      if ((off / block) % 64 === 0) onProgress?.(off / total);
    }
    await drainEncoderBackpressure({ encodeQueueSize: 17, flush: () => audioEncoder.flush() }, 16, signal);
    mp4AudioChunks?.flush();
  } finally {
    try { audioEncoder.close(); } catch { /* codec may already be reclaimed */ }
  }
  if (err) throw err;
  onProgress?.(1);
}
