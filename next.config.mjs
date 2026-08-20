import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'ws'],
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
    // kokoro-js defaults to its Node bundle, which pulls native ONNX bindings.
    // Dubbing runs exclusively in a browser Worker, so bundle its browser build.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'kokoro-js': path.resolve(process.cwd(), 'node_modules/kokoro-js/dist/kokoro.js'),
      '@huggingface/transformers': path.resolve(
        process.cwd(),
        'node_modules/@huggingface/transformers/dist/transformers.web.js',
      ),
      'onnxruntime-web': path.resolve(
        process.cwd(),
        'node_modules/onnxruntime-web/dist/ort.min.js',
      ),
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
      path: false,
    };
    if (isServer) {
      config.externals = [
        ...(config.externals ?? []),
        {
          'better-sqlite3': 'commonjs better-sqlite3',
          'ws': 'commonjs ws',
        },
      ];
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
