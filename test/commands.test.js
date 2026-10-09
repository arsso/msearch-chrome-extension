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
