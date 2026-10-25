#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const help = `TripProof CLI — JSON on stdout, diagnostics on stderr

Usage: tripproof [--url URL] [--session FILE] <command> [options]

Commands:
  health                              Check server readiness
  login                               Unlock with TRIPPROOF_PASSWORD
  extract [--file FILE] [--image FILE] [--request-id UUID] [--wait] [--timeout SECONDS]
  extraction JOB_ID [--wait] [--timeout SECONDS]
  draft-trip --input FILE --date YYYY-MM-DD --city CITY [--title TITLE]
                                      Convert a reviewed extraction draft to trip input
  create --input FILE                 Create a trip from reviewed trip JSON
  investigate TRIP_ID [--wait] [--timeout SECONDS]
  status TRIP_ID                      Read private trip, report and agent state
  wait TRIP_ID [--timeout SECONDS]    Wait until completed, failed or waiting_user
  message TRIP_ID --text TEXT [--reply-to QUESTION_ID] [--request-id UUID]
  message TRIP_ID --file FILE [--reply-to QUESTION_ID] [--request-id UUID]
  preview TRIP_ID --input OPS_JSON    Save a what-if preview (array of operations)
  preview TRIP_ID --date YYYY-MM-DD   Preview a change of departure date
  apply TRIP_ID PROPOSAL_ID           Apply a saved preview
  cancel RUN_ID                       Cancel an active run
  alternatives TRIP_ID ITEM_ID [--wait]
  announcement TRIP_ID [--file FILE] [--image FILE] [--wait]
  report TRIP_ID                      Return report URL, judgments and evidence

Use - as FILE to read stdin. Default URL: http://127.0.0.1:3000.
TRIPPROOF_PASSWORD is only needed when entrance protection is enabled.
TRIPPROOF_SESSION_PATH overrides the private cookie file (default ~/.config/tripproof/session.json).
All dates and times are interpreted by the server in Asia/Shanghai.
`;

export class CliError extends Error {
  constructor(message, code = 'CLI_ERROR', status = 1, details) {
    super(message); this.name = 'CliError'; this.code = code; this.status = status; this.details = details;
  }
}

export function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const flags = {};
  const positional = [];
  const valueFlags = new Set(['url', 'session', 'file', 'image', 'input', 'date', 'city', 'title', 'timeout', 'text', 'reply-to', 'request-id']);
  const boolFlags = new Set(['wait', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const separator = arg.indexOf('=');
    const name = arg.slice(2, separator < 0 ? undefined : separator);
    const inline = separator < 0 ? undefined : arg.slice(separator + 1);
    if (boolFlags.has(name)) { if (inline !== undefined) throw new CliError(`--${name} 不接受参数`, 'USAGE'); flags[name] = true; continue; }
    if (!valueFlags.has(name)) throw new CliError(`未知选项：--${name}`, 'USAGE');
    const value = inline ?? argv[++i];
    if (value === undefined || (value.startsWith('--') && value !== '-')) throw new CliError(`--${name} 需要参数`, 'USAGE');
    if (name === 'image') (flags.image ??= []).push(value);
    else if (flags[name] !== undefined) throw new CliError(`--${name} 不能重复`, 'USAGE');
    else flags[name] = value;
  }
  return { flags, positional };
}

function required(value, label) { if (!value) throw new CliError(`缺少 ${label}`, 'USAGE'); return value; }
function exactArgs(args, count) { if (args.length !== count) throw new CliError(`需要 ${count} 个位置参数；运行 tripproof --help 查看用法`, 'USAGE'); }
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new CliError('日期格式应为有效的 YYYY-MM-DD', 'USAGE'); return value; }
function seconds(value, fallback) { const n = value === undefined ? fallback : Number(value); if (!Number.isFinite(n) || n <= 0 || n > 3600) throw new CliError('--timeout 需为 1–3600 秒', 'USAGE'); return n; }
async function inputText(path) { return path === '-' ? await new Promise((resolveInput, reject) => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => resolveInput(value)); process.stdin.on('error', reject); }) : readFile(path, 'utf8'); }
async function inputJson(path) { try { return JSON.parse(await inputText(path)); } catch (error) { throw new CliError(`无法读取 JSON：${error.message}`, 'INVALID_INPUT'); } }
async function imageInput(paths = []) {
  if (paths.length > 6) throw new CliError('一次最多上传六张图片', 'INVALID_INPUT');
  return Promise.all(paths.map(async (path, index) => {
    const mime = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[path.toLowerCase().match(/\.[^.]+$/)?.[0]];
    if (!mime) throw new CliError(`图片格式不支持：${path}`, 'INVALID_INPUT');
    const bytes = await readFile(path);
    if (bytes.length > 4_000_000) throw new CliError(`图片超过 4 MB，请先缩小：${path}`, 'INVALID_INPUT');
    return { sourceIndex: index + 1, data: `data:image/${mime};base64,${bytes.toString('base64')}` };
  }));
}

export function draftToTrip(value, { date, city, title }) {
  const draft = value?.draft ?? value?.job?.draft ?? value;
  if (!draft || !Array.isArray(draft.days)) throw new CliError('输入不是提取草稿（缺少 days）', 'INVALID_INPUT');
  const items = [];
  for (const day of draft.days) {
    if (!Number.isInteger(day.dayIndex) || !Array.isArray(day.items)) throw new CliError('草稿中的日期组无效', 'INVALID_INPUT');
    let previous = null;
    for (const raw of day.items) {
      const { dependsOnPrevious, ...item } = raw;
      const id = randomUUID();
      items.push({ ...item, id, day: day.dayIndex, dependsOn: dependsOnPrevious && previous ? [previous] : [] });
      previous = id;
    }
  }
  if (!items.length) throw new CliError('草稿中没有可创建的行程项', 'INVALID_INPUT');
  return { title: title || draft.guideMeta?.title || '未命名行程', startDate: validDate(required(date, '--date')), originCity: '', destinationCity: required(city, '--city'), arriveDay1: null, leaveLastDay: null, mode: 'transit', guidePublishedAt: draft.guideMeta?.publishedAt ?? null, items };
}

export class TripProofClient {
  constructor({ url, sessionPath, password, fetchImpl = fetch }) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new CliError('服务地址必须是 HTTP(S) 根地址，不能含路径或凭据', 'USAGE');
    this.base = parsed.origin; this.sessionPath = sessionPath; this.password = password; this.fetch = fetchImpl;
    this.cookies = {}; this.loaded = false;
  }
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(await readFile(this.sessionPath, 'utf8'));
      if (saved.origin === this.base && saved.cookies && typeof saved.cookies === 'object') this.cookies = saved.cookies;
    } catch (error) { if (error.code !== 'ENOENT') throw new CliError(`无法读取会话文件：${error.message}`, 'SESSION_ERROR'); }
  }
  async save() {
    await mkdir(dirname(this.sessionPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.sessionPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ origin: this.base, cookies: this.cookies }), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.sessionPath);
  }
  async raw(path, body, { form = false } = {}) {
    await this.load();
    const headers = { Origin: this.base };
    if (Object.keys(this.cookies).length) headers.Cookie = Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    const response = await this.fetch(`${this.base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : form ? new URLSearchParams(body) : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(330_000) });
    let changed = false;
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(';', 1)[0]; const pos = pair.indexOf('=');
      if (pos > 0 && ['tp_session', 'tp_access'].includes(pair.slice(0, pos))) { this.cookies[pair.slice(0, pos)] = pair.slice(pos + 1); changed = true; }
    }
    if (changed) await this.save();
    return response;
  }
  async login() {
    if (!this.password) throw new CliError('请设置 TRIPPROOF_PASSWORD 环境变量', 'PASSWORD_REQUIRED');
    const status = await this.raw('/api/stats');
    if (status.ok) return { authenticated: true, accessRequired: Boolean(this.cookies.tp_access), origin: this.base, sessionPath: this.sessionPath };
    if (status.status !== 401) throw new CliError(`无法检查入口状态：HTTP ${status.status}`, 'LOGIN_FAILED', status.status);
    const response = await this.raw('/api/access/login', { password: this.password, next: '/' }, { form: true });
    if (response.status !== 303 || response.headers.get('location') !== '/' || !this.cookies.tp_access) throw new CliError('入口密码无效或访问已限速', 'LOGIN_FAILED', response.status);
    return { authenticated: true, origin: this.base, sessionPath: this.sessionPath };
  }
  async request(path, body, canRetry = true) {
    let response;
    try { response = await this.raw(path, body); }
    catch (error) { throw new CliError(`连接服务失败：${error.message}`, 'NETWORK_ERROR'); }
    if (response.status === 401 && canRetry && this.password) { await this.login(); return this.request(path, body, false); }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new CliError(data?.error || `HTTP ${response.status}`, data?.code || 'HTTP_ERROR', response.status, data?.fields);
    if (!data || typeof data !== 'object') throw new CliError('服务未返回有效 JSON', 'INVALID_RESPONSE', response.status);
    return data;
  }
  async owner() { await this.load(); if (!this.cookies.tp_session) await this.request('/api/extract'); }
  async waitExtraction(id, timeout) {
    const deadline = Date.now() + timeout * 1000;
    while (true) {
      const result = await this.request(`/api/extract/${encodeURIComponent(id)}`);
      if (['completed', 'failed'].includes(result.job?.status)) return result;
      if (Date.now() >= deadline) throw new CliError(`提取等待超时；可用 extraction ${id} 继续查询`, 'TIMEOUT');
      await new Promise(resolveWait => setTimeout(resolveWait, 1500));
    }
  }
  async waitTrip(id, timeout) {
    const deadline = Date.now() + timeout * 1000;
    while (true) {
      const state = await this.request(`/api/trips/${encodeURIComponent(id)}`);
      if (!state.run) throw new CliError('此行程尚未启动调查', 'NO_RUN');
      if (state.run && !['queued', 'running'].includes(state.run.status)) return state;
      if (Date.now() >= deadline) throw new CliError(`调查等待超时；可用 status ${id} 继续查询`, 'TIMEOUT');
      await new Promise(resolveWait => setTimeout(resolveWait, 1500));
    }
  }
}

export async function run(argv, env = process.env, options = {}) {
  const { flags, positional } = parseArgs(argv);
  if (flags.help || !positional.length || positional[0] === 'help') return { help };
  const [command, ...args] = positional;
  const client = new TripProofClient({ url: flags.url || env.TRIPPROOF_URL || 'http://127.0.0.1:3000', sessionPath: resolve(flags.session || env.TRIPPROOF_SESSION_PATH || `${homedir()}/.config/tripproof/session.json`), password: env.TRIPPROOF_PASSWORD, ...options });
  const timeout = seconds(flags.timeout, 600);
  if (command === 'health') { exactArgs(args, 0); return client.request('/api/health'); }
  if (command === 'login') { exactArgs(args, 0); return client.login(); }
  if (command === 'extract') {
    exactArgs(args, 0); await client.owner();
    if (!flags.file && !flags.image?.length) throw new CliError('请提供 --file 或 --image', 'USAGE');
    const text = flags.file ? await inputText(flags.file) : '';
    const images = await imageInput(flags.image);
    const requestId = flags['request-id'] || randomUUID();
    const { job } = await client.request('/api/extract', { text, images, background: true, requestId });
    return flags.wait ? client.waitExtraction(job.id, timeout) : { job };
  }
  if (command === 'extraction') { exactArgs(args, 1); return flags.wait ? client.waitExtraction(args[0], timeout) : client.request(`/api/extract/${encodeURIComponent(args[0])}`); }
  if (command === 'draft-trip') { exactArgs(args, 0); return draftToTrip(await inputJson(required(flags.input, '--input')), { date: flags.date, city: flags.city, title: flags.title }); }
  if (command === 'create') { exactArgs(args, 0); await client.owner(); return client.request('/api/trips', await inputJson(required(flags.input, '--input'))); }
  if (command === 'investigate') { exactArgs(args, 1); await client.owner(); const started = await client.request(`/api/trips/${encodeURIComponent(args[0])}/runs`, {}); return flags.wait ? client.waitTrip(args[0], timeout) : started; }
  if (command === 'status') { exactArgs(args, 1); return client.request(`/api/trips/${encodeURIComponent(args[0])}`); }
  if (command === 'wait') { exactArgs(args, 1); return client.waitTrip(args[0], timeout); }
  if (command === 'message') {
    exactArgs(args, 1); if (Boolean(flags.text) === Boolean(flags.file)) throw new CliError('请只使用 --text 或 --file 之一', 'USAGE');
    const text = flags.text ?? await inputText(flags.file);
    const state = await client.request(`/api/trips/${encodeURIComponent(args[0])}`);
    const requestId = flags['request-id'] || randomUUID();
    const sent = await client.request(`/api/trips/${encodeURIComponent(args[0])}/messages`, { requestId, revision: state.trip.revision, text, ...(flags['reply-to'] ? { replyTo: flags['reply-to'] } : {}) });
    return { requestId, ...sent };
  }
  if (command === 'preview') {
    exactArgs(args, 1); if (Boolean(flags.input) === Boolean(flags.date)) throw new CliError('请只使用 --input 或 --date 之一', 'USAGE');
    const state = await client.request(`/api/trips/${encodeURIComponent(args[0])}`);
    const change = flags.date ? { startDate: validDate(flags.date) } : { ops: await inputJson(flags.input) };
    return client.request(`/api/trips/${encodeURIComponent(args[0])}/whatif`, { revision: state.trip.revision, ...change, apply: false });
  }
  if (command === 'apply') {
    exactArgs(args, 2); const state = await client.request(`/api/trips/${encodeURIComponent(args[0])}`);
    return client.request(`/api/trips/${encodeURIComponent(args[0])}/whatif`, { revision: state.trip.revision, proposalId: args[1], apply: true });
  }
  if (command === 'cancel') { exactArgs(args, 1); return client.request(`/api/runs/${encodeURIComponent(args[0])}/cancel`, {}); }
  if (command === 'alternatives') { exactArgs(args, 2); const started = await client.request(`/api/trips/${encodeURIComponent(args[0])}/alternatives`, { itemId: args[1] }); return flags.wait ? client.waitTrip(args[0], timeout) : started; }
  if (command === 'announcement') { exactArgs(args, 1); if (!flags.file && !flags.image?.length) throw new CliError('请提供 --file 或 --image', 'USAGE'); const started = await client.request(`/api/trips/${encodeURIComponent(args[0])}/announcements`, { text: flags.file ? await inputText(flags.file) : '', images: await imageInput(flags.image) }); return flags.wait ? client.waitTrip(args[0], timeout) : started; }
  if (command === 'report') {
    exactArgs(args, 1); const state = await client.request(`/api/trips/${encodeURIComponent(args[0])}`);
    return { tripId: state.trip.id, shareId: state.trip.shareId, url: `${client.base}/r/${state.trip.shareId}`, run: state.run && { id: state.run.id, status: state.run.status, error: state.run.error }, result: state.result };
  }
  throw new CliError(`未知命令：${command}`, 'USAGE');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(value => {
    process.stdout.write(typeof value?.help === 'string' ? value.help : `${JSON.stringify(value)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ error: error.message, code: error.code || 'CLI_ERROR', ...(error.status && error.status !== 1 ? { status: error.status } : {}), ...(error.details ? { fields: error.details } : {}) })}\n`);
    process.exitCode = 1;
  });
}
