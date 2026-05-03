/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // COOP/COEP for SharedArrayBuffer (ffmpeg.wasm)
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
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
