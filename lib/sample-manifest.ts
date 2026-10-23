import { dirname, resolve } from 'node:path';

/** Keep the featured links with the database whose report IDs they reference. */
export const sampleManifestPath = () => resolve(dirname(resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || '.data/tripproof.db')), 'sample-reports.json');
