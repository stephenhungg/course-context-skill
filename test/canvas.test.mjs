import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSources, fetchCanvasSource } from '../src/canvas.mjs';

const config = {
  canvas: { base_url: 'https://canvas.school.edu', courses: [{ id: 42, slug: 'class1' }] },
};

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
