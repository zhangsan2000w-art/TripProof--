import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: { '/*': ['./.env*', './.data/**/*', './docs/**/*', './cases/**/*', './artifacts/**/*', './tests/**/*'] },
  serverExternalPackages: ['better-sqlite3', 'tencentcloud-sdk-nodejs-wsa'],
  poweredByHeader: false,
  async headers() {
    // ModelScope serves browser navigation inside its own full-screen frame.
    // This build option permits only the two official parent origins.
    const frameHeaders = process.env.APP_FRAME_MODE === 'modelscope'
      ? [{ key: 'Content-Security-Policy', value: 'frame-ancestors https://www.modelscope.cn https://modelscope.cn' }]
      : [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }];
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ...frameHeaders,
    ] }];
  },
};
export default config;
