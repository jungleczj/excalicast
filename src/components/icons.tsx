// Lucide-style 24×24 inline SVGs, stroke-currentColor.

import type { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  sw?: number;
}

const Base = ({ size = 18, sw = 2, children, ...rest }: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

export const I = {
  Pause: (p: IconProps) => (
    <Base {...p}>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </Base>
  ),
  Play: (p: IconProps) => <Base {...p}><polygon points="6 4 20 12 6 20" fill="currentColor" stroke="none" /></Base>,
  Stop: (p: IconProps) => <Base {...p}><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" /></Base>,
  Mic: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </Base>
  ),
  Camera: (p: IconProps) => (
    <Base {...p}>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </Base>
  ),
  CameraOff: (p: IconProps) => (
    <Base {...p}>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34" />
      <path d="M23 7l-7 5 7 5V7z" />
    </Base>
  ),
  Plus: (p: IconProps) => <Base {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Base>,
  Check: (p: IconProps) => <Base {...p}><polyline points="20 6 9 17 4 12" /></Base>,
  ChevronLeft: (p: IconProps) => <Base {...p}><polyline points="15 18 9 12 15 6" /></Base>,
  Download: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Base>
  ),
  Lock: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Base>
  ),
  Sparkles: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7z" />
      <path d="M19 14v4M17 16h4" />
    </Base>
  ),
  Subtitles: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <line x1="7" y1="11" x2="11" y2="11" />
      <line x1="13" y1="11" x2="17" y2="11" />
      <line x1="7" y1="15" x2="13" y2="15" />
    </Base>
  ),
  Share: (p: IconProps) => (
    <Base {...p}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </Base>
  ),
  Trash: (p: IconProps) => (
    <Base {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Base>
  ),
  Logo: (p: IconProps) => (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      style={{ flexShrink: 0 }}
      {...(p as Omit<IconProps, 'size' | 'sw'>)}
    >
      <path d="M3 4 a2 2 0 0 1 2-2 h14 a2 2 0 0 1 2 2 v12 a2 2 0 0 1-2 2 H7 l-4 4 z" opacity="0.95" />
      <circle cx="9" cy="10" r="1.4" fill="white" />
      <circle cx="13.5" cy="10" r="1.4" fill="white" />
      <circle cx="18" cy="10" r="1.4" fill="white" />
    </svg>
  ),
  Drag: (p: IconProps) => (
    <Base {...p}>
      <circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </Base>
  ),
  Edit: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </Base>
  ),
  Crop: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </Base>
  ),
  Mail: (p: IconProps) => (
    <Base {...p}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="22,6 12,13 2,6" />
    </Base>
  ),
};
