import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gather, suggestCandidates, SUGGEST_TIMEOUT_MS } from '../src/sources.js';

const NOW = 1_800_000_000_000;

function fakeApi(over = {}) {
  return {
    tabs: { query: async () => [
      { id: 1, windowId: 1, title: 'Current', url: 'https://cur.com', lastAccessed: NOW },
      { id: 2, windowId: 1, title: 'Other', url: 'https://other.com', lastAccessed: NOW - 1000 },
      { id: 3, windowId: 2, title: '', url: 'https://untitled.com', lastAccessed: NOW - 2000 },
    ] },
    bookmarks: { search: async () => [
      { id: 'b1', title: 'BM', url: 'https://bm.com', dateAdded: NOW },
      { id: 'f1', title: 'Folder' },
    ] },
    history: { search: async (opts) => {
      fakeApi.lastHistoryOpts = opts;
      return [{ url: 'https://h.com', title: 'H', lastVisitTime: NOW, visitCount: 3 }];
    } },
    sessions: { getRecentlyClosed: async () => [
      { lastModified: NOW / 1000, tab: { sessionId: 's1', title: 'Closed', url: 'https://closed.com' } },
      { lastModified: NOW / 1000, window: { sessionId: 'w1' } },
    ] },
    ...over,
  };
}

const okFetch = async () => ({ ok: true, json: async () => ['q', ['one', 'two', 'three', 'four', 'five', 'six']] });
const settings = { suggestEnabled: true, searchEngine: 'google' };

test('empty query yields other tabs (not current) and only the New tab command', async () => {
  const cands = await gather('', { tabId: 1 }, fakeApi(), settings, { fetchFn: okFetch, now: NOW });
  const tabs = cands.filter(c => c.type === 'tab');
  assert.deepEqual(tabs.map(t => t.tabId), [2, 3]);
  assert.equal(tabs[1].title, 'https://untitled.com', 'untitled tab falls back to url');
  const cmds = cands.filter(c => c.type === 'command');
  assert.deepEqual(cmds.map(c => c.commandId), ['new-tab']);
  assert.ok(!cands.some(c => c.type === 'suggest' || c.type === 'history'));
});

test('non-empty query gathers every source with the right shapes', async () => {
  const cands = await gather('x', { tabId: 1 }, fakeApi(), settings, { fetchFn: okFetch, now: NOW });
  const types = new Set(cands.map(c => c.type));
  for (const t of ['tab', 'bookmark', 'history', 'recentlyClosed', 'suggest', 'command']) assert.ok(types.has(t), t);
  assert.ok(!cands.some(c => c.type === 'bookmark' && !c.url), 'folders excluded');
  const closed = cands.find(c => c.type === 'recentlyClosed');
  assert.equal(closed.sessionId, 's1');
  assert.equal(closed.lastTime, NOW);
  const hist = cands.find(c => c.type === 'history');
  assert.equal(hist.visitCount, 3);
  assert.equal(fakeApi.lastHistoryOpts.maxResults, 50);
  assert.ok(fakeApi.lastHistoryOpts.startTime <= NOW - 89 * 86400_000);
  assert.equal(cands.filter(c => c.type === 'suggest').length, 5, 'suggest capped at 5');
  assert.equal(cands.filter(c => c.type === 'command').length, 10, 'all commands offered for ranking');
});

test('suggestions skipped when disabled; no fetch call', async () => {
  let called = false;
  const cands = await gather('x', { tabId: 1 }, fakeApi(), { ...settings, suggestEnabled: false }, { fetchFn: async () => { called = true; }, now: NOW });
  assert.equal(called, false);
  assert.ok(!cands.some(c => c.type === 'suggest'));
});

test('a failing source is skipped, others still returned', async () => {
  const api = fakeApi({ history: { search: async () => { throw new Error('boom'); } } });
  const cands = await gather('x', { tabId: 1 }, api, settings, { fetchFn: async () => { throw new Error('net'); }, now: NOW });
  assert.ok(cands.some(c => c.type === 'tab'));
  assert.ok(!cands.some(c => c.type === 'history'));
  assert.ok(!cands.some(c => c.type === 'suggest'));
});

test('slow suggest endpoint is abandoned after the timeout', async () => {
  const slowFetch = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const start = Date.now();
  const out = await suggestCandidates('x', slowFetch, 30);
  assert.deepEqual(out, []);
  assert.ok(Date.now() - start < SUGGEST_TIMEOUT_MS);
});
