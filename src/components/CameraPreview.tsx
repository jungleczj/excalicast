'use client';

import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  sizePx?: number;
}

/**
 * Small round live preview of the camera. Used in the setup modal so the
 * presenter sees their face before recording starts. CSS-mirrored horizontally
 * to match the user's expectation ("mirror view").
 */
export function CameraPreview({ stream, sizePx = 80 }: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) {
      v.muted = true;
      v.playsInline = true;
      void v.play().catch(() => { /* autoplay may be blocked; preview is decorative */ });
    }
  }, [stream]);

  return (
    <div
      className="overflow-hidden rounded-full bg-bg-tertiary"
      style={{
        width: sizePx,
        height: sizePx,
        boxShadow: '0 0 0 1px rgba(15,23,42,0.08)',
      }}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
        aria-label="摄像头预览"
      />
    </div>
  );
}
