#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { open, readFile, mkdir, writeFile, unlink, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyResult, atomicJson, atomicText, readJson, readLimited, renderIndex, renderReport, safeUrl, validateCapture, validateConfig } from './core.mjs';
import { canvasSources, fetchCanvasSource } from './canvas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, workspaceArg] = process.argv.slice(2);
const workspace = path.resolve(workspaceArg ?? process.cwd());
const privateDir = path.join(workspace, '.course-context');

async function loadConfig() {
  return validateConfig(await readJson(path.join(privateDir, 'config.json')));
}

async function privateWorkspaceIssue() {
  const folder = await lstat(privateDir);
  if (folder.isSymbolicLink() || !folder.isDirectory() || (folder.mode & 0o077) !== 0) return 'private_dir_permissions';
  const config = await lstat(path.join(privateDir, 'config.json'));
  if (config.isSymbolicLink() || !config.isFile() || (config.mode & 0o077) !== 0) return 'config_permissions';
  const inGit = spawnSync('git', ['-C', workspace, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inGit.status === 0 && inGit.stdout.trim() === 'true') {
    const tracked = spawnSync('git', ['-C', workspace, 'ls-files', '--cached', '--', privateDir], { encoding: 'utf8' });
    if (tracked.status === 0 && tracked.stdout.trim()) return 'private_dir_tracked_in_git';
    const ignored = spawnSync('git', ['-C', workspace, 'check-ignore', '-q', '--', privateDir]);
    if (ignored.status !== 0) return 'private_dir_not_gitignored';
  }
  return null;
}

async function requirePrivateWorkspace() {
  const issue = await privateWorkspaceIssue();
  if (issue) throw new Error(issue);
}

async function init() {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const target = path.join(privateDir, 'config.json');
  const exists = await readJson(target);
  if (exists) throw new Error('config_already_exists');
  const example = await readFile(path.join(root, 'config.example.json'), 'utf8');
  await writeFile(target, example, { flag: 'wx', mode: 0o600 });
  console.log(`private starter config created: ${target}`);
  const issue = await privateWorkspaceIssue();
  if (issue) console.log(`privacy check: ${issue}; fix this before capture or sync`);
}

async function check() {
  const config = await loadConfig();
  const issue = await privateWorkspaceIssue();
  console.log(`config valid: ${config.canvas.courses.length} courses, ${config.public_sources.length} public sources, ${config.connected_sources.length} connected sources`);
  console.log(`Canvas token: ${process.env.CANVAS_TOKEN ? 'available' : 'missing (Canvas checks will be not_attempted)'}`);
  console.log(`private workspace: ${issue ?? 'safe'}`);
  if (issue) process.exitCode = 2;
}

async function capture() {
  await requirePrivateWorkspace();
  const config = await loadConfig();
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 1_000_000) throw new Error('capture_too_large');
  }
  const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const validated = validateCapture(envelope, config);
  await atomicJson(path.join(privateDir, 'capture-input', `${validated.source.id}.json`), {
    source_id: validated.source.id,
    checked_at: validated.checked_at,
    status: validated.status,
    complete: validated.status === 'checked',
    records: validated.records,
  });
  console.log(`sanitized source capture saved: ${validated.source.id}`);
}

function publicSources(config) {
  return config.public_sources.map(source => ({ ...source, kind: 'public' }));
}

async function fetchPublicSource(source) {
  const response = await fetch(source.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/html, text/plain, application/pdf, */*' } });
  if (!response.ok) throw new Error(`public_http_${response.status}`);
  const bytes = await readLimited(response);
  const text = response.headers.get('content-type')?.includes('text/html') ? bytes.toString('utf8') : '';
  const title = text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim().slice(0, 300) ?? new URL(source.url).pathname.split('/').filter(Boolean).at(-1) ?? source.id;
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  return [{ id: 'document', kind: 'material', title, url: safeUrl(source.url), fingerprint }];
}

async function withLock(fn) {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(privateDir, 'run.lock');
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('run_locked_inspect_manually'); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })); await handle.close(); return await fn(); }
  finally { await unlink(lockPath).catch(() => {}); }
}

async function sync() {
  await requirePrivateWorkspace();
  const config = await loadConfig();
  return withLock(async () => {
    const previous = await readJson(path.join(privateDir, 'state.json'), { sources: {} });
    const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`;
    const runDir = path.join(privateDir, 'runs', runId);
    const state = { schema_version: 1, run_id: runId, started_at: new Date().toISOString(), status: 'running', sources: {}, changes: [] };
    const checkpoint = async () => atomicJson(path.join(runDir, 'state.json'), state);
    await checkpoint();
    const tasks = [
      ...canvasSources(config).map(source => ({ source, adapter: 'canvas', collect: () => fetchCanvasSource(source, process.env.CANVAS_TOKEN) })),
      ...publicSources(config).map(source => ({ source, adapter: 'public', collect: () => fetchPublicSource(source) })),
      ...config.connected_sources.map(source => ({ source, adapter: 'capture', collect: async () => {
        const envelope = await readJson(path.join(privateDir, 'capture-input', `${source.id}.json`));
        if (!envelope) return { status: 'not_attempted', records: [], error: 'capture_missing' };
        const input = validateCapture(envelope, config);
        if (Date.parse(input.checked_at) <= Date.parse(previous.sources[source.id]?.last_recorded_at ?? 0)) return { status: 'not_attempted', records: [], error: 'capture_reused' };
        if (Date.now() - Date.parse(input.checked_at) > 24 * 60 * 60_000) return { status: 'not_attempted', records: [], error: 'capture_stale' };
        return { status: input.status, records: input.records, checked_at: input.checked_at, error: input.status === 'checked' ? null : 'connector_check_incomplete' };
      } })),
    ];
    for (const task of tasks) {
      const { source } = task;
      let result;
      try {
        const collected = await task.collect();
        result = Array.isArray(collected) ? { status: 'checked', records: collected } : collected;
      } catch (error) {
        result = { status: task.adapter === 'canvas' && !process.env.CANVAS_TOKEN ? 'not_attempted' : 'blocked', records: [], error: /^[a-z_]+(?:_http_\d+)?$/.test(error.message) ? error.message : 'source_check_failed' };
      }
      const incoming = { id: source.id, course: source.course, url: source.display_url ?? source.url, status: result.status, checked_at: result.checked_at ?? new Date().toISOString(), records: result.records, error: result.error };
      try {
        const applied = applyResult(previous.sources[source.id], incoming);
        state.sources[source.id] = applied.source;
        state.changes.push(...applied.changes);
      } catch {
        state.sources[source.id] = applyResult(previous.sources[source.id], { ...incoming, status: 'blocked', records: [], error: 'source_schema_invalid' }).source;
      }
      await checkpoint();
    }
    for (const source of Object.values(previous.sources)) if (!state.sources[source.id]) state.sources[source.id] = applyResult(source, { id: source.id, course: source.course, url: source.url, status: 'not_attempted', checked_at: new Date().toISOString(), records: [], error: 'source_removed_from_config' }).source;
    state.finished_at = new Date().toISOString();
    state.status = Object.values(state.sources).every(source => source.status === 'checked') ? 'complete' : 'partial';
    await checkpoint();
    await atomicText(path.join(privateDir, 'index.md'), renderIndex(state, config));
    await atomicText(path.join(privateDir, 'report.md'), renderReport(state));
    await atomicJson(path.join(privateDir, 'state.json'), state);
    const checked = Object.values(state.sources).filter(source => source.status === 'checked').length;
    console.log(`course refresh ${state.status}: ${checked}/${Object.keys(state.sources).length} sources checked; private report: ${path.join(privateDir, 'report.md')}`);
    if (state.status === 'partial') process.exitCode = 2;
  });
}

try {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('node_22_required');
  if (command === 'init') await init();
  else if (command === 'check') await check();
  else if (command === 'capture') await capture();
  else if (command === 'sync') await sync();
  else throw new Error('usage: node src/cli.mjs init|check|capture|sync [workspace]');
} catch (error) {
  console.error(`course context: ${/^[a-z_]+(?:_http_\d+)?$/.test(error.message) ? error.message : 'operation_failed'}`);
  process.exitCode = 1;
}
