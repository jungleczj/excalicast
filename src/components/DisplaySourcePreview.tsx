'use client';

import { useEffect, useRef, type JSX } from 'react';

export function DisplaySourcePreview({
  stream,
  onAspectChange,
  freeze = false,
  refreshToken = 0,
}: {
  stream: MediaStream;
  onAspectChange?: (aspect: number) => void;
  freeze?: boolean;
  refreshToken?: number;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    video.srcObject = stream;
    let timer: ReturnType<typeof setInterval> | null = null;
    const draw = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onAspectChange?.(video.videoWidth / video.videoHeight);
        const scale = Math.min(1, 1920 / video.videoWidth);
        canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    };
    const onMeta = () => {
      void video.play().then(() => {
        draw();
        if (!freeze) timer = setInterval(draw, 120);
      }).catch(() => {});
    };
    video.addEventListener('loadedmetadata', onMeta);
    if (video.readyState >= 1) onMeta();
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      if (timer) clearInterval(timer);
      video.pause();
      video.srcObject = null;
    };
  }, [freeze, onAspectChange, refreshToken, stream]);

  return (
    <>
      <video ref={videoRef} muted playsInline style={{ display: 'none' }} />
      <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        background: '#111',
      }}
      />
    </>
  );
}
