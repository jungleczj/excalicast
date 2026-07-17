// Hand-drawn style icon set — 1.5px strokes, rounded terminals.

import type { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  sw?: number;
}

const Base = ({ size = 18, sw = 1.6, children, ...rest }: IconProps & { children: React.ReactNode }) => (
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
      <rect x="7" y="5" width="3.5" height="14" rx="0.6" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="0.6" />
    </Base>
  ),
  Play: (p: IconProps) => <Base {...p}><path d="M7 5 L18.5 12 L7 19 Z" /></Base>,
  Stop: (p: IconProps) => <Base {...p}><rect x="6" y="6" width="12" height="12" rx="1" /></Base>,
  Mic: (p: IconProps) => (
    <Base {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11 a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5 v3.5" />
      <path d="M9 21 h6" />
    </Base>
  ),
  MicOff: (p: IconProps) => (
    <Base {...p}>
      <line x1="3" y1="3" x2="21" y2="21" />
      <path d="M9 9 V6 a3 3 0 0 1 6 0 v5" />
      <path d="M15 14 a3 3 0 0 1 -5.6 -1.5" />
      <path d="M5.5 11 a6.5 6.5 0 0 0 10.8 4.4" />
      <path d="M18.5 11 a6.5 6.5 0 0 1 -0.6 2.6" />
      <path d="M12 17.5 v3.5" />
      <path d="M9 21 h6" />
    </Base>
  ),
  Camera: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <circle cx="12" cy="12.5" r="3.5" />
      <path d="M8 6 l1.5 -2 h5 L16 6" />
    </Base>
  ),
  CameraOff: (p: IconProps) => (
    <Base {...p}>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34" />
      <path d="M23 7l-7 5 7 5V7z" />
    </Base>
  ),
  Plus: (p: IconProps) => <Base {...p}><path d="M12 5 v14 M5 12 h14" /></Base>,
  Close: (p: IconProps) => <Base {...p}><path d="M6 6 l12 12 M18 6 l-12 12" /></Base>,
  Check: (p: IconProps) => <Base {...p}><path d="M5 12.5 l4.5 4.5 l10 -11" /></Base>,
  ChevronLeft: (p: IconProps) => <Base {...p}><path d="M15 6 l-6 6 l6 6" /></Base>,
  ChevronRight: (p: IconProps) => <Base {...p}><path d="M9 6 l6 6 l-6 6" /></Base>,
  ChevronDown: (p: IconProps) => <Base {...p}><path d="M6 9 l6 6 l6 -6" /></Base>,
  ArrowRight: (p: IconProps) => <Base {...p}><path d="M5 12 h13 M13 6.5 l5.5 5.5 l-5.5 5.5" /></Base>,
  Download: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 4 v11 M7 11 l5 5 l5 -5 M4.5 20 h15" />
    </Base>
  ),
  Upload: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 20 v-12 M7 11 l5 -5 l5 5 M4.5 4 h15" />
    </Base>
  ),
  Lock: (p: IconProps) => (
    <Base {...p}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11 V8 a4 4 0 0 1 8 0 v3" />
    </Base>
  ),
  Sparkles: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 4 l1.4 4.2 l4.2 1.4 l-4.2 1.4 l-1.4 4.2 l-1.4 -4.2 l-4.2 -1.4 l4.2 -1.4 Z" />
      <path d="M18.5 16 l0.7 1.8 l1.8 0.7 l-1.8 0.7 l-0.7 1.8 l-0.7 -1.8 l-1.8 -0.7 l1.8 -0.7 Z" />
    </Base>
  ),
  Laser: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 3 v3 M12 18 v3 M3 12 h3 M18 12 h3" />
      <path d="M5.6 5.6 l1.8 1.8 M16.6 16.6 l1.8 1.8 M5.6 18.4 l1.8 -1.8 M16.6 7.4 l1.8 -1.8" />
    </Base>
  ),
  Library: (p: IconProps) => (
    <Base {...p}>
      {/* 三本书并排：左 / 中 / 右，最右本斜 */}
      <rect x="3.5" y="4.5" width="3" height="15" rx="0.6" />
      <rect x="8" y="4.5" width="3" height="15" rx="0.6" />
      <path d="M14.5 6.2 l3 -0.8 l3 14.4 l-3 0.8 Z" />
      <path d="M3.5 9 h3 M8 9 h3 M14.9 8.4 l2.9 -0.7" />
    </Base>
  ),
  Subtitles: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M7 11.5 h3 M7 14.5 h5 M14 11.5 h3 M14 14.5 h3" />
    </Base>
  ),
  Share: (p: IconProps) => (
    <Base {...p}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M8.2 11 l7.6 -4.4 M8.2 13 l7.6 4.4" />
    </Base>
  ),
  Trash: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 7 h16 M9 7 V4.5 h6 V7 M6 7 l1 13 a1.5 1.5 0 0 0 1.5 1.4 h7 a1.5 1.5 0 0 0 1.5 -1.4 l1 -13" />
      <path d="M10 11 v6 M14 11 v6" />
    </Base>
  ),
  Cloud: (p: IconProps) => (
    <Base {...p}>
      <path d="M17.5 19a4.5 4.5 0 1 0-1.41-8.78 6 6 0 0 0-11.66 1.78A4 4 0 0 0 5 19h12.5z" />
    </Base>
  ),
  CloudUpload: (p: IconProps) => (
    <Base {...p}>
      <path d="M17.5 19a4.5 4.5 0 1 0-1.41-8.78 6 6 0 0 0-11.66 1.78A4 4 0 0 0 5 19h2" />
      <polyline points="9 14 12 11 15 14" />
      <line x1="12" y1="11" x2="12" y2="20" />
    </Base>
  ),
  CloudCheck: (p: IconProps) => (
    <Base {...p}>
      <path d="M17.5 19a4.5 4.5 0 1 0-1.41-8.78 6 6 0 0 0-11.66 1.78A4 4 0 0 0 5 19h12.5z" />
      <polyline points="9 13 11 15 15 11" />
    </Base>
  ),
  CloudOff: (p: IconProps) => (
    <Base {...p}>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M5.78 5.78A4 4 0 0 0 5 13h11.34M21 13a4 4 0 0 0-4-4h-1.26a8 8 0 0 0-7.05-3.74" />
    </Base>
  ),
  Loader: (p: IconProps) => (
    <Base {...p}>
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </Base>
  ),
  Square: (p: IconProps) => <Base {...p}><rect x="4.5" y="4.5" width="15" height="15" rx="1" /></Base>,
  CheckSquare: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 12 l3 3 l5 -7" />
    </Base>
  ),
  Logo: (p: IconProps) => {
    const size = p.size ?? 18;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        stroke="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
        {...(p as Omit<IconProps, 'size' | 'sw'>)}
      >
        <rect x="3.6" y="3.4" width="24.8" height="25" rx="6.2" fill="#FFFCF5" />
        <path d="M9.2 22.6 L14.3 16.7 c1.1 -1.3 2.5 -1.2 3.5 0.1 l2.1 2.7 l2.9 -3.5 c0.9 -1.1 2.1 -1 3 0.2 l2.1 2.9 v4.4 c0 1.9 -1 2.9 -3 2.9 H7.2 c-1.7 0 -2.7 -0.8 -2.9 -2.2 c1.5 -0.4 3.1 -0.9 4.9 -1.6 z" fill="#BFE0F5" />
        <path d="M16.8 26.4 L21.8 18.2 c0.8 -1.3 2.2 -1.3 3 0 l3.1 5 v0.6 c0 1.7 -0.9 2.6 -2.6 2.6 z" fill="#F9D05A" />
        <circle cx="10.1" cy="9.1" r="2.6" fill="#F0443E" />
        <rect x="3.6" y="3.4" width="24.8" height="25" rx="6.2" fill="none" stroke="#1F2225" strokeWidth="2.35" />
      </svg>
    );
  },
  Drag: (p: IconProps) => (
    <Base {...p}>
      <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </Base>
  ),
  Edit: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 20 l1 -4 l10.5 -10.5 l3 3 L8 19 Z" />
      <path d="M14 6.5 l3 3" />
    </Base>
  ),
  Crop: (p: IconProps) => <Base {...p}><path d="M6 3 v15 h15 M3 6 h15 v15" /></Base>,
  Circle: (p: IconProps) => <Base {...p}><circle cx="12" cy="12" r="8" /></Base>,
  Ratio16x9: (p: IconProps) => <Base {...p}><rect x="3" y="7" width="18" height="10" rx="0.6" /></Base>,
  Ratio9x16: (p: IconProps) => <Base {...p}><rect x="7" y="3" width="10" height="18" rx="0.6" /></Base>,
  Ratio1x1: (p: IconProps) => <Base {...p}><rect x="5" y="5" width="14" height="14" rx="0.6" /></Base>,
  Mail: (p: IconProps) => (
    <Base {...p}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="22,6 12,13 2,6" />
    </Base>
  ),
  Highlighter: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 19 h6 l1.5 -2 l-5 -5 l-2 1.5 z" />
      <path d="M9.5 13.5 l5.5 -7 a2 2 0 0 1 3 0 a2 2 0 0 1 0 3 l-7 5.5" />
    </Base>
  ),
  User: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21 a8 7 0 0 1 16 0" />
    </Base>
  ),
  Search: (p: IconProps) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16 l4.5 4.5" />
    </Base>
  ),
  Grid: (p: IconProps) => (
    <Base {...p}>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </Base>
  ),
  List: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 6 h2 M4 12 h2 M4 18 h2 M9 6 h11 M9 12 h11 M9 18 h11" />
    </Base>
  ),
  // ── added for ExcalidrawRec UI refactor ──────────────────
  Monitor: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20 h8 M12 16 v4" />
    </Base>
  ),
  Captions: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 11 a2 2 0 0 1 3 -0.6 M14 11 a2 2 0 0 1 3 -0.6 M7 14 a2 2 0 0 0 3 0.6 M14 14 a2 2 0 0 0 3 0.6" />
    </Base>
  ),
  Doc: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 3 h8 l4 4 v14 a1 1 0 0 1 -1 1 H6 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1 z" />
      <path d="M14 3 v4 h4 M8.5 12 h7 M8.5 15.5 h7 M8.5 19 h4" />
    </Base>
  ),
  Bell: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 9 a6 6 0 0 1 12 0 c0 5 1.5 6 2 7 H4 c0.5 -1 2 -2 2 -7 z" />
      <path d="M10 20 a2 2 0 0 0 4 0" />
    </Base>
  ),
  Tag: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 11 V4 a1 1 0 0 1 1 -1 h7 l9 9 a1 1 0 0 1 0 1.4 l-6.6 6.6 a1 1 0 0 1 -1.4 0 z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </Base>
  ),
  Globe: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12 h18 M12 3 c3 3 3 15 0 18 c-3 -3 -3 -15 0 -18" />
    </Base>
  ),
  Hand: (p: IconProps) => (
    <Base {...p}>
      <path d="M7 11 V6.5 a1.4 1.4 0 0 1 2.8 0 V11 V5 a1.4 1.4 0 0 1 2.8 0 v6 V6 a1.4 1.4 0 0 1 2.8 0 v6 l0 1 a1.4 1.4 0 0 1 2.6 -0.6 l0 -1.4 a1.4 1.4 0 0 1 2.8 0 v3 a6 6 0 0 1 -6 6 h-2 a6 6 0 0 1 -5.2 -3 L4 16 a1.5 1.5 0 0 1 2.4 -1.8 z" />
    </Base>
  ),
  Pencil: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 20 l1 -4 L15.5 5.5 a2 2 0 0 1 3 3 L8 19 l-4 1 z" />
      <path d="M13.5 7.5 l3 3" />
    </Base>
  ),
  Diamond: (p: IconProps) => <Base {...p}><path d="M12 3 L21 12 L12 21 L3 12 Z" /></Base>,
  Arrow: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 12 h15 M13 6 l6 6 l-6 6" />
    </Base>
  ),
  Text: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 6 V4.5 h14 V6 M12 4.5 V20 M9 20 h6" />
    </Base>
  ),
  Eraser: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 20 H20 M5 16 l5 -5 l6 6 l-3 3 H8 z M10 11 l4 -4 a2 2 0 0 1 3 0 l3 3 a2 2 0 0 1 0 3 l-4 4" />
    </Base>
  ),
  Settings: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3 v2.5 M12 18.5 V21 M3 12 h2.5 M18.5 12 H21 M5.5 5.5 l1.8 1.8 M16.7 16.7 l1.8 1.8 M18.5 5.5 l-1.8 1.8 M7.3 16.7 l-1.8 1.8" />
    </Base>
  ),
  Bolt: (p: IconProps) => <Base {...p}><path d="M13 2 L4 14 h6 l-1 8 l9 -12 h-6 z" /></Base>,
};

// Hand-drawn logo mark for the brand
interface LogoMarkProps {
  size?: number;
  className?: string;
}
export function LogoMark({ size = 28, className }: LogoMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0 }}
    >
      <rect x="3.6" y="3.4" width="24.8" height="25" rx="6.2" fill="#FFFCF5" />
      <path d="M9.2 22.6 L14.3 16.7 c1.1 -1.3 2.5 -1.2 3.5 0.1 l2.1 2.7 l2.9 -3.5 c0.9 -1.1 2.1 -1 3 0.2 l2.1 2.9 v4.4 c0 1.9 -1 2.9 -3 2.9 H7.2 c-1.7 0 -2.7 -0.8 -2.9 -2.2 c1.5 -0.4 3.1 -0.9 4.9 -1.6 z" fill="#BFE0F5" />
      <path d="M16.8 26.4 L21.8 18.2 c0.8 -1.3 2.2 -1.3 3 0 l3.1 5 v0.6 c0 1.7 -0.9 2.6 -2.6 2.6 z" fill="#F9D05A" />
      <circle cx="10.1" cy="9.1" r="2.6" fill="#F0443E" />
      <rect x="3.6" y="3.4" width="24.8" height="25" rx="6.2" fill="none" stroke="#1F2225" strokeWidth="2.35" />
    </svg>
  );
}
