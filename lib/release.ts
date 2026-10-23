import { readFileSync } from 'node:fs';

/** Public source SHA only; local runs without deployment metadata return null. */
export function sourceCommit(): string | null {
  try {
    const metadata = JSON.parse(readFileSync('.modelscope-source.json', 'utf8')) as { sourceCommit?: unknown };
    return typeof metadata.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(metadata.sourceCommit) ? metadata.sourceCommit : null;
  } catch { return null; }
}
