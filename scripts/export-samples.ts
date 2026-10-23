import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { exportFeaturedSamples } from '../lib/sample-bundle';

const path = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || 'data/sample-reports.json');
const bundle = exportFeaturedSamples();
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(bundle)}\n`);
console.log(`已导出 ${bundle.reports.length} 份精选真实报告：${path}；保留原核对时间和原攻略展示图文，不含账户、上传的原始文件和其他行程。`);
