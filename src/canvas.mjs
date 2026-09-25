import { safeUrl } from './core.mjs';

const endpoints = [
  ['course', id => `/api/v1/courses/${id}`],
  ['assignments', id => `/api/v1/courses/${id}/assignments?per_page=100`],
  ['announcements', id => `/api/v1/announcements?context_codes[]=course_${id}&per_page=100`],
  ['modules', id => `/api/v1/courses/${id}/modules?per_page=100`],
  ['pages', id => `/api/v1/courses/${id}/pages?per_page=100`],
  ['files', id => `/api/v1/courses/${id}/files?per_page=100`],
  ['quizzes', id => `/api/v1/courses/${id}/quizzes?per_page=100`],
  ['discussions', id => `/api/v1/courses/${id}/discussion_topics?per_page=100`],
  ['calendar-events', id => `/api/v1/calendar_events?context_codes[]=course_${id}&per_page=100`],
];

export function canvasSources(config) {
  const origin = new URL(config.canvas.base_url).origin;
  return config.canvas.courses.flatMap(course => endpoints.map(([kind, route]) => ({
    id: `${course.slug}.canvas.${kind}`,
    course: course.slug,
    kind,
    url: `${origin}${route(course.id)}`,
    display_url: `${origin}/courses/${course.id}`,
  })));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(url, token, origin, fetchImpl) {
  if (new URL(url).origin !== origin || !url.startsWith(`${origin}/api/v1/`)) throw new Error('pagination_origin_mismatch');
  if ([...new URL(url).searchParams.keys()].some(key => /(?:access_token|refresh_token|token|key|secret|password|auth)/i.test(key))) throw new Error('pagination_secret_parameter');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET', redirect: 'manual',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      if (attempt < 2) { await wait(200 * 2 ** attempt); continue; }
      throw new Error('canvas_network_error');
    }
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
      const retry = Number(response.headers.get('retry-after'));
      await wait(Number.isFinite(retry) && retry >= 0 ? Math.min(retry * 1000, 5000) : 200 * 2 ** attempt);
      continue;
    }
    if (!response.ok) throw new Error(`canvas_http_${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('canvas_page_too_large');
    try { return { data: JSON.parse(text), link: response.headers.get('link') }; }
    catch { throw new Error('canvas_invalid_json'); }
  }
  throw new Error('canvas_retry_exhausted');
}

function nextLink(link) {
  if (!link) return null;
  for (const match of link.matchAll(/<([^>]+)>\s*;\s*rel="([^"]+)"/gi)) if (match[2].toLowerCase() === 'next') return match[1];
  return null;
}

export async function fetchCanvasSource(source, token, fetchImpl = fetch) {
  if (!token) throw new Error('canvas_token_missing');
  const origin = new URL(source.url).origin;
  const seen = new Set();
  const items = [];
  let next = source.url;
  while (next) {
    if (seen.size >= 100 || seen.has(next)) throw new Error('canvas_pagination_limit');
    seen.add(next);
    const page = await request(next, token, origin, fetchImpl);
    if (source.kind === 'course') {
      if (!page.data || Array.isArray(page.data) || page.data.id === undefined) throw new Error('canvas_invalid_course');
      return mapItems(source, [page.data]);
    }
    if (!Array.isArray(page.data)) throw new Error('canvas_invalid_list');
    items.push(...page.data);
    next = nextLink(page.link);
  }
  return mapItems(source, items);
}

function stableId(item, index) {
  return String(item.id ?? item.page_id ?? item.url ?? index).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
}

function mapItems(source, items) {
  return items.map((item, index) => {
    const title = item.name ?? item.title ?? item.display_name ?? item.short_name ?? `Item ${index + 1}`;
    const rawUrl = item.html_url ?? item.url ?? source.display_url;
    let url = source.display_url;
    try { url = safeUrl(rawUrl) ?? source.display_url; } catch { /* use configured course link */ }
    const kind = source.kind === 'assignments' ? 'assignment' : source.kind === 'announcements' ? 'announcement' : source.kind === 'calendar-events' ? 'event' : source.kind === 'course' ? 'course' : 'material';
    return {
      id: stableId(item, index), kind, title: String(title), url,
      due_at: kind === 'assignment' || source.kind === 'quizzes' ? item.due_at ?? null : null,
      event_at: kind === 'event' ? item.start_at ?? null : null,
      updated_at: item.updated_at ?? null,
    };
  });
}
