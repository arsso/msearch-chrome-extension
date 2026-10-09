import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUrlLike, normalizeUrlInput, match, rank, MAX_RESULTS } from '../src/ranking.js';

const NOW = 1_800_000_000_000;
const H = 3600_000, D = 24 * H;

test('isUrlLike detects schemes, domains and localhost', () => {
  assert.equal(isUrlLike('https://example.com/a?b=1'), true);
  assert.equal(isUrlLike('example.com'), true);
  assert.equal(isUrlLike('sub.example.co.uk/path'), true);
  assert.equal(isUrlLike('localhost:3000'), true);
  assert.equal(isUrlLike('hello world'), false);
  assert.equal(isUrlLike('github'), false);
  assert.equal(isUrlLike(''), false);
});

test('normalizeUrlInput adds https only when scheme missing', () => {
  assert.equal(normalizeUrlInput('example.com'), 'https://example.com');
  assert.equal(normalizeUrlInput('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normalizeUrlInput('localhost:3000'), 'http://localhost:3000');
});

test('match ranks word-start substring > mid substring > fuzzy > none', () => {
  const wordStart = match('git', 'GitHub - home');
  const mid = match('hub', 'GitHub - home');
  const fuzzy = match('ghb', 'GitHub - home');
  assert.ok(wordStart > mid, 'word start beats mid');
  assert.ok(mid > fuzzy, 'substring beats fuzzy');
  assert.equal(match('zzz', 'GitHub - home'), null);
  assert.equal(match('x', 'GitHub - home'), null, 'single-char fuzzy is not allowed');
});

test('match is case-insensitive and prefers shorter texts', () => {
  assert.ok(match('mail', 'Mail') > match('mail', 'Mail - inbox (42) - very long title here'));
});

test('empty or whitespace query returns recent tabs then commands, no tail', () => {
  const cands = [
    { type: 'tab', title: 'Old', url: 'https://old.com', lastTime: NOW - 5 * D, tabId: 1 },
    { type: 'tab', title: 'New', url: 'https://new.com', lastTime: NOW - H, tabId: 2 },
    { type: 'command', title: 'New tab', commandId: 'new-tab', aliases: ['nt'] },
  ];
  for (const q of ['', '   ']) {
    const r = rank(q, cands, { now: NOW });
    assert.deepEqual(r.map(x => x.title), ['New', 'Old', 'New tab']);
    assert.ok(!r.some(x => x.type === 'search' || x.type === 'navigate'));
  }
});

test('search row always last; URL-like input adds a navigate row first', () => {
  const r1 = rank('cats', [], { now: NOW, engineName: 'Google' });
  assert.deepEqual(r1.map(x => x.type), ['search']);
  assert.equal(r1[0].title, 'Search Google for "cats"');
  assert.equal(r1[0].query, 'cats');

  const r2 = rank('https://example.com/a?b=1', [], { now: NOW });
  assert.deepEqual(r2.map(x => x.type), ['navigate', 'search']);
  assert.equal(r2[0].url, 'https://example.com/a?b=1');
});

test('type weight orders equal matches: tab > command > bookmark > closed > history > suggest', () => {
  const cands = [
    { type: 'suggest', title: 'note', query: 'note' },
    { type: 'history', title: 'note', url: 'https://h.com', lastTime: NOW, visitCount: 1 },
    { type: 'recentlyClosed', title: 'note', url: 'https://c.com', lastTime: NOW, sessionId: 's' },
    { type: 'bookmark', title: 'note', url: 'https://b.com', lastTime: NOW },
    { type: 'command', title: 'note', commandId: 'x', aliases: [] },
    { type: 'tab', title: 'note', url: 'https://t.com', lastTime: NOW, tabId: 1 },
  ];
  const r = rank('note', cands, { now: NOW });
  assert.deepEqual(r.map(x => x.type), ['tab', 'command', 'bookmark', 'recentlyClosed', 'history', 'suggest', 'search']);
});

test('command aliases match', () => {
  const cands = [{ type: 'command', title: 'Close tab', commandId: 'close-tab', aliases: ['ct', 'kapat'] }];
  assert.equal(rank('kapat', cands, { now: NOW })[0].commandId, 'close-tab');
  assert.equal(rank('ct', cands, { now: NOW })[0].commandId, 'close-tab');
});

test('recency and visit count boost', () => {
  const cands = [
    { type: 'history', title: 'docs', url: 'https://a.com', lastTime: NOW - 30 * D, visitCount: 1 },
    { type: 'history', title: 'docs', url: 'https://b.com', lastTime: NOW - H, visitCount: 1 },
    { type: 'history', title: 'docs', url: 'https://c.com', lastTime: NOW - 30 * D, visitCount: 200 },
  ];
  const r = rank('docs', cands, { now: NOW });
  assert.equal(r[0].url, 'https://b.com', 'recent first');
  assert.equal(r[1].url, 'https://c.com', 'then heavily visited');
  assert.equal(r[2].url, 'https://a.com');
});

test('duplicate URLs collapse to the tab entry', () => {
  const cands = [
    { type: 'history', title: 'Site', url: 'https://site.com/', lastTime: NOW, visitCount: 500 },
    { type: 'tab', title: 'Site', url: 'https://site.com', lastTime: NOW - 10 * D, tabId: 7 },
    { type: 'bookmark', title: 'Site', url: 'https://site.com/#top', lastTime: NOW },
  ];
  const r = rank('site', cands, { now: NOW });
  const siteRows = r.filter(x => x.type !== 'search');
  assert.equal(siteRows.length, 1);
  assert.equal(siteRows[0].type, 'tab');
  assert.equal(siteRows[0].tabId, 7);
});

test('result count is capped at MAX_RESULTS including tail', () => {
  const cands = Array.from({ length: 30 }, (_, i) => ({
    type: 'history', title: `note ${i}`, url: `https://n${i}.com`, lastTime: NOW, visitCount: 1,
  }));
  const r = rank('note', cands, { now: NOW });
  assert.equal(r.length, MAX_RESULTS);
  assert.equal(r.at(-1).type, 'search');
});

test('url matches count but less than title matches', () => {
  const cands = [
    { type: 'history', title: 'Something', url: 'https://github.com/x', lastTime: NOW, visitCount: 1 },
    { type: 'history', title: 'GitHub', url: 'https://other.com', lastTime: NOW, visitCount: 1 },
  ];
  const r = rank('github', cands, { now: NOW });
  assert.equal(r[0].title, 'GitHub');
  assert.equal(r[1].url, 'https://github.com/x');
});

test('URL-like input puts the navigate row first, above any match', () => {
  const cands = [
    { type: 'suggest', title: 'example.com tutorial', query: 'example.com tutorial' },
    { type: 'history', title: 'Example', url: 'https://example.com/old', lastTime: NOW, visitCount: 5 },
  ];
  const r = rank('example.com', cands, { now: NOW });
  assert.equal(r[0].type, 'navigate');
  assert.equal(r[0].url, 'https://example.com');
  assert.equal(r.at(-1).type, 'search');
});
