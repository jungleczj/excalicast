'use client';

import { v4 as uuidv4 } from 'uuid';
import { bulkAddLaserEvents, getClientDb } from '@/lib/db-client';
import { getCurrentOwnerKey } from '@/lib/ownerKey';
import { startAudioRecorder, type AudioRecorderHandle } from '@/services/audioRecorder';
import { startCameraRecorder, type CameraHandle } from '@/services/cameraRecorder';
import { startDisplayCaptureRecorder, type DisplayCaptureHandle } from '@/services/displayCaptureRecorder';
import { collectRecorderWarnings, type RecorderTrackKind } from '@/services/mediaRecorderHealth';
import { ShellCapturer } from '@/services/workspaceShellCapture';
import { captureCameraPlacement } from '@/services/cameraPlacement';
import type { LaserEvent, RecordingMetadata, RecordingSetupConfig } from '@/types/recording';

/** 裁切框 viewport 矩形（viewport 像素）。摄像头位置/尺寸相对它归一。 */
export interface CameraFrameRect { x: number; y: number; w: number; h: number; }

export interface SessionHandle {
  recordingId: string;
  startedAt: number;
  hasAudio: boolean;
  setup?: RecordingSetupConfig;
  /**
   * getter：随时反映"摄像头是否已经 acquire 过"。可能从 false 升到 true（录制中调用
   * enableCamera()），但 acquire 之后不会回到 false —— 后续的 mute 走 cameraMuted。
   */
  readonly hasCamera: boolean;
  /** getter：mute 期间为 null，unmute 后是新 stream。每次访问拿最新值。 */
  readonly cameraStream: MediaStream | null;
  onWhiteboardChange: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
  ) => void;
  /**
   * 等待当前已经收到的白板快照全部写入本地库。
   *
   * 开始录制时用它确认 t=0 白板已持久化；停止录制时再调用一次，避免导出页
   * 在 IndexedDB 写入尚未结束时读取到空快照、只显示视频背景。
   */
  flushWhiteboardSnapshots: () => Promise<void>;
  /**
   * 记录摄像头气泡的位置变化（viewport 像素），节流后存到 cameraPositions 表。
   *  - xPx/yPx：气泡左上角（viewport）。sizePx：气泡边长。
   *  - frame：裁切框 viewport 矩形（固定比例时传入）→ 位置/尺寸相对裁切框存
   *    （rs 按较短边），使导出与录制所见一致；不传（default 整画板）则相对 shell。
   */
  recordCameraMove: (xPx: number, yPx: number, sizePx: number, frame?: CameraFrameRect | null) => void;
  /**
   * 软静音 / 取消静音麦克风。track.enabled toggle —— MediaRecorder 不停，
   * 静音区间录的是无声段，回放 / 导出都是静音。
   */
  setAudioMuted: (muted: boolean) => void;
  /**
   * 硬关 / 重新打开摄像头：mute 时真正 track.stop() + 停 MediaRecorder（LED 灭，
   * 硬件释放）；unmute 时重新 getUserMedia + 起新 MediaRecorder 续录。同时写一条
   * hidden 标记的 cameraPositions 事件，回放/导出 pipeline 按它跳过气泡渲染。
   *
   * 返回 Promise —— 内部 acquire/release 是异步的，上层等它完成再拿新 stream。
   */
  setCameraMuted: (muted: boolean) => Promise<void>;
  /**
   * 录制中懒激活摄像头：用户开始录制时没勾 camera，录制中点 RecordingBar 的 camera
   * 按钮触发本方法。
   *  - 已经 acquire 过：no-op，return false
   *  - 否则 startCameraRecorder + DB hasCamera=true + 写一条 hidden=false cameraPositions
   *    锚点（位置取当前 lastFlushedMove 或右下角 fallback），return true
   * 失败抛错（用户拒权限等），由上层 alert。
   */
  enableCamera: () => Promise<boolean>;
  /**
   * 记录激光笔轨迹事件。Whiteboard 的 onPointerUpdate 在 tool==='laser' 时调用。
   *  - 坐标是 scene 坐标（Excalidraw onPointerUpdate.pointer.x/y）
   *  - button: 'down'（按住绘制中）/ 'up'（松手）
   * 内部 25ms batch flush 写入 db.laserEvents；paused 时跳过；stop 之前 flush。
   */
  recordLaserPoint: (x: number, y: number, button: 'down' | 'up') => void;
  pause: () => void;
  resume: () => void;
  stop: (status?: 'done' | 'interrupted') => Promise<RecordingMetadata>;
  getElapsedMs: () => number;
}

export interface StartOptions {
  withCamera: boolean;
  workspaceRoot?: HTMLElement | null;
  /** 录制前 Setup 面板锁定的配置；写进 recording，导出默认沿用。 */
  setup?: RecordingSetupConfig;
  /** 取景阶段已采集的麦克风流；复用以避免倒计时后才申请权限。 */
  audioStream?: MediaStream | null;
  /** 取景阶段已采集的摄像头流；复用以避免倒计时后才唤醒设备。 */
  cameraStream?: MediaStream | null;
  /** 取景阶段已采集的显示源流；复用以避免倒计时后才申请权限。 */
  displayStream?: MediaStream | null;
}

const SNAPSHOT_THROTTLE_MS = 50;
const CAMERA_POS_THROTTLE_MS = 80;

export async function startRecording(opts: StartOptions): Promise<SessionHandle> {
  const recordingId = uuidv4();
  const startedAt = Date.now();
  const db = getClientDb();
  const ownerKey = await getCurrentOwnerKey();

  await db.recordings.put({
    id: recordingId,
    startedAt,
    durationMs: 0,
    hasAudio: false,
    hasCamera: false,
    status: 'recording',
    ownerKey,
    source: opts.setup?.source ?? { kind: 'whiteboard' },
    ...(opts.setup ? { setup: opts.setup } : {}),
  });

  let audio: AudioRecorderHandle | null = null;
  try { audio = await startAudioRecorder(recordingId, opts.audioStream); } catch { audio = null; }
  const hasAudio = audio !== null;
  if (audio) {
    await db.recordings.update(recordingId, {
      hasAudio: true,
      audioSourceInfo: audio.sourceInfo,
    });
  }

  let camera: CameraHandle | null = null;
  if (opts.withCamera) {
    try { camera = await startCameraRecorder(recordingId, opts.cameraStream); } catch { camera = null; }
  }
  if (camera) await db.recordings.update(recordingId, { hasCamera: true });

  const source = opts.setup?.source ?? { kind: 'whiteboard' };
  let display: DisplayCaptureHandle | null = null;
  if (source.kind !== 'whiteboard' && opts.displayStream) {
    display = await startDisplayCaptureRecorder(recordingId, source, opts.displayStream);
    await db.recordings.update(recordingId, { source });
  }

  const writtenFileIds = new Set<string>();
  let lastSnapshotAt = -Infinity;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: { elements: unknown[]; appState: Record<string, unknown>; t: number } | null = null;
  // onChange 是同步回调，但 IndexedDB 写入是异步的。所有快照写入走同一条队列，
  // 防止快速开始/停止时 stop() 错过正在进行中的首帧写入。
  let snapshotFlushChain: Promise<void> = Promise.resolve();
  let paused = false;
  let pauseStartedAt = 0;
  let pausedTotal = 0;

  // 工作区 UI 快照采集器（best-effort，失败不影响录制）
  let shellCapturer: ShellCapturer | null = null;
  // Capturing the whole Excalidraw workspace at 2x resolution is expensive and
  // can keep the main thread busy while the editor route is trying to mount.
  // Only start it for recordings whose final composition explicitly includes
  // the application shell.
  if (opts.workspaceRoot && opts.setup?.includeWorkspaceShell) {
    shellCapturer = new ShellCapturer({
      recordingId,
      rootEl: opts.workspaceRoot,
      getElapsedMs: () => elapsed(),
      isPaused: () => paused,
    });
    // 延迟到 next tick 启动，等 UI 状态（AppHeader / RecordingBar）切换稳定
    setTimeout(() => shellCapturer?.start(), 200);
  }

  const flushSnapshot = async () => {
    if (!pendingSnapshot) return;
    const snap = pendingSnapshot;
    pendingSnapshot = null;
    pendingTimer = null;
    lastSnapshotAt = snap.t;
    await db.snapshots.add({
      recordingId,
      timestamp: snap.t,
      elements: snap.elements,
      appState: snap.appState,
    });
  };

  const enqueueSnapshotFlush = (): Promise<void> => {
    const next = snapshotFlushChain.catch(() => undefined).then(flushSnapshot);
    snapshotFlushChain = next;
    return next;
  };

  const drainWhiteboardSnapshots = async (): Promise<void> => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    // 即使 pendingSnapshot 已被前一次 flushSnapshot 取走，也要等待它真正写入完成。
    await snapshotFlushChain;
    if (pendingSnapshot) await enqueueSnapshotFlush();
  };

  // 摄像头气泡位置事件：节流写入 cameraPositions 表
  let lastCameraEventAt = -Infinity;
  let pendingCameraMove: { x: number; y: number; s: number; frame?: CameraFrameRect | null } | null = null;
  let lastFlushedMove: { x: number; y: number; s: number; frame?: CameraFrameRect | null } | null = null;
  let cameraMoveTimer: ReturnType<typeof setTimeout> | null = null;

  const normalizeCameraMove = (
    move: { x: number; y: number; s: number; frame?: CameraFrameRect | null },
    rootRect: DOMRect,
  ): { rx: number; ry: number; rs: number; placement: ReturnType<typeof captureCameraPlacement> } => {
    if (move.frame && move.frame.w > 0 && move.frame.h > 0) {
      return {
        rx: (move.x - move.frame.x) / move.frame.w,
        ry: (move.y - move.frame.y) / move.frame.h,
        rs: move.s / Math.min(move.frame.w, move.frame.h),
        placement: captureCameraPlacement({
          contentRect: { x: move.frame.x, y: move.frame.y, width: move.frame.w, height: move.frame.h },
          bubbleRect: { x: move.x, y: move.y, width: move.s, height: move.s },
        }),
      };
    }
    return {
      rx: (move.x - rootRect.left) / rootRect.width,
      ry: (move.y - rootRect.top) / rootRect.height,
      rs: move.s / Math.min(rootRect.width, rootRect.height),
      placement: captureCameraPlacement({
        contentRect: { x: rootRect.left, y: rootRect.top, width: rootRect.width, height: rootRect.height },
        bubbleRect: { x: move.x, y: move.y, width: move.s, height: move.s },
      }),
    };
  };

  const flushCameraMove = async () => {
    cameraMoveTimer = null;
    const move = pendingCameraMove;
    pendingCameraMove = null;
    if (!move) return;
    const root = opts.workspaceRoot;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const t = elapsed();
    lastCameraEventAt = t;
    const normalized = normalizeCameraMove(move, rect);
    await db.cameraPositions.add({ recordingId, timestamp: Math.max(0, t), ...normalized });
    lastFlushedMove = move;
  };

  // 激光笔事件：batch 25ms flush 写入 laserEvents 表
  let pendingLaserEvents: LaserEvent[] = [];
  let laserFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const LASER_FLUSH_MS = 25;

  const flushLaserEvents = async () => {
    laserFlushTimer = null;
    if (pendingLaserEvents.length === 0) return;
    const batch = pendingLaserEvents;
    pendingLaserEvents = [];
    try {
      await bulkAddLaserEvents(batch);
    } catch { /* ignore：丢一批可以接受 */ }
  };

  const elapsed = () => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pauseStartedAt : 0);

  return {
    recordingId,
    startedAt,
    hasAudio,
    setup: opts.setup,
    get hasCamera() { return camera !== null; },
    get cameraStream() { return camera?.stream ?? null; },
    getElapsedMs: elapsed,
    onWhiteboardChange(elements, appState, files) {
      if (paused) return;
      const t = elapsed();

      if (files && typeof files === 'object') {
        for (const [fileId, data] of Object.entries(files)) {
          if (writtenFileIds.has(fileId)) continue;
          writtenFileIds.add(fileId);
          db.binaryFiles.add({ recordingId, fileId, data }).catch(() => { /* ignore */ });
        }
      }

      pendingSnapshot = {
        t,
        elements: structuredClone(elements as unknown[]),
        appState: structuredClone(appState),
      };
      // 通知 shell capturer：appState 关键字段变化时按需重抓快照
      shellCapturer?.onAppStateChange(appState);

      if (t - lastSnapshotAt < SNAPSHOT_THROTTLE_MS) {
        if (pendingTimer === null) {
          pendingTimer = setTimeout(() => { void enqueueSnapshotFlush().catch(() => {}); }, SNAPSHOT_THROTTLE_MS);
        }
        return;
      }
      void enqueueSnapshotFlush().catch(() => {});
    },
    flushWhiteboardSnapshots: drainWhiteboardSnapshots,
    recordCameraMove(xPx, yPx, sizePx, frame) {
      if (paused) return;
      pendingCameraMove = { x: xPx, y: yPx, s: sizePx, frame: frame ?? null };
      const t = elapsed();
      if (t - lastCameraEventAt >= CAMERA_POS_THROTTLE_MS) {
        if (cameraMoveTimer !== null) {
          clearTimeout(cameraMoveTimer);
          cameraMoveTimer = null;
        }
        void flushCameraMove();
      } else if (cameraMoveTimer === null) {
        cameraMoveTimer = setTimeout(() => { void flushCameraMove(); }, CAMERA_POS_THROTTLE_MS);
      }
    },
    recordLaserPoint(x, y, button) {
      if (paused) return;
      pendingLaserEvents.push({
        recordingId,
        timestamp: Math.max(0, elapsed()),
        x, y, button,
      });
      if (laserFlushTimer === null) {
        laserFlushTimer = setTimeout(() => { void flushLaserEvents(); }, LASER_FLUSH_MS);
      }
    },
    setAudioMuted(muted) {
      // 软静音：MediaRecorder 不停，让 track.enabled = false 即可让录到的音频静默。
      if (audio?.stream) {
        for (const t of audio.stream.getAudioTracks()) t.enabled = !muted;
      }
    },
    async enableCamera() {
      // 已经 acquire 过：不重新申请权限，让上层走 setCameraMuted(false) 流程
      if (camera !== null) return false;
      // 第一次 acquire：失败抛错（拒权限 / 没有摄像头），上层 alert
      camera = await startCameraRecorder(recordingId);
      await db.recordings.update(recordingId, { hasCamera: true });
      // 写一条 hidden=false 锚点。位置：优先用 lastFlushedMove，否则右下角 fallback。
      if (!paused) {
        const root = opts.workspaceRoot;
        if (root) {
          const rect = root.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const last = pendingCameraMove ?? lastFlushedMove;
            let normalized: ReturnType<typeof normalizeCameraMove>;
            if (last) {
              normalized = normalizeCameraMove(last, rect);
            } else {
              // 默认右下角，160px 直径（相对 shell 较短边）
              normalized = normalizeCameraMove({
                x: rect.right - 180,
                y: rect.bottom - 180,
                s: 160,
              }, rect);
            }
            const t = elapsed();
            await db.cameraPositions.add({
              recordingId,
              timestamp: Math.max(0, t),
              ...normalized,
              hidden: false,
            });
            lastCameraEventAt = t;
          }
        }
      }
      return true;
    },
    async setCameraMuted(muted) {
      // 1) 真正动硬件：mute → release（LED 灭）；unmute → 重新 acquire。
      try { await camera?.setMuted(muted); } catch { /* 硬件失败时静默：UI 仍会反映 mute 状态 */ }
      // 2) 写 hidden 标记，让回放/导出在该段时间不画气泡（即便 mute 之前残留位置事件）
      if (paused) return;
      const root = opts.workspaceRoot;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const t = elapsed();
      const last = pendingCameraMove ?? lastFlushedMove;
      const normalized = last ? normalizeCameraMove(last, rect) : { rx: 0, ry: 0, rs: 0 };
      await db.cameraPositions.add({
        recordingId,
        timestamp: Math.max(0, t),
        ...normalized,
        hidden: muted,
      });
      lastCameraEventAt = t;
    },
    pause() {
      if (paused) return;
      paused = true;
      pauseStartedAt = Date.now();
      audio?.pause();
      camera?.pause();
      display?.pause();
    },
    resume() {
      if (!paused) return;
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
      audio?.resume();
      camera?.resume();
      display?.resume();
    },
    async stop(finalStatus = 'done') {
      if (paused) {
        pausedTotal += Date.now() - pauseStartedAt;
        paused = false;
      }
      const durationMs = Date.now() - startedAt - pausedTotal;
      // Call every MediaRecorder.stop() before the first await. The detached
      // controller may close immediately after this method returns its promise;
      // delaying stop behind IndexedDB work can otherwise lose the final chunk.
      const activeRecorders: Array<{ track: RecorderTrackKind; stop: () => Promise<void> }> = [];
      if (audio) activeRecorders.push({ track: 'audio', stop: audio.stop });
      if (camera) activeRecorders.push({ track: 'camera', stop: camera.stop });
      if (display) activeRecorders.push({ track: 'screen', stop: display.stop });
      const mediaFinalization = Promise.allSettled(activeRecorders.map((entry) => entry.stop()));
      await db.recordings.update(recordingId, {
        durationMs,
        status: 'finalizing',
      });
      await drainWhiteboardSnapshots();
      if (cameraMoveTimer !== null) {
        clearTimeout(cameraMoveTimer);
        cameraMoveTimer = null;
      }
      // 把 pending move 落盘，保证最后一次拖拽的落点不丢
      if (pendingCameraMove) {
        await flushCameraMove();
      }
      if (laserFlushTimer !== null) {
        clearTimeout(laserFlushTimer);
        laserFlushTimer = null;
      }
      if (pendingLaserEvents.length > 0) {
        await flushLaserEvents();
      }
      shellCapturer?.stop();
      // MediaRecorder 最后一帧/最后一个音频分片的收尾可能分别等待编码器回调。
      // 三路互不依赖，串行等待会把停止到导出页的延迟累加；并行收尾只需等待最慢一路。
      const mediaResults = await mediaFinalization;
      const warnings = collectRecorderWarnings(activeRecorders.map((entry, index) => ({
        track: entry.track,
        result: mediaResults[index],
      })));
      await db.recordings.update(recordingId, {
        durationMs,
        status: finalStatus === 'done' && warnings.length > 0 ? 'interrupted' : finalStatus,
        warnings,
      });
      const meta = await db.recordings.get(recordingId);
      if (!meta) throw new Error('recording_lost_after_stop');
      return meta;
    },
  };
}
