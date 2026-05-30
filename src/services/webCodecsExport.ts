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
import { createCameraFrameSource } from './webmCameraFrames';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface EncodeParams {
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  audioBlob: Blob | null;
  renderFrame: (i: number) => Promise<HTMLCanvasElement>;
  onProgress?: (p: number) => void; // 0..1
}

const G = globalThis as any;

function avcCodecString(width: number, height: number): string {
  // Main profile（4d00）；按分辨率挑 level：≤1080p → 4.1(0x29)，更大 → 5.1(0x33)
  const level = width * height > 1920 * 1080 ? '33' : '29';
  return `avc1.4d00${level}`;
}

function estimateBitrate(width: number, height: number, fps: number): number {
  return Math.min(12_000_000, Math.max(1_500_000, Math.round(width * height * fps * 0.1)));
}

export async function encodeWebCodecsMp4(params: EncodeParams): Promise<Blob> {
  const { totalFrames, fps, width, height, audioBlob, renderFrame, onProgress } = params;
  const VideoEncoderCtor = G.VideoEncoder;
  const AudioEncoderCtor = G.AudioEncoder;
  const VideoFrameCtor = G.VideoFrame;
  const AudioDataCtor = G.AudioData;
  if (!VideoEncoderCtor || !VideoFrameCtor) throw new Error('webcodecs_unavailable');

  // 1) 先解码音频（拿到声道/采样率以配置 muxer）
  let audio: { buffer: AudioBuffer; channels: number; sampleRate: number } | null = null;
  if (audioBlob) {
    try {
      const AC = G.AudioContext || G.webkitAudioContext;
      const ctx = new AC();
      const decoded: AudioBuffer = await ctx.decodeAudioData(await audioBlob.arrayBuffer());
      audio = { buffer: decoded, channels: Math.min(2, decoded.numberOfChannels), sampleRate: decoded.sampleRate };
      await ctx.close();
    } catch {
      audio = null; // 音频解码失败 → 导出无声视频
    }
  }

  // 2) 校验视频编码器配置（先试硬件，不支持再试默认）
  const baseCfg: any = {
    codec: avcCodecString(width, height),
    width,
    height,
    bitrate: estimateBitrate(width, height, fps),
    framerate: fps,
    avc: { format: 'avc' },
  };
  let videoCfg: any = { ...baseCfg, hardwareAcceleration: 'prefer-hardware' };
  let support = await VideoEncoderCtor.isConfigSupported(videoCfg);
  if (!support?.supported) {
    videoCfg = { ...baseCfg };
    support = await VideoEncoderCtor.isConfigSupported(videoCfg);
    if (!support?.supported) throw new Error('video_encoder_config_unsupported');
  }

  const canAudio = !!audio && !!AudioEncoderCtor && !!AudioDataCtor;

  // 3) muxer
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    fastStart: 'in-memory',
    video: { codec: 'avc', width, height },
    audio: canAudio
      ? { codec: 'aac', numberOfChannels: audio!.channels, sampleRate: audio!.sampleRate }
      : undefined,
  });

  // 4) 视频编码
  let encErr: unknown = null;
  const videoEncoder = new VideoEncoderCtor({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: unknown) => { encErr = e; },
  });
  videoEncoder.configure(videoCfg);

  const frameDurUs = Math.round(1_000_000 / fps);
  const keyInterval = Math.max(1, fps * 2);
  const videoShare = canAudio ? 0.85 : 1;
  for (let i = 0; i < totalFrames; i++) {
    if (encErr) throw encErr;
    const canvas = await renderFrame(i);
    const frame = new VideoFrameCtor(canvas, {
      timestamp: Math.round((i * 1_000_000) / fps),
      duration: frameDurUs,
    });
    videoEncoder.encode(frame, { keyFrame: i % keyInterval === 0 });
    frame.close();
    // 背压：编码队列过长时让出主线程，避免内存堆积
    while (videoEncoder.encodeQueueSize > 8) {
      await new Promise((r) => setTimeout(r, 0));
      if (encErr) throw encErr;
    }
    onProgress?.(((i + 1) / totalFrames) * videoShare);
  }
  await videoEncoder.flush();
  videoEncoder.close();
  if (encErr) throw encErr;

  // 5) 音频编码（AAC）
  if (canAudio) {
    await encodeAudioTrack(audio!.buffer, audio!.channels, AudioEncoderCtor, AudioDataCtor, muxer,
      (p) => onProgress?.(0.85 + p * 0.15));
  }

  muxer.finalize();
  const { buffer } = muxer.target as ArrayBufferTarget;
  return new Blob([buffer], { type: 'video/mp4' });
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
    for await (const frame of source.frames()) {
      if (encErr) throw encErr;
      const ts = frame.timestamp as number;
      // 抽帧到 ~15fps
      if (ts - lastKeptUs < minGapUs) { continue; }
      lastKeptUs = ts;
      const keyFrame = n === 0 || ts - lastKeyUs >= 2_000_000;
      if (keyFrame) lastKeyUs = ts;
      encoder.encode(frame, { keyFrame });
      n++;
      while (encoder.encodeQueueSize > 8) { await new Promise((r) => setTimeout(r, 0)); if (encErr) throw encErr; }
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
  buffer: AudioBuffer,
  channels: number,
  AudioEncoderCtor: any,
  AudioDataCtor: any,
  muxer: Muxer<ArrayBufferTarget>,
  onProgress?: (p: number) => void,
): Promise<void> {
  const sampleRate = buffer.sampleRate;
  let err: unknown = null;
  const audioEncoder = new AudioEncoderCtor({
    output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
    error: (e: unknown) => { err = e; },
  });
  audioEncoder.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128_000 });

  const total = buffer.length;
  const block = 1024;
  const chData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chData.push(buffer.getChannelData(c));

  for (let off = 0; off < total; off += block) {
    if (err) throw err;
    const n = Math.min(block, total - off);
    // f32-planar：各声道顺序排布
    const planar = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) planar.set(chData[c].subarray(off, off + n), c * n);
    const ad = new AudioDataCtor({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: channels,
      timestamp: Math.round((off / sampleRate) * 1_000_000),
      data: planar,
    });
    audioEncoder.encode(ad);
    ad.close();
    if ((off / block) % 64 === 0) onProgress?.(off / total);
  }
  await audioEncoder.flush();
  audioEncoder.close();
  if (err) throw err;
  onProgress?.(1);
}
