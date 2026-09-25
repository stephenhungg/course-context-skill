import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResult, normalizeRecord, safeUrl, validateCapture, validateConfig } from '../src/core.mjs';

const config = validateConfig({
  schema_version: 1, semester: 'Fall 2026', timezone: 'America/Los_Angeles',
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
  assert.equal(normalizeRecord(raw).due_at, '2026-10-01T23:00:00.000Z');
});
