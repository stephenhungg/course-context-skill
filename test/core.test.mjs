import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResult, normalizeRecord, readLimited, renderIndex, renderReport, safeUrl, validateCapture, validateConfig } from '../src/core.mjs';

const config = validateConfig({
  schema_version: 1, semester: 'Fall 2026', timezone: 'America/Los_Angeles',
  term_window: { start_date: '2026-08-15', end_date: '2026-12-31' },
  canvas: { base_url: 'https://canvas.school.edu', courses: [{ id: 42, slug: 'class1' }] },
  public_sources: [], connected_sources: [{ id: 'class1.gradescope', course: 'class1', url: 'https://www.gradescope.com/' }],
});

test('capture accepts a verified empty result but rejects incomplete and private fields', () => {
  const empty = { source_id: 'class1.gradescope', checked_at: new Date().toISOString(), status: 'checked', complete: true, records: [] };
  assert.equal(validateCapture(empty, config).records.length, 0);
  assert.throws(() => validateCapture({ ...empty, complete: false }, config), /incomplete_check/);
  assert.throws(() => validateCapture({ ...empty, records: [{ id: 'hw1', kind: 'assignment', title: 'HW 1', grade: 98 }] }, config), /invalid_record/);
  assert.throws(() => validateCapture({ ...empty, checked_at: '2999-01-01T00:00:00Z' }, config), /future_timestamp/);
});

test('query values are stripped from record URLs and forbidden in configured source URLs', () => {
  assert.equal(safeUrl('https://school.edu/work?token=private#secret'), 'https://school.edu/work');
  assert.throws(() => validateConfig({ ...config, connected_sources: [{ ...config.connected_sources[0], url: 'https://school.edu/?token=private' }] }), /source_url_parameters_forbidden/);
});

test('term window must be explicit and valid so calendar coverage cannot default to today', () => {
  assert.throws(() => validateConfig({ ...config, term_window: undefined }), /invalid_term_window/);
  assert.throws(() => validateConfig({ ...config, term_window: { start_date: '2026-02-30', end_date: '2026-12-31' } }), /invalid_term_window/);
  assert.throws(() => validateConfig({ ...config, term_window: { start_date: '2026-12-31', end_date: '2026-08-15' } }), /invalid_term_window/);
});

test('empty or duplicate course registries cannot produce false all-source success', () => {
  assert.throws(() => validateConfig({ ...config, canvas: { ...config.canvas, courses: [] } }), /invalid_config/);
  assert.throws(() => validateConfig({ ...config, canvas: { ...config.canvas, courses: [{ id: 42, slug: 'class1' }, { id: 42, slug: 'class2' }] } }), /invalid_course/);
});

test('failure preserves last successful evidence; checked empty result differs from failure', () => {
  const checkedAt = '2026-09-01T12:00:00Z';
  const raw = { id: 'hw1', kind: 'assignment', title: 'Homework 1', url: 'https://school.edu/hw1', due_at: '2026-10-01T23:00:00Z' };
  const first = applyResult(null, { id: 'class1.gradescope', course: 'class1', url: 'https://www.gradescope.com/', status: 'checked', checked_at: checkedAt, records: [raw] });
  assert.equal(first.changes[0].type, 'added');
  const failed = applyResult(first.source, { id: 'class1.gradescope', course: 'class1', url: 'https://www.gradescope.com/', status: 'blocked', checked_at: '2026-09-02T12:00:00Z', records: [], error: 'login_required' });
  assert.equal(failed.source.last_successful_at, checkedAt);
  assert.equal(failed.source.records.length, 1);
  assert.deepEqual(failed.changes, []);
  const empty = applyResult(first.source, { id: 'class1.gradescope', course: 'class1', url: 'https://www.gradescope.com/', status: 'checked', checked_at: '2026-09-03T12:00:00Z', records: [] });
  assert.equal(empty.source.records.length, 0);
  assert.equal(empty.changes[0].type, 'no_longer_listed');
  assert.equal(normalizeRecord(raw).due_at, '2026-10-01T23:00:00Z');
  assert.equal(normalizeRecord({ id: 'event1', kind: 'event', title: 'Holiday', event_date: '2026-11-26' }).event_date, '2026-11-26');
  assert.throws(() => normalizeRecord({ id: 'event1', kind: 'event', title: 'Holiday', event_date: '2026-02-30' }), /invalid_event_date/);
});

test('duplicate records cannot masquerade as a complete source check', () => {
  const item = { id: 'hw1', kind: 'assignment', title: 'Homework 1' };
  assert.throws(() => applyResult(null, { id: 'class1.canvas.assignments', course: 'class1', url: 'https://canvas.school.edu/courses/42', status: 'checked', checked_at: new Date().toISOString(), records: [item, item] }), /duplicate_record_ids/);
});

test('response bodies stop at the byte limit without buffering unbounded content', async () => {
  const response = new Response('123456789');
  await assert.rejects(readLimited(response, 5), /response_too_large/);
});

test('reports preserve a due-date offset and never promote an event to a deadline', () => {
  const due = new Date(Date.now() + 86_400_000);
  const sourceDue = `${new Date(due.getTime() - 7 * 3_600_000).toISOString().slice(0, -1)}-07:00`;
  const state = { run_id: 'test', changes: [], sources: {
    assignment: { id: 'assignment', course: 'class1', url: 'https://school.edu/', status: 'checked', last_successful_at: new Date().toISOString(), records: [normalizeRecord({ id: 'hw1', kind: 'assignment', title: 'Homework 1', due_at: sourceDue })] },
    event: { id: 'event', course: 'class1', url: 'https://school.edu/', status: 'checked', last_successful_at: new Date().toISOString(), records: [normalizeRecord({ id: 'talk', kind: 'event', title: 'Course talk', event_at: sourceDue })] },
  } };
  const report = renderReport(state);
  assert.match(report, new RegExp(sourceDue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(report, /source due value/);
  assert.doesNotMatch(report.split('## changes')[0], /Course talk/);
  assert.match(renderIndex(state, config), /event .*not a deadline/);
});
