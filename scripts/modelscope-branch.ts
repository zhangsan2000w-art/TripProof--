import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (args: string[], cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
if (git(['branch', '--show-current']) !== 'main') throw new Error('请在 main 分支运行此命令。');
if (git(['status', '--porcelain'])) throw new Error('请先提交 main 的修改，再同步部署分支，确保发布内容可以追溯。');
const source = git(['rev-parse', 'HEAD']);
const origin = git(['remote', 'get-url', 'origin']);
if (/^https?:/i.test(origin) && (new URL(origin).username || new URL(origin).password)) throw new Error('origin 地址中不能包含凭据，请使用 Git 凭据管理器。');
if (!git(['ls-remote', '--heads', 'origin', 'refs/heads/modelscope'])) throw new Error('远端 modelscope 分支尚未初始化，请先导入现有魔搭发布历史。');
console.log(`同步 main@${source.slice(0, 7)} → origin/modelscope`);
const temporary = mkdtempSync(join(tmpdir(), 'tripproof-modelscope-'));
try {
  const output = join(temporary, 'export'), checkout = join(temporary, 'checkout');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-modelscope.ts', `--out=${output}`], { cwd: root, stdio: 'inherit' });
  git(['clone', '--quiet', '--single-branch', '--branch', 'modelscope', origin, checkout]);
  // Only remove files inside our temporary checkout. Keep the platform's LFS rules and Git history.
  for (const entry of readdirSync(checkout)) if (entry !== '.git' && entry !== '.gitattributes') rmSync(join(checkout, entry), { recursive: true, force: true });
  for (const entry of readdirSync(output)) cpSync(join(output, entry), join(checkout, entry), { recursive: true });
  writeFileSync(join(checkout, '.modelscope-source.json'), `${JSON.stringify({ sourceBranch: 'main', sourceCommit: source }, null, 2)}\n`);
  for (const setting of ['user.name', 'user.email']) git(['config', '--local', setting, git(['config', '--get', setting])], checkout);
  git(['add', '--all'], checkout);
  git(['diff', '--cached', '--check'], checkout);
  if (git(['diff', '--cached', '--name-only'], checkout)) {
    git(['commit', '-m', `Prepare ModelScope release from main ${source.slice(0, 7)}`], checkout);
    // A concurrent remote update fails normally; never replace someone else's commits.
    git(['push', 'origin', 'HEAD:refs/heads/modelscope'], checkout);
  }
  git(['fetch', '--no-tags', 'origin', 'refs/heads/modelscope:refs/remotes/origin/modelscope']);
  console.log(`origin/modelscope 已同步：${git(['rev-parse', '--short', 'refs/remotes/origin/modelscope'])}`);
  console.log('发布到魔搭：git push modelscope refs/remotes/origin/modelscope:refs/heads/master，然后在创空间点击“上线”。');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
