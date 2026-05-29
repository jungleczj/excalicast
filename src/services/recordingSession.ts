'use client';

import { v4 as uuidv4 } from 'uuid';
import { bulkAddLaserEvents, getClientDb } from '@/lib/db-client';
import { startAudioRecorder, type AudioRecorderHandle } from '@/services/audioRecorder';
import { startCameraRecorder, type CameraHandle } from '@/services/cameraRecorder';
import { ShellCapturer } from '@/services/workspaceShellCapture';
import type { LaserEvent, RecordingMetadata } from '@/types/recording';

export interface SessionHandle {
  recordingId: string;
  startedAt: number;
  hasAudio: boolean;
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
   * 记录摄像头气泡的位置变化（viewport 像素），节流后转换成 shell 比例存到
   * cameraPositions 表。
   *  - xPx/yPx：气泡左上角，相对于 workspaceRoot 的 viewport rect。
   *  - sizePx：气泡边长（圆形即直径）。
   */
  recordCameraMove: (xPx: number, yPx: number, sizePx: number) => void;
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
  stop: () => Promise<RecordingMetadata>;
  getElapsedMs: () => number;
}

export interface StartOptions {
  withCamera: boolean;
  workspaceRoot?: HTMLElement | null;
}

const SNAPSHOT_THROTTLE_MS = 50;
const CAMERA_POS_THROTTLE_MS = 80;

export async function startRecording(opts: StartOptions): Promise<SessionHandle> {
  const recordingId = uuidv4();
  const startedAt = Date.now();
  const db = getClientDb();

  await db.recordings.put({
    id: recordingId,
    startedAt,
    durationMs: 0,
    hasAudio: false,
    hasCamera: false,
    status: 'recording',
  });

  let audio: AudioRecorderHandle | null = null;
  try { audio = await startAudioRecorder(recordingId); } catch { audio = null; }
  const hasAudio = audio !== null;
  if (hasAudio) await db.recordings.update(recordingId, { hasAudio: true });

  let camera: CameraHandle | null = null;
  if (opts.withCamera) {
    try { camera = await startCameraRecorder(recordingId); } catch { camera = null; }
  }
  if (camera) await db.recordings.update(recordingId, { hasCamera: true });

  const writtenFileIds = new Set<string>();
  let lastSnapshotAt = -Infinity;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: { elements: unknown[]; appState: Record<string, unknown>; t: number } | null = null;
  let paused = false;
  let pauseStartedAt = 0;
  let pausedTotal = 0;

  // 工作区 UI 快照采集器（best-effort，失败不影响录制）
  let shellCapturer: ShellCapturer | null = null;
  if (opts.workspaceRoot) {
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

  // 摄像头气泡位置事件：节流写入 cameraPositions 表
  let lastCameraEventAt = -Infinity;
  let pendingCameraMove: { x: number; y: number; s: number } | null = null;
  let lastFlushedMove: { x: number; y: number; s: number } | null = null;
  let cameraMoveTimer: ReturnType<typeof setTimeout> | null = null;

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
    // 把 viewport 坐标转成相对于 workspaceRoot 的本地坐标，再除以 shell 尺寸
    const localX = move.x - rect.left;
    const localY = move.y - rect.top;
    await db.cameraPositions.add({
      recordingId,
      timestamp: Math.max(0, t),
      rx: localX / rect.width,
      ry: localY / rect.height,
      rs: move.s / rect.width,
    });
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
          pendingTimer = setTimeout(() => { void flushSnapshot(); }, SNAPSHOT_THROTTLE_MS);
        }
        return;
      }
      void flushSnapshot();
    },
    recordCameraMove(xPx, yPx, sizePx) {
      if (paused) return;
      pendingCameraMove = { x: xPx, y: yPx, s: sizePx };
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
            let rx: number, ry: number, rs: number;
            if (last) {
              rx = (last.x - rect.left) / rect.width;
              ry = (last.y - rect.top) / rect.height;
              rs = last.s / rect.width;
            } else {
              // 默认右下角，160px 直径
              rs = 160 / rect.width;
              rx = 1 - rs - 20 / rect.width;
              ry = 1 - (160 / rect.height) - 20 / rect.height;
            }
            const t = elapsed();
            await db.cameraPositions.add({
              recordingId,
              timestamp: Math.max(0, t),
              rx, ry, rs,
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
      const rx = last ? (last.x - rect.left) / rect.width : 0;
      const ry = last ? (last.y - rect.top) / rect.height : 0;
      const rs = last ? last.s / rect.width : 0;
      await db.cameraPositions.add({
        recordingId,
        timestamp: Math.max(0, t),
        rx, ry, rs,
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
    },
    resume() {
      if (!paused) return;
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
      audio?.resume();
      camera?.resume();
    },
    async stop() {
      if (paused) {
        pausedTotal += Date.now() - pauseStartedAt;
        paused = false;
      }
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        await flushSnapshot();
      }
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
      if (audio) { try { await audio.stop(); } catch { /* ignore */ } }
      if (camera) { try { await camera.stop(); } catch { /* ignore */ } }
      const durationMs = Date.now() - startedAt - pausedTotal;
      await db.recordings.update(recordingId, {
        durationMs,
        status: 'done',
      });
      const meta = await db.recordings.get(recordingId);
      if (!meta) throw new Error('recording_lost_after_stop');
      return meta;
    },
  };
}
