import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSources, fetchCanvasSource } from '../src/canvas.mjs';

const config = {
  term_window: { start_date: '2026-08-15', end_date: '2026-12-31' },
  canvas: { base_url: 'https://canvas.school.edu', courses: [{ id: 42, slug: 'class1' }] },
};

test('calendar request uses the full configured term instead of Canvas today-only defaults', async () => {
  const source = canvasSources(config).find(item => item.kind === 'calendar-events');
  const url = new URL(source.url);
  assert.equal(url.searchParams.get('start_date'), '2026-08-15');
  assert.equal(url.searchParams.get('end_date'), '2026-12-31');
  assert.equal(url.searchParams.get('type'), 'event');
  const items = await fetchCanvasSource(source, 'test-token', async () => new Response(JSON.stringify([
    { id: 1, title: 'Lecture', start_at: '2026-09-01T10:00:00-07:00', workflow_state: 'active' },
    { id: 2, title: 'Cancelled', start_at: '2026-09-02T10:00:00-07:00', workflow_state: 'deleted' },
    { id: 3, title: 'Holiday', all_day: true, all_day_date: '2026-11-26', start_at: '2026-11-26T00:00:00-08:00' },
  ])));
  assert.deepEqual(items.map(item => item.title), ['Lecture', 'Holiday']);
  assert.equal(items[0].due_at, null);
  assert.equal(items[0].event_at, '2026-09-01T10:00:00-07:00');
  assert.equal(items[1].event_date, '2026-11-26');
  assert.equal(items[1].event_at, null);
});

test('follows Canvas opaque next links without leaking a token to another origin', async () => {
  const source = canvasSources(config).find(item => item.kind === 'assignments');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(JSON.stringify([{ id: 1, name: 'First' }]), {
      headers: { link: '<https://canvas.school.edu/api/v1/courses/42/assignments?page=opaque>; rel="next"' },
    });
    return new Response(JSON.stringify([{ id: 2, name: 'Second' }]));
  };
  const items = await fetchCanvasSource(source, 'test-token', fetchImpl);
  assert.deepEqual(items.map(item => item.title), ['First', 'Second']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token');

  let called = 0;
  await assert.rejects(fetchCanvasSource(source, 'test-token', async () => {
    called++;
    return new Response('[]', { headers: { link: '<https://attacker.example/api/v1/steal>; rel="next"' } });
  }), /pagination_origin_mismatch/);
  assert.equal(called, 1);
});

test('does not retry authorization failures or follow redirects', async () => {
  const source = canvasSources(config).find(item => item.kind === 'assignments');
  let calls = 0;
  await assert.rejects(fetchCanvasSource(source, 'test-token', async () => { calls++; return new Response('', { status: 403 }); }), /canvas_http_403/);
  assert.equal(calls, 1);
  await assert.rejects(fetchCanvasSource(source, 'test-token', async () => new Response('', { status: 302 })), /canvas_http_302/);
});

test('stops when Canvas requests a retry beyond the bounded wait', async () => {
  const source = canvasSources(config).find(item => item.kind === 'assignments');
  let calls = 0;
  await assert.rejects(fetchCanvasSource(source, 'test-token', async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'retry-after': '30' } });
  }), /canvas_retry_after_too_long/);
  assert.equal(calls, 1);
});

test('enforces a total source budget before starting an over-budget request', async () => {
  const source = canvasSources(config).find(item => item.kind === 'assignments');
  let called = false;
  await assert.rejects(fetchCanvasSource(source, 'test-token', async () => { called = true; return new Response('[]'); }, { budgetMs: 0 }), /canvas_source_timeout/);
  assert.equal(called, false);
});

test('different page slugs that normalize alike retain distinct stable IDs', async () => {
  const source = canvasSources(config).find(item => item.kind === 'pages');
  const records = await fetchCanvasSource(source, 'test-token', async () => new Response(JSON.stringify([
    { url: 'a/b', title: 'Page one' },
    { url: 'a-b', title: 'Page two' },
  ])));
  assert.notEqual(records[0].id, records[1].id);
});
