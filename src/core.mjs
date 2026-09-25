import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value);
const keySet = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));

export function timestamp(value, { observed = false } = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('invalid_timestamp');
  const time = new Date(value);
  if (observed && time.getTime() > Date.now() + 5 * 60_000) throw new Error('future_timestamp');
  return time.toISOString();
}

export function safeUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || /\.(?:example|invalid|test)$/i.test(url.hostname)) throw new Error('unsafe_url');
  // A query or fragment may contain a token, signed URL, or student identifier.
  url.search = '';
  url.hash = '';
  return url.href;
}

export function validateConfig(config, { allowExamples = false } = {}) {
  if (!config || config.schema_version !== 1 || typeof config.semester !== 'string' || !config.semester.trim()) throw new Error('invalid_config');
  if (typeof config.timezone !== 'string' || !config.timezone || !Intl.supportedValuesOf('timeZone').includes(config.timezone)) throw new Error('invalid_timezone');
  const canvas = config.canvas;
  if (!canvas || !Array.isArray(canvas.courses) || !Array.isArray(config.public_sources) || !Array.isArray(config.connected_sources)) throw new Error('invalid_config');
  const url = new URL(canvas.base_url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (!allowExamples && /\.(?:example|invalid|test)$/i.test(url.hostname))) throw new Error('invalid_canvas_origin');
  const slugs = new Set();
  for (const course of canvas.courses) {
    if (!Number.isSafeInteger(course.id) || course.id < 1 || !sourceId(course.slug) || slugs.has(course.slug)) throw new Error('invalid_course');
    slugs.add(course.slug);
  }
  const ids = new Set([...slugs].flatMap(slug => ['course', 'assignments', 'announcements', 'modules', 'pages', 'files', 'quizzes', 'discussions', 'calendar-events'].map(kind => `${slug}.canvas.${kind}`)));
  for (const source of [...config.public_sources, ...config.connected_sources]) {
    if (!sourceId(source.id) || ids.has(source.id) || !slugs.has(source.course)) throw new Error('invalid_source');
    ids.add(source.id);
    const sourceUrl = new URL(source.url);
    if (sourceUrl.search || sourceUrl.hash) throw new Error('source_url_parameters_forbidden');
    if (allowExamples) { if (sourceUrl.protocol !== 'https:') throw new Error('invalid_source'); } else safeUrl(source.url);
  }
  return config;
}

export function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || !keySet(record, ['id', 'kind', 'title', 'url', 'due_at', 'event_at', 'updated_at', 'fingerprint'])) throw new Error('invalid_record');
  if (typeof record.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(record.id) || !['assignment', 'announcement', 'material', 'event', 'course', 'other'].includes(record.kind) || typeof record.title !== 'string' || !record.title.trim() || record.title.length > 300) throw new Error('invalid_record');
  const normalized = {
    id: String(record.id), kind: record.kind, title: record.title.trim().replace(/[\u0000-\u001f]/g, ' '),
    url: safeUrl(record.url),
    due_at: record.due_at ? timestamp(record.due_at) : null,
    event_at: record.event_at ? timestamp(record.event_at) : null,
    updated_at: record.updated_at ? timestamp(record.updated_at) : null,
    fingerprint: record.fingerprint ?? null,
  };
  if (normalized.fingerprint !== null && !/^[a-f0-9]{64}$/.test(normalized.fingerprint)) throw new Error('invalid_fingerprint');
  normalized.content_hash = digest(normalized);
  return normalized;
}

export function validateCapture(envelope, config) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !keySet(envelope, ['source_id', 'checked_at', 'status', 'complete', 'records'])) throw new Error('invalid_capture');
  const source = config.connected_sources.find(item => item.id === envelope.source_id);
  if (!source || !['checked', 'blocked', 'not_attempted'].includes(envelope.status)) throw new Error('unknown_or_invalid_source');
  const checked_at = timestamp(envelope.checked_at, { observed: true });
  if (envelope.status === 'checked' && envelope.complete !== true) throw new Error('incomplete_check');
  if (envelope.status !== 'checked' && envelope.complete === true) throw new Error('false_completeness');
  if (!Array.isArray(envelope.records) || (envelope.status !== 'checked' && envelope.records.length)) throw new Error('invalid_records');
  const records = envelope.records.map(raw => {
    const { content_hash, ...safe } = normalizeRecord(raw);
    return safe;
  });
  if (new Set(records.map(item => item.id)).size !== records.length) throw new Error('duplicate_record_ids');
  return { source, checked_at, status: envelope.status, records };
}

export function applyResult(previous, result) {
  const prior = previous ?? null;
  const records = result.status === 'checked' ? result.records.map(normalizeRecord) : (prior?.records ?? []);
  const old = new Map((prior?.records ?? []).map(item => [item.id, item]));
  const changes = [];
  if (result.status === 'checked') {
    for (const item of records) if (old.get(item.id)?.content_hash !== item.content_hash) changes.push({ type: old.has(item.id) ? 'changed' : 'added', source_id: result.id, title: item.title });
    const newIds = new Set(records.map(item => item.id));
    for (const item of old.values()) if (!newIds.has(item.id)) changes.push({ type: 'no_longer_listed', source_id: result.id, title: item.title });
  }
  return {
    source: {
      id: result.id, course: result.course, url: safeUrl(result.url),
      status: result.status,
      last_recorded_at: result.checked_at,
      last_attempted_at: result.status === 'not_attempted' ? prior?.last_attempted_at ?? null : result.checked_at,
      last_successful_at: result.status === 'checked' ? result.checked_at : prior?.last_successful_at ?? null,
      records,
      error: result.status === 'checked' ? null : result.error ?? 'source_not_checked',
    },
    changes,
  };
}

export async function atomicJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}

export async function atomicText(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

const md = text => String(text ?? '').replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]<>|]/g, '\\$&');
const link = (title, url) => url ? `[${md(title)}](<${url}>)` : md(title);

export function renderIndex(state, config) {
  const lines = [`# ${md(config.semester)} course index`, '', `run: ${state.run_id}`, '', 'generated evidence only; check course policy and live assignment systems before acting.', '', '## sources', '', '| source | status | last successful check | records |', '| --- | --- | --- | ---: |'];
  for (const source of Object.values(state.sources).sort((a, b) => a.id.localeCompare(b.id))) lines.push(`| ${link(source.id, source.url)} | ${source.status} | ${source.last_successful_at ?? 'never'} | ${source.records.length} |`);
  for (const course of config.canvas.courses) {
    lines.push('', `## ${md(course.slug)}`, '');
    for (const source of Object.values(state.sources).filter(item => item.course === course.slug).sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`### ${md(source.id)}`, '', `status: ${source.status}; last success: ${source.last_successful_at ?? 'never'}.`, '');
      for (const item of source.records) lines.push(`- ${link(item.title, item.url)} — ${md(item.kind)}${item.due_at ? `; due ${item.due_at}` : ''}${item.event_at ? `; event ${item.event_at} (not a deadline)` : ''}`);
      if (!source.records.length) lines.push(source.status === 'checked' ? '- no records in this completed check.' : '- no verified records available.');
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

export function renderReport(state) {
  const sources = Object.values(state.sources);
  const checked = sources.filter(item => item.status === 'checked').length;
  const now = Date.now();
  const soon = sources.flatMap(source => source.records.filter(item => item.due_at && Date.parse(item.due_at) >= now && Date.parse(item.due_at) <= now + 7 * 86_400_000).map(item => ({ source, item }))).sort((a, b) => a.item.due_at.localeCompare(b.item.due_at));
  const lines = ['# Course refresh report', '', `run: ${state.run_id}`, `coverage: ${checked}/${sources.length} registered sources checked.`, '', 'first-run additions are a baseline, not necessarily newly posted work. stale records remain visible after failures.', '', '## due within seven days', ''];
  lines.push(...(soon.length ? soon.map(({ source, item }) => `- ${md(source.course)}: ${md(item.title)} — ${item.due_at} (source: ${md(source.id)}${source.status === 'checked' ? '' : ', stale evidence'})`) : ['- none in verified records; check access gaps below.']));
  lines.push('', '## changes', '');
  lines.push(...(state.changes.length ? state.changes.map(item => `- ${item.type}: ${md(item.source_id)} / ${md(item.title)}`) : ['- no record changes in checked sources; this is not an all-source no-change claim unless coverage is complete.']));
  lines.push('', '## access gaps', '');
  lines.push(...(sources.filter(item => item.status !== 'checked').map(item => `- ${md(item.id)}: ${item.status} (${md(item.error)}); last success ${item.last_successful_at ?? 'never'}`)));
  if (checked === sources.length) lines.push('- none.');
  return lines.join('\n') + '\n';
}
