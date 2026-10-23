import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: { '/*': ['./.env*', './.data/**/*', './docs/**/*', './cases/**/*', './artifacts/**/*', './tests/**/*'] },
  serverExternalPackages: ['better-sqlite3', 'tencentcloud-sdk-nodejs-wsa'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};
export default config;
