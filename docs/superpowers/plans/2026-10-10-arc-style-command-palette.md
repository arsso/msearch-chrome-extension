# Arc-Style Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that opens an Arc-style command palette (tabs, history, bookmarks, web search, commands) over the current page, with a popup-window fallback where overlays cannot be injected.

**Architecture:** A service worker owns all data gathering (`sources.js`), ranking (`ranking.js`), and action execution (`actions.js`, `commands.js`). A content script (`overlay.js`) mounts a closed Shadow DOM and loads the shared UI module (`palette/palette.js`); the same UI runs in `palette/palette.html` inside a popup window as fallback. UI and worker talk only via `chrome.runtime.sendMessage` with three message types: `query`, `execute`, `close`.

**Tech Stack:** Vanilla JS (ES modules), Manifest V3, no build step, `node --test` for unit tests (Node ≥ 20).

**Spec:** `docs/superpowers/specs/2026-10-10-arc-style-command-palette-design.md`

## Global Constraints

- No dependencies, no bundler. The `src/` folder is loaded directly via "Load unpacked".
- Manifest V3; service worker is `"type": "module"`.
- Default shortcut `Ctrl+Shift+K` / mac `Command+Shift+K` (Chrome reserves `Cmd+T`).
- Permissions exactly: `tabs`, `history`, `bookmarks`, `sessions`, `scripting`, `storage`, `activeTab`, `favicon`; host permissions `<all_urls>`, `https://suggestqueries.google.com/*`.
- Result list max 12 items; suggestions max 5; suggestion fetch timeout 800 ms; history window 90 days, max 50 raw rows.
- Type weights: tab 1.0, command 0.9, bookmark 0.8, recentlyClosed 0.7, history 0.6, suggest 0.5.
- Settings in `chrome.storage.sync`: `suggestEnabled` (default `true`), `searchEngine` (`google` | `duckduckgo` | `bing`, default `google`).
- All pure logic (`ranking.js`, `commands.js` matching, `settings.js`) must have no `chrome` global access; Chrome APIs are passed in as an `api` argument so tests can fake them.
- Every task ends with `npm test` green and a commit.

## Review Focus

1. **Query that is only whitespace** (`"   "`) must behave like the empty query (recent tabs + New tab), not produce a `Search Google for ""` row. → test added to Task 2.
2. **Pasted full URL with scheme and query string** (`https://example.com/a?b=1`) must rank `navigate` above `search` and open as-is with no `https://` prefix doubled. → test added to Task 2 and Task 5.
3. **Suggest endpoint slow or offline** must not delay or empty the local results; `gather` returns tabs/history within the timeout. → test added to Task 4.
4. **Shortcut pressed while the fallback window is already open** must focus the existing window rather than open a second one. → test added to Task 6.
5. **Duplicate URL across tab and history** (same page open and in history) must show once, as the tab. → test added to Task 2.

---

### Task 1: Project scaffold and manifest

**Files:**
- Create: `package.json`, `.gitignore`, `src/manifest.json`, `test/manifest.test.js`

**Interfaces:**
- Produces: `src/manifest.json` consumed by Chrome; paths `background.js`, `overlay.js`, `palette/*`, `options.html` fixed for all later tasks.

- [ ] **Step 1: Write the failing test**

`test/manifest.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));

test('manifest is MV3 with module service worker', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.background.type, 'module');
});

test('manifest declares required permissions', () => {
  for (const p of ['tabs', 'history', 'bookmarks', 'sessions', 'scripting', 'storage', 'activeTab', 'favicon']) {
    assert.ok(manifest.permissions.includes(p), `missing permission ${p}`);
  }
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  assert.ok(manifest.host_permissions.includes('https://suggestqueries.google.com/*'));
});

test('manifest wires shortcut, content script and web accessible resources', () => {
  assert.equal(manifest.commands['open-palette'].suggested_key.mac, 'Command+Shift+K');
  assert.equal(manifest.commands['open-palette'].suggested_key.default, 'Ctrl+Shift+K');
  assert.deepEqual(manifest.content_scripts[0].js, ['overlay.js']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
  const resources = manifest.web_accessible_resources[0].resources;
  assert.ok(resources.includes('palette/*'));
  assert.ok(resources.includes('_favicon/*'));
  assert.equal(manifest.options_page, 'options.html');
});
```

- [ ] **Step 2: Create `package.json` and `.gitignore`**

`package.json`:
```json
{
  "name": "msearch",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `ENOENT ... src/manifest.json`

- [ ] **Step 4: Write `src/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "msearch",
  "version": "0.1.0",
  "description": "Arc-style command palette: tabs, history, bookmarks, web search and commands in one box.",
  "permissions": ["tabs", "history", "bookmarks", "sessions", "scripting", "storage", "activeTab", "favicon"],
  "host_permissions": ["<all_urls>", "https://suggestqueries.google.com/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "Open msearch palette" },
  "commands": {
    "open-palette": {
      "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" },
      "description": "Open the msearch palette"
    }
  },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["overlay.js"], "run_at": "document_idle" }
  ],
  "web_accessible_resources": [
    { "resources": ["palette/*", "_favicon/*"], "matches": ["<all_urls>"] }
  ],
  "options_page": "options.html"
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/manifest.json test/manifest.test.js
git commit -m "feat: scaffold MV3 manifest and test runner"
```

---

### Task 2: Pure ranking module

**Files:**
- Create: `src/ranking.js`, `test/ranking.test.js`

**Interfaces:**
- Produces:
  - `isUrlLike(text: string): boolean`
  - `normalizeUrlInput(text: string): string` — adds `https://` when no scheme.
  - `match(query: string, text: string): number | null` — 0..1, `null` when no match.
  - `rank(query: string, candidates: Candidate[], opts?: { now?: number, engineName?: string }): Result[]`
  - `Candidate` = `{ type: 'tab'|'bookmark'|'history'|'recentlyClosed'|'suggest'|'command', title: string, url?: string, lastTime?: number, visitCount?: number, aliases?: string[], tabId?, windowId?, sessionId?, commandId?, query? }`
  - `Result` = Candidate plus `score: number`; tail rows have type `'navigate'` (`url`) or `'search'` (`query`).
  - Constants `TYPE_WEIGHT`, `MAX_RESULTS = 12`.

- [ ] **Step 1: Write the failing tests**

`test/ranking.test.js`:
```js
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

test('tail always ends with search; navigate precedes search for URL-like input', () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/ranking.js'`

- [ ] **Step 3: Write `src/ranking.js`**

```js
// Pure ranking logic. No chrome.* access here.

export const TYPE_WEIGHT = {
  tab: 1.0,
  command: 0.9,
  bookmark: 0.8,
  recentlyClosed: 0.7,
  history: 0.6,
  suggest: 0.5,
};

export const MAX_RESULTS = 12;
const MIN_SCORE = 0.05;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const DEDUPE_PRECEDENCE = ['tab', 'bookmark', 'recentlyClosed', 'history', 'suggest'];

export function isUrlLike(text) {
  const t = (text ?? '').trim();
  if (!t || /\s/.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;
  if (/^localhost(:\d+)?(\/\S*)?$/i.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t);
}

export function normalizeUrlInput(text) {
  const t = text.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
  return `https://${t}`;
}

function lengthFactor(qLen, tLen) {
  return 0.6 + 0.4 * Math.min(1, qLen / Math.max(tLen, 1));
}

export function match(query, text) {
  if (!text) return null;
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = String(text).toLowerCase();
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const atWordStart = idx === 0 || /[\s/.\-_:?=&#(\[]/.test(t[idx - 1]);
    return (atWordStart ? 1.0 : 0.8) * lengthFactor(q.length, t.length);
  }
  if (q.length < 2) return null;
  let from = 0, last = -1, gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found === -1) return null;
    if (last !== -1 && found !== last + 1) gaps++;
    last = found;
    from = found + 1;
  }
  return 0.4 * (1 / (1 + gaps)) * lengthFactor(q.length, t.length);
}

export function recencyFactor(lastTime, now) {
  if (!lastTime) return 0.7;
  const age = now - lastTime;
  if (age < HOUR) return 1.0;
  if (age < DAY) return 0.9;
  if (age < WEEK) return 0.8;
  return 0.7;
}

function visitFactor(visitCount) {
  return Math.min(1.3, 0.8 + Math.log10((visitCount ?? 0) + 1) * 0.5);
}

function bestMatch(query, c) {
  let best = null;
  const consider = (s) => { if (s !== null && (best === null || s > best)) best = s; };
  consider(match(query, c.title));
  for (const a of c.aliases ?? []) consider(match(query, a));
  if (c.url) {
    const u = match(query, c.url);
    if (u !== null) consider(u * 0.85);
  }
  return best;
}

export function scoreCandidate(query, c, now) {
  const m = bestMatch(query, c);
  if (m === null) return null;
  // Commands have no timestamp; they must not be penalised as "old".
  const recency = c.type === 'command' ? 1.0 : recencyFactor(c.lastTime, now);
  let s = m * (TYPE_WEIGHT[c.type] ?? 0.5) * recency;
  if (c.type === 'history') s *= visitFactor(c.visitCount);
  return s;
}

function dedupeKey(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function dedupe(results) {
  const byKey = new Map();
  const out = [];
  for (const r of results) {
    const key = r.type === 'command' || r.type === 'suggest' ? null : dedupeKey(r.url);
    if (!key) { out.push(r); continue; }
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, r); out.push(r); continue; }
    const better = DEDUPE_PRECEDENCE.indexOf(r.type) < DEDUPE_PRECEDENCE.indexOf(existing.type);
    const winner = better ? r : existing;
    const loser = better ? existing : r;
    winner.score = Math.max(winner.score, loser.score);
    if (better) { out[out.indexOf(existing)] = r; byKey.set(key, r); }
  }
  return out;
}

function buildTail(query, engineName) {
  const q = query.trim();
  const tail = [];
  if (isUrlLike(q)) {
    tail.push({ type: 'navigate', title: `Go to ${q}`, url: normalizeUrlInput(q), score: 0 });
  }
  tail.push({ type: 'search', title: `Search ${engineName} for "${q}"`, query: q, score: 0 });
  return tail;
}

export function rank(query, candidates, { now = Date.now(), engineName = 'Google' } = {}) {
  const q = (query ?? '').trim();
  if (!q) {
    const tabs = candidates.filter(c => c.type === 'tab')
      .sort((a, b) => (b.lastTime ?? 0) - (a.lastTime ?? 0))
      .slice(0, 8);
    const commands = candidates.filter(c => c.type === 'command');
    return [...tabs, ...commands].slice(0, MAX_RESULTS).map(c => ({ ...c, score: 0 }));
  }

  const scored = [];
  for (const c of candidates) {
    const score = scoreCandidate(q, c, now);
    if (score !== null && score >= MIN_SCORE) scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const unique = dedupe(scored).sort((a, b) => b.score - a.score);
  const tail = buildTail(q, engineName);
  return [...unique.slice(0, MAX_RESULTS - tail.length), ...tail];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all ranking tests pass. Worked numbers for "type weight orders equal matches": tab 1.0×1.0 = 1.0, command 0.9×1.0 = 0.9, bookmark 0.8×1.0 = 0.8, recentlyClosed 0.7, history 0.6×1.0×0.95 ≈ 0.57, suggest 0.5×0.7 = 0.35.

- [ ] **Step 5: Commit**

```bash
git add src/ranking.js test/ranking.test.js
git commit -m "feat: pure ranking module with fuzzy match, dedupe and tail rows"
```

---

### Task 3: Settings and commands

**Files:**
- Create: `src/settings.js`, `src/commands.js`, `test/settings.test.js`, `test/commands.test.js`

**Interfaces:**
- Produces (`settings.js`):
  - `DEFAULT_SETTINGS = { suggestEnabled: true, searchEngine: 'google' }`
  - `ENGINES = { google: {name, url}, duckduckgo: {...}, bing: {...} }`
  - `getSettings(api): Promise<Settings>` — reads `api.storage.sync`, merges defaults.
  - `searchUrl(engineId: string, query: string): string`
- Produces (`commands.js`):
  - `COMMANDS: { id, title, aliases, description }[]`
  - `commandCandidates(): Candidate[]` — shape consumed by `rank`.
  - `runCommand(id: string, ctx: { tabId?: number, windowId?: number }, api): Promise<{ copy?: string }>`

- [ ] **Step 1: Write the failing tests**

`test/settings.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, searchUrl, DEFAULT_SETTINGS } from '../src/settings.js';

function fakeApi(stored) {
  return { storage: { sync: { get: async () => stored } } };
}

test('getSettings merges stored values over defaults', async () => {
  assert.deepEqual(await getSettings(fakeApi({})), DEFAULT_SETTINGS);
  assert.deepEqual(await getSettings(fakeApi({ searchEngine: 'bing' })), { suggestEnabled: true, searchEngine: 'bing' });
});

test('getSettings falls back to defaults on unknown engine', async () => {
  assert.equal((await getSettings(fakeApi({ searchEngine: 'nope' }))).searchEngine, 'google');
});

test('searchUrl encodes the query per engine', () => {
  assert.equal(searchUrl('google', 'a b&c'), 'https://www.google.com/search?q=a%20b%26c');
  assert.equal(searchUrl('duckduckgo', 'x'), 'https://duckduckgo.com/?q=x');
  assert.equal(searchUrl('bing', 'x'), 'https://www.bing.com/search?q=x');
  assert.equal(searchUrl('unknown', 'x'), 'https://www.google.com/search?q=x');
});
```

`test/commands.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, commandCandidates, runCommand } from '../src/commands.js';
import { rank } from '../src/ranking.js';

test('every command has id, title, aliases and description', () => {
  for (const c of COMMANDS) {
    assert.ok(c.id && c.title && Array.isArray(c.aliases) && c.description, c.id);
  }
  assert.equal(new Set(COMMANDS.map(c => c.id)).size, COMMANDS.length, 'ids unique');
});

test('commandCandidates produce rankable candidates with Turkish aliases', () => {
  const cands = commandCandidates();
  assert.equal(rank('yeni sekme', cands)[0].commandId, 'new-tab');
  assert.equal(rank('geri aç', cands)[0].commandId, 'reopen-closed');
  assert.equal(rank('kopyala', cands)[0].commandId, 'copy-url');
  assert.equal(rank('gizli', cands)[0].commandId, 'incognito');
});

function fakeApi(calls, tab = { id: 5, windowId: 1, url: 'https://x.com/p', title: 'X', pinned: false, mutedInfo: { muted: false } }) {
  const rec = (name) => async (...args) => { calls.push([name, ...args]); return undefined; };
  return {
    tabs: {
      get: async () => tab,
      create: rec('tabs.create'),
      remove: rec('tabs.remove'),
      update: rec('tabs.update'),
      reload: rec('tabs.reload'),
      duplicate: rec('tabs.duplicate'),
    },
    windows: { create: rec('windows.create') },
    sessions: { restore: rec('sessions.restore') },
    bookmarks: { create: rec('bookmarks.create') },
  };
}

test('runCommand maps ids to chrome calls', async () => {
  const ctx = { tabId: 5, windowId: 1 };
  const cases = [
    ['new-tab', ['tabs.create', { active: true }]],
    ['close-tab', ['tabs.remove', 5]],
    ['reopen-closed', ['sessions.restore']],
    ['pin-tab', ['tabs.update', 5, { pinned: true }]],
    ['mute-tab', ['tabs.update', 5, { muted: true }]],
    ['reload', ['tabs.reload', 5]],
    ['duplicate', ['tabs.duplicate', 5]],
    ['incognito', ['windows.create', { incognito: true }]],
    ['bookmark-page', ['bookmarks.create', { title: 'X', url: 'https://x.com/p' }]],
  ];
  for (const [id, expected] of cases) {
    const calls = [];
    await runCommand(id, ctx, fakeApi(calls));
    assert.deepEqual(calls[0], expected, id);
  }
});

test('copy-url returns the url for the UI to write to the clipboard', async () => {
  const calls = [];
  const out = await runCommand('copy-url', { tabId: 5 }, fakeApi(calls));
  assert.deepEqual(out, { copy: 'https://x.com/p' });
  assert.equal(calls.length, 0);
});

test('unknown command throws', async () => {
  await assert.rejects(() => runCommand('nope', {}, fakeApi([])), /Unknown command/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../src/settings.js` / `../src/commands.js`

- [ ] **Step 3: Write `src/settings.js`**

```js
export const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
};

export const DEFAULT_SETTINGS = { suggestEnabled: true, searchEngine: 'google' };

export async function getSettings(api) {
  let stored = {};
  try { stored = (await api.storage.sync.get(DEFAULT_SETTINGS)) ?? {}; } catch { /* keep defaults */ }
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (!ENGINES[merged.searchEngine]) merged.searchEngine = DEFAULT_SETTINGS.searchEngine;
  merged.suggestEnabled = merged.suggestEnabled !== false;
  return merged;
}

export function searchUrl(engineId, query) {
  const engine = ENGINES[engineId] ?? ENGINES.google;
  return engine.url + encodeURIComponent(query);
}
```

- [ ] **Step 4: Write `src/commands.js`**

```js
export const COMMANDS = [
  { id: 'new-tab', title: 'New tab', aliases: ['nt', 'yeni sekme'], description: 'Open a new tab' },
  { id: 'close-tab', title: 'Close tab', aliases: ['ct', 'kapat', 'sekmeyi kapat'], description: 'Close the current tab' },
  { id: 'reopen-closed', title: 'Reopen closed tab', aliases: ['undo', 'geri aç', 'son kapatılan'], description: 'Restore the most recently closed tab' },
  { id: 'copy-url', title: 'Copy URL', aliases: ['url', 'kopyala', 'adresi kopyala'], description: 'Copy the current page address' },
  { id: 'pin-tab', title: 'Pin / Unpin tab', aliases: ['pin', 'sabitle'], description: 'Toggle pinning for the current tab' },
  { id: 'mute-tab', title: 'Mute / Unmute tab', aliases: ['mute', 'sessiz', 'sustur'], description: 'Toggle sound for the current tab' },
  { id: 'reload', title: 'Reload page', aliases: ['refresh', 'yenile'], description: 'Reload the current page' },
  { id: 'duplicate', title: 'Duplicate tab', aliases: ['dup', 'çoğalt'], description: 'Open a copy of the current tab' },
  { id: 'incognito', title: 'New incognito window', aliases: ['gizli', 'private'], description: 'Open a new incognito window' },
  { id: 'bookmark-page', title: 'Bookmark this page', aliases: ['yer imi', 'favori'], description: 'Add the current page to bookmarks' },
];

export function commandCandidates() {
  return COMMANDS.map(c => ({
    type: 'command',
    commandId: c.id,
    title: c.title,
    aliases: c.aliases,
    description: c.description,
  }));
}

async function currentTab(ctx, api) {
  if (ctx.tabId == null) throw new Error('No current tab');
  return api.tabs.get(ctx.tabId);
}

const RUNNERS = {
  'new-tab': async (_ctx, api) => { await api.tabs.create({ active: true }); },
  'close-tab': async (ctx, api) => { await api.tabs.remove((await currentTab(ctx, api)).id); },
  'reopen-closed': async (_ctx, api) => { await api.sessions.restore(); },
  'copy-url': async (ctx, api) => ({ copy: (await currentTab(ctx, api)).url }),
  'pin-tab': async (ctx, api) => { const t = await currentTab(ctx, api); await api.tabs.update(t.id, { pinned: !t.pinned }); },
  'mute-tab': async (ctx, api) => { const t = await currentTab(ctx, api); await api.tabs.update(t.id, { muted: !t.mutedInfo?.muted }); },
  'reload': async (ctx, api) => { await api.tabs.reload((await currentTab(ctx, api)).id); },
  'duplicate': async (ctx, api) => { await api.tabs.duplicate((await currentTab(ctx, api)).id); },
  'incognito': async (_ctx, api) => { await api.windows.create({ incognito: true }); },
  'bookmark-page': async (ctx, api) => { const t = await currentTab(ctx, api); await api.bookmarks.create({ title: t.title, url: t.url }); },
};

export async function runCommand(id, ctx, api) {
  const run = RUNNERS[id];
  if (!run) throw new Error(`Unknown command: ${id}`);
  return (await run(ctx, api)) ?? {};
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/settings.js src/commands.js test/settings.test.js test/commands.test.js
git commit -m "feat: settings with search engines and command definitions/runners"
```

---

### Task 4: Sources (worker-side data gathering)

**Files:**
- Create: `src/sources.js`, `test/sources.test.js`

**Interfaces:**
- Consumes: `commandCandidates()` from `commands.js`.
- Produces: `gather(query: string, ctx: { tabId?: number }, api, settings, { fetchFn = globalThis.fetch, now = Date.now() } = {}): Promise<Candidate[]>`.
  Exported helpers for tests: `tabCandidates(api, ctx)`, `bookmarkCandidates(api, q)`, `historyCandidates(api, q, now)`, `recentlyClosedCandidates(api)`, `suggestCandidates(q, fetchFn, timeoutMs)`.
  Constants: `SUGGEST_TIMEOUT_MS = 800`, `HISTORY_DAYS = 90`, `HISTORY_MAX = 50`, `SUGGEST_MAX = 5`.

- [ ] **Step 1: Write the failing tests**

`test/sources.test.js`:
```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../src/sources.js`

- [ ] **Step 3: Write `src/sources.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/sources.js test/sources.test.js
git commit -m "feat: gather tabs, bookmarks, history, closed tabs, suggestions and commands"
```

---

### Task 5: Actions (execute a result)

**Files:**
- Create: `src/actions.js`, `test/actions.test.js`

**Interfaces:**
- Consumes: `runCommand` from `commands.js`, `searchUrl` from `settings.js`.
- Produces: `execute(result: Result, modifiers: { meta?: boolean }, ctx: { tabId?: number, windowId?: number }, api, settings): Promise<{ copy?: string }>`.

- [ ] **Step 1: Write the failing tests**

`test/actions.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/actions.js';

function fakeApi(calls) {
  const rec = (name) => async (...args) => { calls.push([name, ...args]); return {}; };
  return {
    tabs: { update: rec('tabs.update'), create: rec('tabs.create'), get: async () => ({ id: 9, url: 'https://x.com' }) },
    windows: { update: rec('windows.update') },
    sessions: { restore: rec('sessions.restore') },
  };
}
const settings = { suggestEnabled: true, searchEngine: 'duckduckgo' };
const ctx = { tabId: 9, windowId: 2 };

test('tab result activates the tab and focuses its window', async () => {
  const calls = [];
  await execute({ type: 'tab', tabId: 4, windowId: 3 }, {}, ctx, fakeApi(calls), settings);
  assert.deepEqual(calls, [['tabs.update', 4, { active: true }], ['windows.update', 3, { focused: true }]]);
});

test('url-bearing results open in the current tab, or a new tab with meta', async () => {
  for (const type of ['bookmark', 'history', 'navigate']) {
    let calls = [];
    await execute({ type, url: 'https://a.com' }, {}, ctx, fakeApi(calls), settings);
    assert.deepEqual(calls, [['tabs.update', 9, { url: 'https://a.com' }]], type);
    calls = [];
    await execute({ type, url: 'https://a.com' }, { meta: true }, ctx, fakeApi(calls), settings);
    assert.deepEqual(calls, [['tabs.create', { url: 'https://a.com', active: true }]], type + ' meta');
  }
});

test('navigate keeps a full URL untouched', async () => {
  const calls = [];
  await execute({ type: 'navigate', url: 'https://example.com/a?b=1' }, {}, ctx, fakeApi(calls), settings);
  assert.deepEqual(calls[0], ['tabs.update', 9, { url: 'https://example.com/a?b=1' }]);
});

test('without a current tab, url results open a new tab', async () => {
  const calls = [];
  await execute({ type: 'history', url: 'https://a.com' }, {}, {}, fakeApi(calls), settings);
  assert.deepEqual(calls, [['tabs.create', { url: 'https://a.com', active: true }]]);
});

test('recently closed restores by sessionId', async () => {
  const calls = [];
  await execute({ type: 'recentlyClosed', sessionId: 's1', url: 'https://c.com' }, {}, ctx, fakeApi(calls), settings);
  assert.deepEqual(calls, [['sessions.restore', 's1']]);
});

test('search and suggest build the engine URL from settings', async () => {
  const calls = [];
  await execute({ type: 'search', query: 'a b' }, {}, ctx, fakeApi(calls), settings);
  await execute({ type: 'suggest', query: 'c' }, { meta: true }, ctx, fakeApi(calls), settings);
  assert.deepEqual(calls, [
    ['tabs.update', 9, { url: 'https://duckduckgo.com/?q=a%20b' }],
    ['tabs.create', { url: 'https://duckduckgo.com/?q=c', active: true }],
  ]);
});

test('command delegates to runCommand and forwards copy payload', async () => {
  const out = await execute({ type: 'command', commandId: 'copy-url' }, {}, ctx, fakeApi([]), settings);
  assert.deepEqual(out, { copy: 'https://x.com' });
});

test('unknown result type throws', async () => {
  await assert.rejects(() => execute({ type: 'weird' }, {}, ctx, fakeApi([]), settings), /Unknown result type/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../src/actions.js`

- [ ] **Step 3: Write `src/actions.js`**

```js
import { runCommand } from './commands.js';
import { searchUrl } from './settings.js';

async function openUrl(url, newTab, ctx, api) {
  if (newTab || ctx.tabId == null) {
    await api.tabs.create({ url, active: true });
  } else {
    await api.tabs.update(ctx.tabId, { url });
  }
}

export async function execute(result, modifiers, ctx, api, settings) {
  const newTab = Boolean(modifiers?.meta);
  switch (result.type) {
    case 'tab':
      await api.tabs.update(result.tabId, { active: true });
      await api.windows.update(result.windowId, { focused: true });
      return {};
    case 'bookmark':
    case 'history':
    case 'navigate':
      await openUrl(result.url, newTab, ctx, api);
      return {};
    case 'recentlyClosed':
      if (result.sessionId) await api.sessions.restore(result.sessionId);
      else await openUrl(result.url, newTab, ctx, api);
      return {};
    case 'search':
    case 'suggest':
      await openUrl(searchUrl(settings.searchEngine, result.query), newTab, ctx, api);
      return {};
    case 'command':
      return runCommand(result.commandId, ctx, api);
    default:
      throw new Error(`Unknown result type: ${result.type}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/actions.js test/actions.test.js
git commit -m "feat: execute palette results (tabs, urls, search, commands)"
```

---

### Task 6: Service worker (background.js)

**Files:**
- Create: `src/background.js`, `src/host.js`, `test/host.test.js`

**Interfaces:**
- Consumes: `gather`, `rank`, `execute`, `getSettings`, `ENGINES`.
- Produces (`host.js`, testable): `createHostController(api)` returning
  - `openPalette(): Promise<void>` — toggle overlay in the active tab, inject if needed, else fallback window.
  - `fallbackCtx(): { tabId?, windowId? }` — origin tab for the fallback window.
  - `closeFallback(): Promise<void>`
  - `handleWindowRemoved(windowId)`, `handleFocusChanged(windowId)`
- Message protocol (UI → worker): `{type:'query', text, seq}` → `{results, seq}`; `{type:'execute', result, modifiers}` → `{ok:true, copy?}` or `{ok:false, error}`; `{type:'close'}` → `{ok:true}`.

- [ ] **Step 1: Write the failing tests**

`test/host.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostController, canInject } from '../src/host.js';

test('canInject rejects browser-internal and store pages', () => {
  assert.equal(canInject('https://example.com'), true);
  assert.equal(canInject('http://localhost:3000'), true);
  assert.equal(canInject('chrome://extensions'), false);
  assert.equal(canInject('chrome-extension://abc/palette/palette.html'), false);
  assert.equal(canInject('https://chromewebstore.google.com/detail/x'), false);
  assert.equal(canInject('about:blank'), false);
  assert.equal(canInject(undefined), false);
});

function fakeApi({ sendResult, injectOk = true, activeTab = { id: 1, windowId: 10, url: 'https://e.com' } }) {
  const calls = [];
  const api = {
    calls,
    tabs: {
      query: async () => (activeTab ? [activeTab] : []),
      sendMessage: async (tabId, msg) => { calls.push(['sendMessage', tabId, msg]); if (sendResult instanceof Error) throw sendResult; return sendResult; },
    },
    scripting: { executeScript: async (o) => { calls.push(['inject', o]); if (!injectOk) throw new Error('cannot access'); } },
    windows: {
      get: async () => ({ left: 100, top: 50, width: 1400, height: 900 }),
      create: async (o) => { calls.push(['windows.create', o]); return { id: 77 }; },
      update: async (id, o) => { calls.push(['windows.update', id, o]); },
      remove: async (id) => { calls.push(['windows.remove', id]); },
      WINDOW_ID_NONE: -1,
    },
    runtime: { getURL: (p) => 'chrome-extension://id/' + p },
  };
  return api;
}

test('overlay responds: no injection, no fallback', async () => {
  const api = fakeApi({ sendResult: { ok: true } });
  await createHostController(api).openPalette();
  assert.deepEqual(api.calls.map(c => c[0]), ['sendMessage']);
});

test('overlay missing but injectable: inject then toggle', async () => {
  let n = 0;
  const api = fakeApi({ sendResult: { ok: true } });
  api.tabs.sendMessage = async (tabId, msg) => { api.calls.push(['sendMessage', tabId, msg]); if (n++ === 0) throw new Error('no receiver'); return { ok: true }; };
  await createHostController(api).openPalette();
  assert.deepEqual(api.calls.map(c => c[0]), ['sendMessage', 'inject', 'sendMessage']);
});

test('chrome:// page: opens centered fallback window and remembers origin tab', async () => {
  const api = fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://extensions' } });
  const host = createHostController(api);
  await host.openPalette();
  const create = api.calls.find(c => c[0] === 'windows.create')[1];
  assert.equal(create.type, 'popup');
  assert.equal(create.url, 'chrome-extension://id/palette/palette.html');
  assert.equal(create.left, 100 + Math.round((1400 - create.width) / 2));
  assert.deepEqual(host.fallbackCtx(), { tabId: 5, windowId: 10 });
  assert.ok(!api.calls.some(c => c[0] === 'inject'), 'no injection attempted on chrome://');
});

test('shortcut again while fallback open focuses the existing window', async () => {
  const api = fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://extensions' } });
  const host = createHostController(api);
  await host.openPalette();
  await host.openPalette();
  assert.equal(api.calls.filter(c => c[0] === 'windows.create').length, 1);
  assert.deepEqual(api.calls.at(-1), ['windows.update', 77, { focused: true }]);
});

test('fallback closes when another window gains focus, stays when Chrome loses focus', async () => {
  const api = fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://extensions' } });
  const host = createHostController(api);
  await host.openPalette();
  await host.handleFocusChanged(-1);
  assert.ok(!api.calls.some(c => c[0] === 'windows.remove'));
  await host.handleFocusChanged(77);
  assert.ok(!api.calls.some(c => c[0] === 'windows.remove'));
  await host.handleFocusChanged(10);
  assert.ok(api.calls.some(c => c[0] === 'windows.remove' && c[1] === 77));
  host.handleWindowRemoved(77);
  assert.deepEqual(host.fallbackCtx(), {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `../src/host.js`

- [ ] **Step 3: Write `src/host.js`**

```js
const FALLBACK_WIDTH = 640;
const FALLBACK_HEIGHT = 440;

export function canInject(url) {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) return false;
  if (/^https:\/\/chromewebstore\.google\.com\//i.test(url)) return false;
  if (/^https:\/\/chrome\.google\.com\/webstore/i.test(url)) return false;
  return true;
}

export function createHostController(api) {
  let fallback = { windowId: null, originTabId: undefined, originWindowId: undefined };

  async function sendToggle(tabId) {
    try {
      const r = await api.tabs.sendMessage(tabId, { type: 'toggle' });
      return r?.ok === true;
    } catch {
      return false;
    }
  }

  async function openFallback(tab) {
    if (fallback.windowId != null) {
      try { await api.windows.update(fallback.windowId, { focused: true }); return; } catch { fallback = { windowId: null }; }
    }
    let left, top;
    try {
      const cur = tab ? await api.windows.get(tab.windowId) : null;
      if (cur && cur.width) {
        left = Math.round(cur.left + (cur.width - FALLBACK_WIDTH) / 2);
        top = Math.round(cur.top + Math.min(120, cur.height / 5));
      }
    } catch { /* default position */ }
    const win = await api.windows.create({
      url: api.runtime.getURL('palette/palette.html'),
      type: 'popup',
      width: FALLBACK_WIDTH,
      height: FALLBACK_HEIGHT,
      left,
      top,
      focused: true,
    });
    fallback = { windowId: win.id, originTabId: tab?.id, originWindowId: tab?.windowId };
  }

  async function openPalette() {
    const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return openFallback(null);
    if (tab.windowId === fallback.windowId) return openFallback(tab);
    if (await sendToggle(tab.id)) return;
    if (canInject(tab.url)) {
      try {
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
        if (await sendToggle(tab.id)) return;
      } catch { /* fall through */ }
    }
    await openFallback(tab);
  }

  function fallbackCtx() {
    if (fallback.windowId == null) return {};
    return { tabId: fallback.originTabId, windowId: fallback.originWindowId };
  }

  async function closeFallback() {
    if (fallback.windowId == null) return;
    const id = fallback.windowId;
    fallback = { windowId: null };
    try { await api.windows.remove(id); } catch { /* already gone */ }
  }

  function handleWindowRemoved(windowId) {
    if (windowId === fallback.windowId) fallback = { windowId: null };
  }

  async function handleFocusChanged(windowId) {
    if (fallback.windowId == null) return;
    if (windowId === api.windows.WINDOW_ID_NONE || windowId === fallback.windowId) return;
    await closeFallback();
  }

  return { openPalette, fallbackCtx, closeFallback, handleWindowRemoved, handleFocusChanged, isFallbackWindow: (id) => id === fallback.windowId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Write `src/background.js`**

```js
import { gather } from './sources.js';
import { rank } from './ranking.js';
import { execute } from './actions.js';
import { getSettings, ENGINES } from './settings.js';
import { createHostController } from './host.js';

const host = createHostController(chrome);

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-palette') host.openPalette();
});
chrome.action.onClicked.addListener(() => host.openPalette());
chrome.windows.onRemoved.addListener((id) => host.handleWindowRemoved(id));
chrome.windows.onFocusChanged.addListener((id) => host.handleFocusChanged(id));

function ctxFor(sender) {
  if (sender.tab && !host.isFallbackWindow(sender.tab.windowId)) {
    return { tabId: sender.tab.id, windowId: sender.tab.windowId };
  }
  return host.fallbackCtx();
}

async function handle(msg, sender) {
  const ctx = ctxFor(sender);
  switch (msg?.type) {
    case 'query': {
      const settings = await getSettings(chrome);
      const candidates = await gather(msg.text ?? '', ctx, chrome, settings);
      const results = rank(msg.text ?? '', candidates, { engineName: ENGINES[settings.searchEngine].name });
      return { results, seq: msg.seq };
    }
    case 'execute': {
      const settings = await getSettings(chrome);
      const out = await execute(msg.result, msg.modifiers ?? {}, ctx, chrome, settings);
      return { ok: true, ...out };
    }
    case 'close': {
      if (!sender.tab || host.isFallbackWindow(sender.tab.windowId)) await host.closeFallback();
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e), seq: msg?.seq }));
  return true;
});
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test`
Expected: all pass (background.js is not unit-tested; it only wires `chrome` to tested modules).

```bash
git add src/host.js src/background.js test/host.test.js
git commit -m "feat: service worker with overlay/fallback host controller and message handling"
```

---

### Task 7: Palette UI module and styles

**Files:**
- Create: `src/palette/palette.css`, `src/palette/palette.js`

**Interfaces:**
- Produces: `createPalette({ root: ShadowRoot | HTMLElement, host: 'overlay' | 'window', send: (msg) => Promise<any>, onClose?: () => void, faviconUrl?: (url) => string }) → { open(), close(), isOpen() }`.
- Consumes message protocol from Task 6.

- [ ] **Step 1: Write `src/palette/palette.css`**

```css
.ms-root { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; font-size: 14px; color: #1d1d1f; --ms-bg: rgba(255,255,255,0.92); --ms-border: rgba(0,0,0,0.08); --ms-muted: #6e6e73; --ms-sel: rgba(0,0,0,0.06); --ms-accent: #5b6cff; }
@media (prefers-color-scheme: dark) {
  .ms-root { color: #f5f5f7; --ms-bg: rgba(32,32,36,0.94); --ms-border: rgba(255,255,255,0.1); --ms-muted: #a1a1a6; --ms-sel: rgba(255,255,255,0.08); }
}
.ms-root[hidden] { display: none !important; }
.ms-root[data-host="overlay"] { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: flex-start; justify-content: center; padding-top: 14vh; }
.ms-root[data-host="window"] { position: fixed; inset: 0; display: block; }
.ms-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.25); }
.ms-root[data-host="window"] .ms-backdrop { display: none; }
.ms-panel { position: relative; width: min(640px, calc(100vw - 32px)); background: var(--ms-bg); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border: 1px solid var(--ms-border); border-radius: 14px; box-shadow: 0 24px 80px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column; }
.ms-root[data-host="window"] .ms-panel { width: 100%; height: 100%; border: 0; border-radius: 0; box-shadow: none; }
.ms-inputwrap { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--ms-border); }
.ms-inputwrap svg { width: 18px; height: 18px; flex: none; opacity: 0.6; }
.ms-input { all: unset; flex: 1; font: inherit; font-size: 18px; color: inherit; min-width: 0; }
.ms-input::placeholder { color: var(--ms-muted); }
.ms-list { list-style: none; margin: 0; padding: 6px; max-height: 420px; overflow-y: auto; }
.ms-root[data-host="window"] .ms-list { max-height: none; flex: 1; }
.ms-item { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; cursor: default; }
.ms-item[aria-selected="true"] { background: var(--ms-sel); }
.ms-icon { width: 20px; height: 20px; flex: none; display: grid; place-items: center; border-radius: 5px; background: var(--ms-sel); color: var(--ms-muted); font-size: 11px; font-weight: 600; overflow: hidden; }
.ms-icon img { width: 16px; height: 16px; }
.ms-icon svg { width: 14px; height: 14px; }
.ms-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ms-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-sub { font-size: 12px; color: var(--ms-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-tag { flex: none; font-size: 11px; color: var(--ms-muted); border: 1px solid var(--ms-border); border-radius: 6px; padding: 2px 6px; }
.ms-item[aria-selected="true"] .ms-tag { color: var(--ms-accent); border-color: var(--ms-accent); }
.ms-error { color: #d93025; font-size: 12px; padding: 4px 16px 8px; }
.ms-error:empty { display: none; }
.ms-footer { display: flex; gap: 14px; padding: 8px 16px; border-top: 1px solid var(--ms-border); font-size: 11px; color: var(--ms-muted); }
.ms-footer kbd { font: inherit; }
```

- [ ] **Step 2: Write `src/palette/palette.js`**

```js
const DEBOUNCE_MS = 60;

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  navigate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  command: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 17 6-5-6-5M12 19h8"/></svg>',
  suggest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

const TAGS = {
  tab: 'Switch to tab',
  command: 'Command',
  bookmark: 'Bookmark',
  history: 'History',
  recentlyClosed: 'Recently closed',
  suggest: 'Search',
  search: 'Search',
  navigate: 'Go to',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url ?? ''; }
}

export function createPalette({ root, host, send, onClose = () => {}, faviconUrl = null }) {
  const rootEl = el('div', 'ms-root');
  rootEl.dataset.host = host;
  rootEl.hidden = true;
  rootEl.innerHTML = `
    <div class="ms-backdrop"></div>
    <div class="ms-panel" role="dialog" aria-label="Command palette">
      <div class="ms-inputwrap">${ICONS.search}<input class="ms-input" placeholder="Search tabs, history, bookmarks, or the web…" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <ul class="ms-list" role="listbox"></ul>
      <div class="ms-error" role="alert"></div>
      <div class="ms-footer"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>⌘↵</kbd> new tab</span><span><kbd>esc</kbd> close</span></div>
    </div>`;
  root.append(rootEl);

  const input = rootEl.querySelector('.ms-input');
  const list = rootEl.querySelector('.ms-list');
  const errorEl = rootEl.querySelector('.ms-error');

  let open = false;
  let results = [];
  let selected = 0;
  let seq = 0;
  let timer = null;

  function render() {
    list.replaceChildren();
    results.forEach((r, i) => {
      const li = el('li', 'ms-item');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === selected));
      li.dataset.index = String(i);

      const icon = el('span', 'ms-icon');
      if (ICONS[r.type]) icon.innerHTML = ICONS[r.type];
      else if (faviconUrl && r.url) {
        const img = document.createElement('img');
        img.src = faviconUrl(r.url);
        img.alt = '';
        img.onerror = () => { img.remove(); icon.textContent = (hostOf(r.url)[0] ?? '?').toUpperCase(); };
        icon.append(img);
      } else icon.textContent = (hostOf(r.url)[0] ?? '?').toUpperCase();

      const text = el('div', 'ms-text');
      text.append(el('div', 'ms-title', r.title));
      const sub = r.type === 'command' ? r.description : (r.url ? hostOf(r.url) : '');
      if (sub) text.append(el('div', 'ms-sub', sub));

      li.append(icon, text, el('span', 'ms-tag', TAGS[r.type] ?? r.type));
      li.addEventListener('mousemove', () => { if (selected !== i) { selected = i; updateSelection(); } });
      li.addEventListener('click', (e) => { selected = i; choose({ meta: e.metaKey || e.ctrlKey }); });
      list.append(li);
    });
  }

  function updateSelection() {
    for (const li of list.children) {
      const on = Number(li.dataset.index) === selected;
      li.setAttribute('aria-selected', String(on));
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  }

  async function query(text) {
    const mySeq = ++seq;
    let res;
    try { res = await send({ type: 'query', text, seq: mySeq }); } catch (e) { showError(e?.message ?? String(e)); return; }
    if (!res || res.seq !== mySeq || !open) return;
    if (res.ok === false) { showError(res.error ?? 'Search failed'); return; }
    results = res.results ?? [];
    selected = 0;
    showError('');
    render();
  }

  function scheduleQuery() {
    clearTimeout(timer);
    timer = setTimeout(() => query(input.value), DEBOUNCE_MS);
  }

  function showError(msg) { errorEl.textContent = msg; }

  async function choose(modifiers) {
    const r = results[selected];
    if (!r) return;
    let res;
    try { res = await send({ type: 'execute', result: r, modifiers }); } catch (e) { showError(e?.message ?? String(e)); return; }
    if (!res?.ok) { showError(res?.error ? `Couldn't do that: ${res.error}` : "Couldn't do that"); return; }
    if (res.copy) { try { await navigator.clipboard.writeText(res.copy); } catch { showError('Clipboard blocked by the page'); return; } }
    close();
  }

  function onKey(e) {
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown': selected = Math.min(results.length - 1, selected + 1); updateSelection(); break;
      case 'ArrowUp': selected = Math.max(0, selected - 1); updateSelection(); break;
      case 'Tab': selected = e.shiftKey ? Math.max(0, selected - 1) : Math.min(results.length - 1, selected + 1); updateSelection(); break;
      case 'Enter': choose({ meta: e.metaKey || e.ctrlKey }); break;
      case 'Escape': close(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  rootEl.addEventListener('keydown', onKey);
  for (const type of ['keyup', 'keypress']) rootEl.addEventListener(type, (e) => e.stopPropagation());
  input.addEventListener('input', scheduleQuery);
  rootEl.querySelector('.ms-backdrop').addEventListener('click', () => close());

  function openPalette() {
    if (open) return;
    open = true;
    rootEl.hidden = false;
    input.value = '';
    results = [];
    selected = 0;
    showError('');
    render();
    input.focus();
    query('');
  }

  function close() {
    if (!open) return;
    open = false;
    clearTimeout(timer);
    rootEl.hidden = true;
    input.blur();
    onClose();
  }

  return { open: openPalette, close, isOpen: () => open };
}
```

- [ ] **Step 3: Run tests (unchanged) and commit**

Run: `npm test`
Expected: all pass.

```bash
git add src/palette/palette.css src/palette/palette.js
git commit -m "feat: shared palette UI module with keyboard navigation and styles"
```

---

### Task 8: Overlay content script

**Files:**
- Create: `src/overlay.js`

**Interfaces:**
- Consumes: `createPalette` from `palette/palette.js` via dynamic import; responds to `{type:'toggle'}` with `{ok:true}`.

- [ ] **Step 1: Write `src/overlay.js`**

```js
(() => {
  if (window.__msearch) return;
  const state = { palette: null, loading: null };
  window.__msearch = state;

  async function ensurePalette() {
    if (state.palette) return state.palette;
    if (!state.loading) {
      state.loading = (async () => {
        const hostEl = document.createElement('div');
        hostEl.id = 'msearch-host';
        hostEl.style.all = 'initial';
        const shadow = hostEl.attachShadow({ mode: 'closed' });
        const css = await (await fetch(chrome.runtime.getURL('palette/palette.css'))).text();
        const style = document.createElement('style');
        style.textContent = css;
        shadow.append(style);
        const mod = await import(chrome.runtime.getURL('palette/palette.js'));
        (document.documentElement || document.body).append(hostEl);
        state.palette = mod.createPalette({
          root: shadow,
          host: 'overlay',
          send: (msg) => chrome.runtime.sendMessage(msg),
          faviconUrl: (url) => chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'),
        });
        return state.palette;
      })().catch((e) => { state.loading = null; throw e; });
    }
    return state.loading;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type !== 'toggle') return false;
    ensurePalette()
      .then((p) => { if (p.isOpen()) p.close(); else p.open(); respond({ ok: true }); })
      .catch((e) => respond({ ok: false, error: e?.message ?? String(e) }));
    return true;
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add src/overlay.js
git commit -m "feat: overlay content script mounting the palette in a closed shadow root"
```

---

### Task 9: Fallback window page

**Files:**
- Create: `src/palette/palette.html`, `src/palette/window.js`

- [ ] **Step 1: Write `src/palette/palette.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>msearch</title>
  <link rel="stylesheet" href="palette.css">
  <style>
    html, body { margin: 0; height: 100%; background: transparent; }
    @media (prefers-color-scheme: dark) { html, body { background: #202024; } }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="window.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/palette/window.js`**

```js
import { createPalette } from './palette.js';

const palette = createPalette({
  root: document.getElementById('app'),
  host: 'window',
  send: (msg) => chrome.runtime.sendMessage(msg),
  onClose: () => chrome.runtime.sendMessage({ type: 'close' }).catch(() => window.close()),
  faviconUrl: (url) => chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'),
});

palette.open();
```

- [ ] **Step 3: Commit**

```bash
git add src/palette/palette.html src/palette/window.js
git commit -m "feat: fallback popup window hosting the palette"
```

---

### Task 10: Options page

**Files:**
- Create: `src/options.html`, `src/options.js`

- [ ] **Step 1: Write `src/options.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>msearch settings</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; color: #1d1d1f; }
    @media (prefers-color-scheme: dark) { body { color: #f5f5f7; background: #1c1c1e; } }
    label { display: block; margin: 18px 0 6px; font-weight: 600; }
    select { font: inherit; padding: 6px 8px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .hint { font-size: 12px; opacity: 0.7; margin-top: 4px; }
    .ok { margin-top: 16px; font-size: 12px; color: #2a9d4b; height: 1em; }
  </style>
</head>
<body>
  <h1>msearch</h1>
  <label for="engine">Search engine</label>
  <select id="engine">
    <option value="google">Google</option>
    <option value="duckduckgo">DuckDuckGo</option>
    <option value="bing">Bing</option>
  </select>
  <label class="row"><input type="checkbox" id="suggest"> Show search suggestions</label>
  <div class="hint">When on, typed text is sent to Google's suggestion endpoint.</div>
  <div class="hint">Shortcut: change it at <code>chrome://extensions/shortcuts</code>.</div>
  <div class="ok" id="ok"></div>
  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/options.js`**

```js
import { getSettings } from './settings.js';

const engine = document.getElementById('engine');
const suggest = document.getElementById('suggest');
const ok = document.getElementById('ok');

const settings = await getSettings(chrome);
engine.value = settings.searchEngine;
suggest.checked = settings.suggestEnabled;

async function save() {
  await chrome.storage.sync.set({ searchEngine: engine.value, suggestEnabled: suggest.checked });
  ok.textContent = 'Saved';
  setTimeout(() => { ok.textContent = ''; }, 1200);
}

engine.addEventListener('change', save);
suggest.addEventListener('change', save);
```

- [ ] **Step 3: Commit**

```bash
git add src/options.html src/options.js
git commit -m "feat: options page for search engine and suggestions"
```

---

### Task 11: README with manual verification checklist, then manual verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# msearch

Arc-style command palette for Chrome: one box for open tabs, history, bookmarks,
web search and browser commands.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `src/` folder.
3. Shortcut is `⌘⇧K` (`Ctrl+Shift+K` on Windows/Linux). Change it at `chrome://extensions/shortcuts`.
   Chrome does not let extensions take `⌘T`.
4. Reload any tabs that were already open before installing (content scripts only attach to new loads;
   the extension injects on demand, but a reload is the sure path).

## Usage

- `↑ ↓` or `Tab` to move, `↵` to open, `⌘↵` to open in a new tab, `Esc` to close.
- Empty box shows your most recent tabs. Type to search tabs, bookmarks, history, suggestions and commands.
- Type a URL or domain to get a **Go to** row.
- Commands (also by Turkish alias): New tab, Close tab, Reopen closed tab, Copy URL, Pin / Unpin tab,
  Mute / Unmute tab, Reload page, Duplicate tab, New incognito window, Bookmark this page.

## Settings

Right-click the extension icon → Options: search engine (Google / DuckDuckGo / Bing) and whether
to fetch search suggestions (sends typed text to Google when on).

## Development

```
npm test
```

### Manual checklist

- [ ] On a normal page (e.g. github.com) the shortcut opens the palette centred over the page; Esc closes.
- [ ] On `chrome://extensions` the shortcut opens the palette in a small popup window; it closes when you click another window.
- [ ] Empty query lists recent tabs; typing part of a tab title and pressing Enter switches to it.
- [ ] Typing a history term shows History rows; `⌘↵` opens it in a new tab.
- [ ] Typing `example.com` shows **Go to example.com** above the search row.
- [ ] `kapat` runs Close tab; `undo` reopens it.
- [ ] `kopyala` copies the URL (paste somewhere to check).
- [ ] On Gmail or GitHub the palette looks the same (no site CSS leaking in) and site shortcuts do not fire while typing.
- [ ] With suggestions off, DevTools → service worker → Network shows no request to suggestqueries.google.com.
- [ ] Clicking outside the panel (the dimmed backdrop) closes it.
```

- [ ] **Step 2: Load the extension and walk the checklist**

Open `chrome://extensions`, Load unpacked → `src/`. Walk each checklist line. Record any failure as a bug and fix it with a test where a pure module is involved (ranking/sources/actions/host), or with a code fix plus a re-walk for UI-only issues. Common issues and fixes:
- Service worker error "Cannot use import statement": confirm `"type": "module"` in the manifest.
- Favicons blank: confirm `"favicon"` permission and `_favicon/*` in `web_accessible_resources`; the fallback letter icon must appear via `onerror`.
- Shortcut does nothing: check `chrome://extensions/shortcuts` for a conflict and reassign.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with install, usage and manual checklist"
```
