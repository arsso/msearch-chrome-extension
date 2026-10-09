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
