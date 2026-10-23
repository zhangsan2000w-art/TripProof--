import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { accessConfig } from '../lib/access';
import { initializeSampleReports } from '../lib/sample-bundle';
const require = createRequire(import.meta.url);
export function launch(mode: 'dev' | 'start') {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  if (accessConfig().mode === 'invalid') throw new Error('访问保护配置不完整：请设置 ACCESS_PASSWORD 和至少 32 字符的 ACCESS_SESSION_SECRET。');
  const samples = initializeSampleReports();
  if (samples.featured) console.log(`精选示例就绪：${samples.featured} 份；本次恢复 ${samples.imported} 份。`);
  const next = require.resolve('next/dist/bin/next');
  const tsx = require.resolve('tsx/cli');
  const env = { ...process.env, DATABASE_PATH: resolve(process.env.DATABASE_PATH || '.data/tripproof.db'), HOSTNAME: process.env.HOSTNAME || '127.0.0.1', PORT: process.env.PORT || '3000' };
  if (mode === 'start') {
    if (!existsSync('.next/standalone/server.js')) throw new Error('请先运行 pnpm build，再启动生产应用。');
    cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
    if (existsSync('public')) cpSync('public', '.next/standalone/public', { recursive: true });
  }
  const web = mode === 'start' ? ['.next/standalone/server.js'] : [next, mode, '--hostname', env.HOSTNAME, '--port', env.PORT];
  const children = [spawn(process.execPath, web, { stdio: 'inherit', env })];
  if (!process.argv.includes('--web-only')) children.push(spawn(process.execPath, [tsx, 'scripts/worker.ts'], { stdio: 'inherit', env }));
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    const exited = Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve()))));
    const deadline = setTimeout(() => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 25000);
    for (const child of children) child.kill('SIGTERM');
    await exited; clearTimeout(deadline); process.exit(code);
  };
  process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
  for (const child of children) child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
