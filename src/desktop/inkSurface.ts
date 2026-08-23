import {
  normalizeDesktopInkSettings,
  type DesktopInkSettingsInput,
} from './productContract';

export interface DesktopInkSurfacePresentation {
  className: string;
  boardBackground: string;
  inkOpacity: number;
  fullToolSurface: true;
}

export function createDesktopInkSurfacePresentation(
  input: DesktopInkSettingsInput,
): DesktopInkSurfacePresentation {
  const settings = normalizeDesktopInkSettings(input);
  const backgroundOpacity = settings.mode === 'full-board'
    ? settings.backgroundOpacity
    : 0;
  return {
    className: `desktop-ink-overlay desktop-ink-overlay--${settings.mode}`,
    boardBackground: `rgba(255, 255, 255, ${backgroundOpacity})`,
    inkOpacity: settings.inkOpacity,
    fullToolSurface: true,
  };
}
