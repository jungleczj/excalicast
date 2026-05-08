/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // Note: previous versions set COOP=same-origin + COEP=require-corp/credentialless
  // to enable SharedArrayBuffer for ffmpeg.wasm. That was unnecessary —
  // @ffmpeg/ffmpeg 0.12 loaded with no explicit coreURL falls back to the
  // single-threaded core which does NOT need SharedArrayBuffer / cross-origin
  // isolation. Keeping COEP also broke Paddle.js Overlay (cross-origin iframe
  // blocked by ERR_BLOCKED_BY_RESPONSE under credentialless mode). If we ever
  // switch to @ffmpeg/core-mt for parallel encoding, we'll need an isolated
  // route or service-worker-based COEP scheme that does not affect /export/*.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals ?? []),
        { 'better-sqlite3': 'commonjs better-sqlite3' },
      ];
    }
    return config;
  },
};

export default nextConfig;
