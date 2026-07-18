'use client';

import { useEffect, useRef, type JSX } from 'react';

export function DisplaySourcePreview({
  stream,
  onAspectChange,
}: {
  stream: MediaStream;
  onAspectChange?: (aspect: number) => void;
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    const onMeta = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onAspectChange?.(video.videoWidth / video.videoHeight);
      }
    };
    video.addEventListener('loadedmetadata', onMeta);
    void video.play().catch(() => {});
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.pause();
      video.srcObject = null;
    };
  }, [stream, onAspectChange]);

  return (
    <video
      ref={ref}
      muted
      playsInline
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        background: 'var(--paper-2)',
      }}
    />
  );
}
