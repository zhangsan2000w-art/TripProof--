import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, process.argv.find(value => value.startsWith('--out='))?.slice(6) || 'tmp/modelscope');
if (output === root || existsSync(output)) throw new Error('输出目录已存在，请用 --out=tmp/modelscope-next 指定一个新目录，避免覆盖现有文件。');
mkdirSync(output, { recursive: true });
// Publish only these source files. Never copy the workspace, credentials or data.
const entries = ['app', 'components', 'db', 'lib', 'data/holidays.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json', 'postcss.config.mjs', '.dockerignore', 'scripts/start.ts', 'scripts/processes.ts', 'scripts/worker.ts'];
// This deliberately exported bundle contains only the selected completed demo reports.
if (existsSync(join(root, 'data/sample-reports.json'))) entries.push('data/sample-reports.json');
for (const entry of entries) {
  const destination = join(output, entry); mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, entry), destination, { recursive: true, filter: source => !lstatSync(source).isSymbolicLink() && !source.endsWith('.DS_Store') });
}
mkdirSync(join(output, 'deploy/modelscope'), { recursive: true });
cpSync(join(root, 'deploy/modelscope/entrypoint.sh'), join(output, 'deploy/modelscope/entrypoint.sh'));
cpSync(join(root, 'deploy/modelscope/Dockerfile'), join(output, 'Dockerfile'));
cpSync(join(root, 'deploy/modelscope/README.md'), join(output, 'README.md'));
cpSync(join(root, 'proxy.ts'), join(output, 'proxy.ts'));
writeFileSync(join(output, '.gitignore'), 'node_modules/\n.next/\n.env*\n.data/\n*.db*\n.DS_Store\n');
function countFiles(path: string): number { return readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? countFiles(join(path, entry.name)) : 1), 0); }
console.log(`魔搭上传目录已生成：${output}\n共 ${countFiles(output)} 个文件；精选报告包会随代码发布，不含本地环境变量、上传图片或报告数据库。`);
