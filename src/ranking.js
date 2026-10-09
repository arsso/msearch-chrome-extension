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
  if (age <= HOUR) return 1.0;
  if (age <= DAY) return 0.9;
  if (age <= WEEK) return 0.8;
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

function navigateRow(q) {
  if (!isUrlLike(q)) return null;
  return { type: 'navigate', title: `Go to ${q}`, url: normalizeUrlInput(q), score: 0 };
}

function searchRow(q, engineName) {
  return { type: 'search', title: `Search ${engineName} for "${q}"`, query: q, score: 0 };
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
  // A typed URL goes first (like Arc's "Go to"); the web search row always closes the list.
  const head = navigateRow(q) ? [navigateRow(q)] : [];
  const tail = [searchRow(q, engineName)];
  return [...head, ...unique.slice(0, MAX_RESULTS - head.length - tail.length), ...tail];
}
