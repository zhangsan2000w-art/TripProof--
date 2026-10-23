import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const { claimRun, recoverInterruptedRuns } = await import('../lib/store');
const { executeRun } = await import('../lib/investigate');
let stopping = false;
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
recoverInterruptedRuns();
console.log('[TripProof] investigation worker ready');
while (!stopping) {
  const run = claimRun();
  if (run) { console.log(`[TripProof] ${run.kind} ${run.id}`); await executeRun(run); }
  else { recoverInterruptedRuns(); await new Promise(resolve => setTimeout(resolve, 500)); }
}
