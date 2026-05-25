'use client';

import { v4 as uuidv4 } from 'uuid';
import { getClientDb } from '@/lib/db-client';
import { startAudioRecorder, type AudioRecorderHandle } from '@/services/audioRecorder';
import { startCameraRecorder, type CameraHandle } from '@/services/cameraRecorder';
import { ShellCapturer } from '@/services/workspaceShellCapture';
import type { RecordingMetadata } from '@/types/recording';

export interface SessionHandle {
  recordingId: string;
  startedAt: number;
  hasAudio: boolean;
  hasCamera: boolean;
  cameraStream: MediaStream | null;
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
   * 软关闭 / 重新打开摄像头气泡。除了 track.enabled toggle 让录到黑帧，
   * 还会立刻写一条 hidden 标记的 cameraPositions 事件 —— 回放和导出
   * pipeline 根据这个标记跳过气泡渲染，避免黑帧泄到画面上。
   */
  setCameraMuted: (muted: boolean) => void;
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
  const hasCamera = camera !== null;
  if (hasCamera) await db.recordings.update(recordingId, { hasCamera: true });

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

  const elapsed = () => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pauseStartedAt : 0);

  return {
    recordingId,
    startedAt,
    hasAudio,
    hasCamera,
    cameraStream: camera?.stream ?? null,
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
    setAudioMuted(muted) {
      // 软静音：MediaRecorder 不停，让 track.enabled = false 即可让录到的音频静默。
      if (audio?.stream) {
        for (const t of audio.stream.getAudioTracks()) t.enabled = !muted;
      }
    },
    setCameraMuted(muted) {
      // 视频流软关闭 + 立刻 emit 一条 hidden 标记的位置事件。
      // 取消静音时，再 emit 一条 hidden=false 的事件让气泡重新出现。
      if (camera?.stream) {
        for (const t of camera.stream.getVideoTracks()) t.enabled = !muted;
      }
      if (paused) return;
      // 直接写入（不走节流），保证 hidden 翻转准确无延迟
      void (async () => {
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
      })();
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
