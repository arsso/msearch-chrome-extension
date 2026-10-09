import { commandCandidates } from './commands.js';

export const SUGGEST_TIMEOUT_MS = 800;
export const HISTORY_DAYS = 90;
export const HISTORY_MAX = 50;
export const SUGGEST_MAX = 5;

const DAY = 86400_000;

export async function tabCandidates(api, ctx) {
  const tabs = await api.tabs.query({});
  return tabs
    .filter(t => t.id !== ctx.tabId && t.url)
    .map(t => ({
      type: 'tab',
      tabId: t.id,
      windowId: t.windowId,
      title: t.title || t.url,
      url: t.url,
      lastTime: t.lastAccessed ?? 0,
    }));
}

export async function bookmarkCandidates(api, q) {
  const nodes = await api.bookmarks.search(q);
  return nodes.filter(n => n.url).map(n => ({
    type: 'bookmark',
    title: n.title || n.url,
    url: n.url,
    lastTime: n.dateAdded ?? 0,
  }));
}

export async function historyCandidates(api, q, now) {
  const items = await api.history.search({
    text: q,
    startTime: now - HISTORY_DAYS * DAY,
    maxResults: HISTORY_MAX,
  });
  return items.filter(i => i.url).map(i => ({
    type: 'history',
    title: i.title || i.url,
    url: i.url,
    lastTime: i.lastVisitTime ?? 0,
    visitCount: i.visitCount ?? 1,
  }));
}

export async function recentlyClosedCandidates(api) {
  const sessions = await api.sessions.getRecentlyClosed({ maxResults: 10 });
  return sessions.filter(s => s.tab && s.tab.url).map(s => ({
    type: 'recentlyClosed',
    sessionId: s.tab.sessionId,
    title: s.tab.title || s.tab.url,
    url: s.tab.url,
    lastTime: (s.lastModified ?? 0) * 1000,
  }));
}

export async function suggestCandidates(q, fetchFn, timeoutMs = SUGGEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = 'https://suggestqueries.google.com/complete/search?client=chrome&q=' + encodeURIComponent(q);
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res?.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data?.[1]) ? data[1] : [];
    return list.slice(0, SUGGEST_MAX).map(s => ({ type: 'suggest', title: String(s), query: String(s) }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function gather(query, ctx, api, settings, { fetchFn = globalThis.fetch, now = Date.now() } = {}) {
  const q = (query ?? '').trim();
  if (!q) {
    const tabs = await tabCandidates(api, ctx).catch(() => []);
    return [...tabs, ...commandCandidates().filter(c => c.commandId === 'new-tab')];
  }
  const jobs = [
    tabCandidates(api, ctx),
    bookmarkCandidates(api, q),
    historyCandidates(api, q, now),
    recentlyClosedCandidates(api),
    settings.suggestEnabled ? suggestCandidates(q, fetchFn) : Promise.resolve([]),
  ];
  const settled = await Promise.allSettled(jobs);
  const out = [];
  for (const s of settled) if (s.status === 'fulfilled') out.push(...s.value);
  out.push(...commandCandidates());
  return out;
}
