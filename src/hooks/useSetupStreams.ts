'use client';

/**
 * Setup-modal stream lifecycle. The modal acquires mic / camera streams up-front
 * (preflight) so the user sees a live volume meter and camera preview BEFORE
 * the screen picker pops up. The streams persist across the modal → recording
 * transition; startScreenRecording reuses them instead of asking for permission
 * a second time.
 *
 * Design contract:
 *  - Toggling a switch ON calls requestX(), which awaits getUserMedia and
 *    surfaces the error inline. If permission is denied the toggle is forced
 *    back to off.
 *  - Toggling a switch OFF immediately stops the tracks (releases the device
 *    indicator).
 *  - When the modal closes WITHOUT starting a recording (Cancel), the consumer
 *    is responsible for calling releaseAll(). When it closes WITH recording,
 *    the consumer hands ownership of the streams to startScreenRecording and
 *    must NOT release them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureCamera, captureMicrophone } from '@/services/displayCapture';

export interface SetupStreamsState {
  micStream: MediaStream | null;
  cameraStream: MediaStream | null;
  micError: string | null;
  cameraError: string | null;
  micPending: boolean;
  cameraPending: boolean;
}

export interface SetupStreamsApi extends SetupStreamsState {
  requestMic: () => Promise<void>;
  releaseMic: () => void;
  requestCamera: () => Promise<void>;
  releaseCamera: () => void;
  releaseAll: () => void;
  /** Detach streams from the hook so a consumer (recording start) can take
   *  ownership without the hook releasing them on next state change / unmount. */
  detachAll: () => { micStream: MediaStream | null; cameraStream: MediaStream | null };
}

function stopStream(s: MediaStream | null): void {
  if (!s) return;
  try { s.getTracks().forEach((t) => t.stop()); } catch { /* */ }
}

function readableError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name || '';
    if (name === 'NotAllowedError') return '已被浏览器拒绝（请在浏览器地址栏 / 系统设置里允许后重试）';
    if (name === 'NotFoundError') return '未找到可用设备';
    if (name === 'NotReadableError') return '设备被其他应用占用';
    if (name === 'OverconstrainedError') return '设备不满足请求的约束';
    return err.message || name || 'unknown';
  }
  return 'unknown';
}

export function useSetupStreams(): SetupStreamsApi {
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micPending, setMicPending] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);

  // Ref mirrors so cleanup works even if the component unmounts mid-await.
  const micRef = useRef<MediaStream | null>(null);
  const camRef = useRef<MediaStream | null>(null);
  const detachedRef = useRef(false);

  const requestMic = useCallback(async (): Promise<void> => {
    if (micRef.current || micPending) return;
    setMicPending(true);
    setMicError(null);
    try {
      const s = await captureMicrophone();
      micRef.current = s;
      setMicStream(s);
    } catch (err) {
      setMicError(readableError(err));
    } finally {
      setMicPending(false);
    }
  }, [micPending]);

  const releaseMic = useCallback((): void => {
    stopStream(micRef.current);
    micRef.current = null;
    setMicStream(null);
    setMicError(null);
  }, []);

  const requestCamera = useCallback(async (): Promise<void> => {
    if (camRef.current || cameraPending) return;
    setCameraPending(true);
    setCameraError(null);
    try {
      const s = await captureCamera();
      camRef.current = s;
      setCameraStream(s);
    } catch (err) {
      setCameraError(readableError(err));
    } finally {
      setCameraPending(false);
    }
  }, [cameraPending]);

  const releaseCamera = useCallback((): void => {
    stopStream(camRef.current);
    camRef.current = null;
    setCameraStream(null);
    setCameraError(null);
  }, []);

  const releaseAll = useCallback((): void => {
    releaseMic();
    releaseCamera();
  }, [releaseMic, releaseCamera]);

  const detachAll = useCallback((): { micStream: MediaStream | null; cameraStream: MediaStream | null } => {
    const mic = micRef.current;
    const cam = camRef.current;
    detachedRef.current = true;
    micRef.current = null;
    camRef.current = null;
    setMicStream(null);
    setCameraStream(null);
    return { micStream: mic, cameraStream: cam };
  }, []);

  // Safety net: on unmount, release whatever wasn't detached.
  useEffect(() => {
    return () => {
      if (detachedRef.current) return;
      stopStream(micRef.current);
      stopStream(camRef.current);
      micRef.current = null;
      camRef.current = null;
    };
  }, []);

  return {
    micStream,
    cameraStream,
    micError,
    cameraError,
    micPending,
    cameraPending,
    requestMic,
    releaseMic,
    requestCamera,
    releaseCamera,
    releaseAll,
    detachAll,
  };
}
