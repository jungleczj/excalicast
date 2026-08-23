export const DEFAULT_MAC_DESKTOP_DOWNLOAD_URL =
  'https://github.com/jungleczj/excalicast/releases/latest/download/Excalicast-mac-arm64.dmg';

export function resolveDesktopDownloadUrl(
  platform: 'mac',
  configuredUrl = process.env.MACOS_DESKTOP_DOWNLOAD_URL,
): string {
  if (platform !== 'mac') throw new Error('desktop_platform_unsupported');
  if (!configuredUrl) return DEFAULT_MAC_DESKTOP_DOWNLOAD_URL;
  let url: URL;
  try { url = new URL(configuredUrl); }
  catch { throw new Error('desktop_download_url_invalid'); }
  if (url.protocol !== 'https:') throw new Error('desktop_download_url_invalid');
  return url.toString();
}
