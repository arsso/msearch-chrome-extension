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
