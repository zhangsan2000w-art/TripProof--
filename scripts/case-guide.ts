import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Guide } from '../lib/domain';

/** The guide shown in a report, built from local case files the same way the browser builds it. */
export async function caseGuide(images: readonly string[], textFile: string | null): Promise<Guide> {
  const copies = await Promise.all(images.map(async (name, n) => {
    // Re-encoding drops photo metadata; long screenshots keep their full length within 12000px.
    const data = await sharp(`cases/${name}`).rotate().resize({ width: 960, height: 12000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    return { sourceIndex: n + 1, data: `data:image/jpeg;base64,${data.toString('base64')}` };
  }));
  return { text: textFile ? (await readFile(`cases/${textFile}`, 'utf8')).trim() : '', images: copies };
}
