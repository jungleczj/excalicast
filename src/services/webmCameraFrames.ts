'use client';

import { ALL_FORMATS, BlobSource, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny';

export type MediaSourceInput = Blob | string;

/**
 * 极简 WebM(Matroska) 解复用 + WebCodecs VideoDecoder 流式出帧。
 *
 * 仅针对 MediaRecorder 产出的摄像头 webm（单视频轨 VP8/VP9、无 lacing）。
 * 用于导出时把摄像头气泡合成进画布（项2）与上传前转码（项5），避免引入 ffmpeg。
 *
 * 任何解析/解码失败都抛出，调用方据此回退（项2 → ffmpeg；项5 → 原样上传）。
 * WebCodecs 类型从 globalThis 取，避免对 lib.dom 版本的强依赖。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const G = globalThis as any;

// —— EBML 元素 ID ——
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_VIDEO = 0xe0;
const ID_PIXEL_WIDTH = 0xb0;
const ID_PIXEL_HEIGHT = 0xba;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE = 0xe7;
const ID_SIMPLEBLOCK = 0xa3;
const ID_BLOCKGROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_EBML_HEADER = 0x1a45dfa3;

interface FrameDesc { keyframe: boolean; timestampUs: number; data: Uint8Array; }
interface WebmParsed {
  codec: string;        // VideoDecoder codec string
  width: number;
  height: number;
  frames: FrameDesc[];  // 按时间排序
}

class Reader {
  pos = 0;
  constructor(public buf: Uint8Array, public view: DataView) {}
  eof(): boolean { return this.pos >= this.buf.length; }
  /** 读 EBML 元素 ID（保留前导标记，用于与已知 ID 比较）。 */
  readId(): number {
    const first = this.buf[this.pos];
    if (first === undefined) throw new Error('webm_eof_id');
    let len = 0;
    for (let m = 0x80; m > 0; m >>= 1) { len++; if (first & m) break; }
    if (len < 1 || len > 4) throw new Error('webm_bad_id_len');
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + this.buf[this.pos + i];
    this.pos += len;
    return id >>> 0;
  }
  /** 读 EBML 大小 VINT；返回 {size, unknown}。 */
  readSize(): { size: number; unknown: boolean } {
    const first = this.buf[this.pos];
    if (first === undefined) throw new Error('webm_eof_size');
    let len = 0, mask = 0;
    for (let m = 0x80; m > 0; m >>= 1) { len++; if (first & m) { mask = m; break; } }
    if (len < 1 || len > 8) throw new Error('webm_bad_size_len');
    let val = first & (mask - 1);
    let allOnes = (first & (mask - 1)) === (mask - 1);
    for (let i = 1; i < len; i++) {
      const b = this.buf[this.pos + i];
      val = val * 256 + b;
      if (b !== 0xff) allOnes = false;
    }
    this.pos += len;
    return { size: val, unknown: allOnes };
  }
  readUint(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.buf[this.pos + i];
    this.pos += n;
    return v;
  }
  readStr(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.buf[this.pos + i]);
    this.pos += n;
    return s.replace(/\0+$/, '');
  }
}

/** 在 SimpleBlock/Block body 内读 track number VINT（含值，去标记）。返回 {track, headerLen}。 */
function readBlockTrack(buf: Uint8Array, off: number): { track: number; headerLen: number } {
  const first = buf[off];
  let len = 0, mask = 0;
  for (let m = 0x80; m > 0; m >>= 1) { len++; if (first & m) { mask = m; break; } }
  let track = first & (mask - 1);
  for (let i = 1; i < len; i++) track = track * 256 + buf[off + i];
  return { track, headerLen: len };
}

function parseWebm(bytes: ArrayBuffer): WebmParsed {
  const buf = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const r = new Reader(buf, view);

  let timecodeScaleNs = 1_000_000; // 默认 1ms/tick
  let videoTrack = -1;
  let codecId = '';
  let width = 0, height = 0;
  const frames: FrameDesc[] = [];
  let clusterTc = 0;

  // 跳过 EBML header，进入 Segment body
  const id0 = r.readId();
  if (id0 === ID_EBML_HEADER) { const s = r.readSize(); if (!s.unknown) r.pos += s.size; }
  else r.pos = 0;
  // 找 Segment
  while (!r.eof()) {
    const id = r.readId();
    const s = r.readSize();
    if (id === ID_SEGMENT) break; // 进入 Segment body（不跳过）
    if (!s.unknown) r.pos += s.size; else break;
  }

  // 扁平扫描 Segment 体：Info/Tracks 下钻；Cluster 视作 header（不跳 body），
  // 其后的 Timecode/SimpleBlock 直接在同一层被读到。
  const descend = (endPos: number, handler: (id: number, size: number, bodyStart: number) => void) => {
    while (r.pos < endPos && !r.eof()) {
      const id = r.readId();
      const s = r.readSize();
      const bodyStart = r.pos;
      handler(id, s.unknown ? -1 : s.size, bodyStart);
      if (s.unknown) break;
      r.pos = bodyStart + s.size;
    }
  };

  let guard = 0;
  while (!r.eof()) {
    if (++guard > 5_000_000) throw new Error('webm_scan_overrun');
    const id = r.readId();
    const s = r.readSize();
    const bodyStart = r.pos;

    if (id === ID_INFO && !s.unknown) {
      const end = bodyStart + s.size;
      descend(end, (cid, csz, cbody) => {
        if (cid === ID_TIMECODE_SCALE && csz > 0) { r.pos = cbody; timecodeScaleNs = r.readUint(csz); }
      });
      r.pos = end;
    } else if (id === ID_TRACKS && !s.unknown) {
      const end = bodyStart + s.size;
      descend(end, (cid, csz, cbody) => {
        if (cid === ID_TRACK_ENTRY && csz > 0) {
          const teEnd = cbody + csz;
          let tnum = -1, ttype = -1, ccodec = '', w = 0, h = 0;
          // 解析 TrackEntry
          while (r.pos < teEnd) {
            const eid = r.readId(); const es = r.readSize(); const eb = r.pos;
            if (es.unknown) break;
            if (eid === ID_TRACK_NUMBER) { r.pos = eb; tnum = r.readUint(es.size); }
            else if (eid === ID_TRACK_TYPE) { r.pos = eb; ttype = r.readUint(es.size); }
            else if (eid === ID_CODEC_ID) { r.pos = eb; ccodec = r.readStr(es.size); }
            else if (eid === ID_VIDEO) {
              const vend = eb + es.size;
              while (r.pos < vend) {
                const vid = r.readId(); const vs = r.readSize(); const vb = r.pos;
                if (vs.unknown) break;
                if (vid === ID_PIXEL_WIDTH) { r.pos = vb; w = r.readUint(vs.size); }
                else if (vid === ID_PIXEL_HEIGHT) { r.pos = vb; h = r.readUint(vs.size); }
                r.pos = vb + vs.size;
              }
            }
            r.pos = eb + es.size;
          }
          if (ttype === 1 && videoTrack === -1) { // video
            videoTrack = tnum; codecId = ccodec; width = w; height = h;
          }
        }
      });
      r.pos = end;
    } else if (id === ID_CLUSTER) {
      clusterTc = 0; // 进入 cluster body（不跳过 body）
      // pos 已在 body 起点，继续外层扫描读取其 Timecode/SimpleBlock
    } else if (id === ID_TIMECODE && !s.unknown) {
      r.pos = bodyStart; clusterTc = r.readUint(s.size); r.pos = bodyStart + s.size;
    } else if (id === ID_SIMPLEBLOCK && !s.unknown) {
      const { track, headerLen } = readBlockTrack(buf, bodyStart);
      if (track === videoTrack) {
        const relTc = view.getInt16(bodyStart + headerLen, false);
        const flags = buf[bodyStart + headerLen + 2];
        const lacing = flags & 0x06;
        if (lacing !== 0) throw new Error('webm_lacing_unsupported');
        const keyframe = (flags & 0x80) !== 0;
        const dataStart = bodyStart + headerLen + 3;
        const data = buf.subarray(dataStart, bodyStart + s.size);
        const tick = clusterTc + relTc;
        frames.push({ keyframe, timestampUs: Math.round((tick * timecodeScaleNs) / 1000), data });
      }
      r.pos = bodyStart + s.size;
    } else if (id === ID_BLOCKGROUP && !s.unknown) {
      const end = bodyStart + s.size;
      // BlockGroup → Block（无 keyframe 标记，按 delta；MediaRecorder 少见）
      while (r.pos < end) {
        const bid = r.readId(); const bs = r.readSize(); const bb = r.pos;
        if (bs.unknown) break;
        if (bid === ID_BLOCK) {
          const { track, headerLen } = readBlockTrack(buf, bb);
          if (track === videoTrack) {
            const relTc = view.getInt16(bb + headerLen, false);
            const data = buf.subarray(bb + headerLen + 3, bb + bs.size);
            const tick = clusterTc + relTc;
            frames.push({ keyframe: frames.length === 0, timestampUs: Math.round((tick * timecodeScaleNs) / 1000), data });
          }
        }
        r.pos = bb + bs.size;
      }
      r.pos = end;
    } else {
      // 其它元素：定长跳过；未知长度直接停止（无法安全续读）
      if (s.unknown) break;
      r.pos = bodyStart + s.size;
    }
  }

  if (videoTrack === -1 || frames.length === 0) throw new Error('webm_no_video_frames');
  if (!frames[0].keyframe) frames[0].keyframe = true; // 容错：首帧当关键帧
  const codec = /VP9/i.test(codecId) ? 'vp09.00.10.08' : 'vp8';
  return { codec, width: width || 360, height: height || 360, frames };
}

export interface CameraFrameSource {
  width: number;
  height: number;
  decoderPath: 'mediabunny-stream' | 'legacy-array-buffer';
  /** 返回 ≤ tMs 的最近一帧（VideoFrame），调用方用完不要 close（由 source 管理）。 */
  getFrameAt(tMs: number): Promise<any | null>;
  /** 顺序遍历所有解码帧（项5 转码用），yield 后该帧会被关闭。 */
  frames(): AsyncGenerator<any>;
  getDecodedFrameCount(): number;
  close(): void;
}

/**
 * 创建摄像头帧源（解复用 + VideoDecoder 流式解码）。不支持/失败抛错。
 */
async function createLegacyCameraFrameSource(blob: Blob): Promise<CameraFrameSource> {
  const VideoDecoderCtor = G.VideoDecoder;
  const EncodedVideoChunkCtor = G.EncodedVideoChunk;
  if (!VideoDecoderCtor || !EncodedVideoChunkCtor) throw new Error('videodecoder_unavailable');

  const parsed = parseWebm(await blob.arrayBuffer());
  const cfg = { codec: parsed.codec, codedWidth: parsed.width, codedHeight: parsed.height };
  const support = await VideoDecoderCtor.isConfigSupported(cfg);
  if (!support?.supported) throw new Error(`videodecoder_config_unsupported_${parsed.codec}`);

  const queue: any[] = []; // 已解码、按时间递增的 VideoFrame
  let decodedFrameCount = 0;
  let decodeErr: unknown = null;
  const decoder = new VideoDecoderCtor({
    output: (frame: any) => {
      decodedFrameCount += 1;
      queue.push(frame);
    },
    error: (e: unknown) => { decodeErr = e; },
  });
  decoder.configure(cfg);

  let fed = 0;
  const feedNext = () => {
    if (fed >= parsed.frames.length) return false;
    const f = parsed.frames[fed++];
    decoder.decode(new EncodedVideoChunkCtor({
      type: f.keyframe ? 'key' : 'delta',
      timestamp: f.timestampUs,
      data: f.data,
    }));
    return true;
  };

  const yieldTick = () => new Promise((r) => setTimeout(r, 0));

  // 维护 getFrameAt 用的"当前帧"
  let current: any | null = null;

  const advanceTo = async (tUs: number): Promise<void> => {
    // 解码直到队列里出现 ts > tUs 的帧，或喂完并 flush
    while (!decodeErr) {
      // 把队列中 ts<=tUs 的帧推进 current（关闭被替换的旧帧）
      while (queue.length > 0 && queue[0].timestamp <= tUs) {
        if (current) { try { current.close(); } catch { /* */ } }
        current = queue.shift();
      }
      // MediaRecorder may timestamp its first encoded frame a few milliseconds
      // after zero. Previewing t=0 should still show that first frame.
      if (!current && queue.length > 0) current = queue.shift();
      if (queue.length > 0) return; // 已有 > tUs 的帧，current 即 ≤ tUs 最近帧
      if (fed >= parsed.frames.length) { await decoder.flush().catch(() => {});
        while (queue.length > 0 && queue[0].timestamp <= tUs) { if (current) { try { current.close(); } catch {} } current = queue.shift(); }
        return;
      }
      // 控制 decode 队列深度，喂一批
      let budget = 4;
      while (budget-- > 0 && decoder.decodeQueueSize < 4 && feedNext()) { /* feed */ }
      await yieldTick();
    }
    if (decodeErr) throw decodeErr;
  };

  return {
    width: parsed.width,
    height: parsed.height,
    decoderPath: 'legacy-array-buffer',
    async getFrameAt(tMs: number) {
      await advanceTo(Math.round(tMs * 1000));
      if (decodeErr) throw decodeErr;
      return current;
    },
    async *frames() {
      while (true) {
        if (decodeErr) throw decodeErr;
        if (queue.length > 0) {
          const fr = queue.shift();
          yield fr;                      // 消费者在 encode 后恢复，再关闭
          try { fr.close(); } catch { /* */ }
          continue;
        }
        if (fed < parsed.frames.length) {
          let budget = 4;
          while (budget-- > 0 && decoder.decodeQueueSize < 4 && feedNext()) { /* feed */ }
          await yieldTick();
          continue;
        }
        await decoder.flush().catch(() => {});
        if (queue.length === 0) break;   // 喂完且 flush 完，无剩余
      }
      if (decodeErr) throw decodeErr;
    },
    getDecodedFrameCount() { return decodedFrameCount; },
    close() {
      try { if (current) current.close(); } catch { /* */ }
      for (const f of queue) { try { f.close(); } catch { /* */ } }
      queue.length = 0;
      try { decoder.close(); } catch { /* */ }
    },
  };
}

async function createMediabunnyFrameSource(source: MediaSourceInput): Promise<CameraFrameSource> {
  const input = new Input({
    source: typeof source === 'string'
      ? new UrlSource(source)
      : new BlobSource(source, { maxCacheSize: 8 * 1024 * 1024, useStreamReader: true }),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    throw new Error('webm_no_video_track');
  }

  const [width, height] = await Promise.all([
    track.getDisplayWidth(),
    track.getDisplayHeight(),
  ]);
  const sink = new VideoSampleSink(track);
  let iterator: AsyncIterator<VideoSample> | null = null;
  let pendingSample: VideoSample | null = null;
  let current: VideoFrame | null = null;
  let ended = false;
  let closed = false;
  let mode: 'timed' | 'iterate' | null = null;
  let decodedFrameCount = 0;

  const advanceTo = async (tMs: number) => {
    if (mode === 'iterate') throw new Error('frame_source_mode_conflict');
    mode = 'timed';
    iterator ??= sink.samples()[Symbol.asyncIterator]();
    while (!closed && !ended) {
      if (!pendingSample) {
        const next = await iterator.next();
        if (next.done) {
          ended = true;
          return;
        }
        pendingSample = next.value;
      }
      if (pendingSample.timestamp * 1000 > tMs && current) return;
      const nextFrame = pendingSample.toVideoFrame();
      pendingSample.close();
      pendingSample = null;
      current?.close();
      current = nextFrame;
      decodedFrameCount += 1;
    }
  };

  return {
    width,
    height,
    decoderPath: 'mediabunny-stream',
    async getFrameAt(tMs: number) {
      await advanceTo(tMs);
      return current;
    },
    async *frames() {
      if (mode === 'timed') throw new Error('frame_source_mode_conflict');
      mode = 'iterate';
      for await (const sample of sink.samples()) {
        if (closed) break;
        const frame = sample.toVideoFrame();
        sample.close();
        decodedFrameCount += 1;
        try {
          yield frame;
        } finally {
          frame.close();
        }
      }
    },
    getDecodedFrameCount() { return decodedFrameCount; },
    close() {
      if (closed) return;
      closed = true;
      current?.close();
      current = null;
      pendingSample?.close();
      pendingSample = null;
      void iterator?.return?.();
      input.dispose();
    },
  };
}

/**
 * Lazy Blob-backed demux/decode is the primary path. The legacy parser remains
 * as a compatibility fallback for unusual MediaRecorder WebM variants.
 */
export async function createCameraFrameSource(source: MediaSourceInput): Promise<CameraFrameSource> {
  try {
    return await createMediabunnyFrameSource(source);
  } catch {
    if (typeof source === 'string') throw new Error('url_camera_decode_failed');
    return createLegacyCameraFrameSource(source);
  }
}
