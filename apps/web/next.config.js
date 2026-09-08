/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'ui-avatars.com' },
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: 'graph.facebook.com' },
    ],
  },
  async rewrites() {
    // Used at build time; prefer runtime middleware proxy when API_URL is only set at runtime.
    const api = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (!api) return [];
    return [
      { source: '/api/:path*', destination: `${api.replace(/\/$/, '')}/api/:path*` },
      { source: '/health', destination: `${api.replace(/\/$/, '')}/health` },
    ];
  },
};

module.exports = nextConfig;
