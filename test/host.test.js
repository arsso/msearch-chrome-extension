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
    activeTab,
    tabs: {
      query: async () => (api.activeTab ? [api.activeTab] : []),
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
  assert.ok(create.url.startsWith('chrome-extension://id/palette/palette.html'));
  assert.equal(create.left, 100 + Math.round((1400 - create.width) / 2));
  assert.deepEqual(host.fallbackCtx(), { tabId: 5, windowId: 10 });
  assert.ok(!api.calls.some(c => c[0] === 'inject'), 'no injection attempted on chrome://');
});

test('shortcut again while the fallback window is focused closes it', async () => {
  const api = fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://extensions' } });
  const host = createHostController(api);
  await host.openPalette();
  api.activeTab = { id: 99, windowId: 77, url: api.runtime.getURL('palette/palette.html') };
  await host.openPalette();
  assert.equal(api.calls.filter(c => c[0] === 'windows.create').length, 1);
  assert.ok(api.calls.some(c => c[0] === 'windows.remove' && c[1] === 77));
  assert.deepEqual(host.fallbackCtx(), {});
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

function sessionStore() {
  const data = {};
  return { get: async (k) => (typeof k === 'string' ? { [k]: data[k] } : { ...data }), set: async (o) => Object.assign(data, o), remove: async (k) => { delete data[k]; } };
}

test('popup sender is recognised from its URL without in-memory state', async () => {
  const api = fakeApi({ sendResult: { ok: true } });
  const host = createHostController(api);
  const sender = { tab: { id: 99, windowId: 77 }, url: 'chrome-extension://id/palette/palette.html?tabId=5&windowId=10' };
  assert.equal(host.isPopupSender(sender), true);
  assert.deepEqual(await host.ctxFor(sender), { tabId: 5, windowId: 10 });
  const pageSender = { tab: { id: 3, windowId: 1 }, url: 'https://e.com/' };
  assert.equal(host.isPopupSender(pageSender), false);
  assert.deepEqual(await host.ctxFor(pageSender), { tabId: 3, windowId: 1 });
});

test('action popup sender without origin params resolves to the active tab of the last focused window', async () => {
  const api = fakeApi({ sendResult: { ok: true }, activeTab: { id: 8, windowId: 20, url: 'chrome://newtab' } });
  const host = createHostController(api);
  const sender = { url: 'chrome-extension://id/palette/action.html' };
  assert.equal(host.isPopupSender(sender), true);
  assert.deepEqual(await host.ctxFor(sender), { tabId: 8, windowId: 20 });
});

function withAction(api, { openOk = true } = {}) {
  api.action = { openPopup: async (o) => { api.calls.push(['action.openPopup', o]); if (!openOk) throw new Error('Failed to open popup.'); } };
  return api;
}

test('chrome:// page: opens the toolbar action popup in the current window, never a separate window', async () => {
  const api = withAction(fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://newtab' } }));
  await createHostController(api).openPalette();
  assert.deepEqual(api.calls.map(c => c[0]), ['sendMessage', 'action.openPopup']);
  assert.deepEqual(api.calls[1][1], { windowId: 10 });
});

test('separate window is only a last resort when the action popup cannot open', async () => {
  const api = withAction(fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://newtab' } }), { openOk: false });
  await createHostController(api).openPalette();
  assert.deepEqual(api.calls.map(c => c[0]), ['sendMessage', 'action.openPopup', 'windows.create']);
});

test('shortcut while the action popup is open closes it instead of opening again', async () => {
  const api = withAction(fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://newtab' } }));
  const host = createHostController(api);
  await host.openPalette();
  const sent = [];
  const listeners = [];
  const port = { name: 'action-popup', postMessage: (m) => sent.push(m), onDisconnect: { addListener: (f) => listeners.push(f) } };
  host.trackActionPopup(port);
  await host.openPalette();
  assert.deepEqual(sent, [{ type: 'close' }]);
  assert.equal(api.calls.filter(c => c[0] === 'action.openPopup').length, 1);
  listeners.forEach(f => f());
  await host.openPalette();
  assert.equal(api.calls.filter(c => c[0] === 'action.openPopup').length, 2);
});


test('fallback window URL carries the origin tab', async () => {
  const api = fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://extensions' } });
  await createHostController(api).openPalette();
  const create = api.calls.find(c => c[0] === 'windows.create')[1];
  assert.equal(create.url, 'chrome-extension://id/palette/palette.html?tabId=5&windowId=10');
});

test('close from the popup removes the sender window even after a worker restart', async () => {
  const api = fakeApi({ sendResult: { ok: true } });
  const host = createHostController(api);
  await host.closeFromSender({ tab: { id: 99, windowId: 77 }, url: 'chrome-extension://id/palette/palette.html?tabId=5&windowId=10' });
  assert.deepEqual(api.calls, [['windows.remove', 77]]);
});

test('duplicate-window and focus checks survive a worker restart via storage.session', async () => {
  const store = sessionStore();
  const api = fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://extensions' } });
  api.storage = { session: store };
  await createHostController(api).openPalette();
  assert.equal(api.calls.filter(c => c[0] === 'windows.create').length, 1);

  const api2 = fakeApi({ sendResult: new Error('no receiver'), activeTab: { id: 5, windowId: 10, url: 'chrome://extensions' } });
  api2.storage = { session: store };
  const fresh = createHostController(api2);
  await fresh.openPalette();
  assert.equal(api2.calls.filter(c => c[0] === 'windows.create').length, 0, 'no second popup');
  assert.deepEqual(api2.calls.at(-1), ['windows.update', 77, { focused: true }]);
  await fresh.handleFocusChanged(10);
  assert.ok(api2.calls.some(c => c[0] === 'windows.remove' && c[1] === 77));
});
