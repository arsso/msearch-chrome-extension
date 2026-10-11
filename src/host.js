const FALLBACK_WIDTH = 640;
const FALLBACK_HEIGHT = 440;
const PALETTE_PAGE = 'palette/palette.html';
const PALETTE_DIR = 'palette/';
const ACTION_PORT = 'action-popup';
const STATE_KEY = 'msearchFallback';

export function canInject(url) {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) return false;
  if (/^https:\/\/chromewebstore\.google\.com\//i.test(url)) return false;
  if (/^https:\/\/chrome\.google\.com\/webstore/i.test(url)) return false;
  return true;
}

function parseOrigin(url) {
  try {
    const p = new URL(url).searchParams;
    const tabId = Number(p.get('tabId'));
    const windowId = Number(p.get('windowId'));
    return {
      ...(Number.isFinite(tabId) && p.has('tabId') ? { tabId } : {}),
      ...(Number.isFinite(windowId) && p.has('windowId') ? { windowId } : {}),
    };
  } catch {
    return {};
  }
}

export function createHostController(api) {
  // The MV3 worker can be killed at any time; the only durable copy of the
  // fallback state lives in storage.session, and the popup's own URL carries
  // its origin tab so it stays usable after a restart.
  let fallback = { windowId: null, originTabId: undefined, originWindowId: undefined };
  const session = api.storage?.session;
  // Open toolbar action popups, by their runtime port. A port keeps the worker
  // alive, so this set does not need to survive a restart.
  const actionPorts = new Set();

  const ready = (async () => {
    if (!session) return;
    try {
      const stored = (await session.get(STATE_KEY))?.[STATE_KEY];
      if (stored && stored.windowId != null) fallback = stored;
    } catch { /* start fresh */ }
  })();

  async function persist() {
    if (!session) return;
    try {
      if (fallback.windowId == null) await session.remove(STATE_KEY);
      else await session.set({ [STATE_KEY]: fallback });
    } catch { /* best effort */ }
  }

  function palettePageUrl() {
    return api.runtime.getURL(PALETTE_PAGE);
  }

  function isPopupSender(sender) {
    return typeof sender?.url === 'string' && sender.url.startsWith(api.runtime.getURL(PALETTE_DIR));
  }

  async function activeTab() {
    const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    return tab;
  }

  async function ctxFor(sender) {
    if (isPopupSender(sender)) {
      const origin = parseOrigin(sender.url);
      if (origin.tabId != null) return origin;
      // The toolbar action popup carries no origin in its URL; it belongs to
      // the window it is anchored to, which is the last focused one.
      const tab = await activeTab();
      return tab ? { tabId: tab.id, windowId: tab.windowId } : {};
    }
    if (sender?.tab && sender.tab.windowId !== fallback.windowId) {
      return { tabId: sender.tab.id, windowId: sender.tab.windowId };
    }
    return fallbackCtx();
  }

  function trackActionPopup(port) {
    if (port?.name !== ACTION_PORT) return false;
    actionPorts.add(port);
    port.onDisconnect.addListener(() => actionPorts.delete(port));
    return true;
  }

  function closeActionPopups() {
    for (const port of actionPorts) {
      try { port.postMessage({ type: 'close' }); } catch { /* already gone */ }
    }
    actionPorts.clear();
  }

  // The toolbar popup is drawn inside the current window, so unlike a separate
  // window it is visible on chrome:// pages and from a macOS fullscreen Space.
  async function openActionPopup(tab) {
    if (typeof api.action?.openPopup !== 'function') return false;
    try {
      await api.action.openPopup({ windowId: tab.windowId });
      return true;
    } catch {
      return false;
    }
  }

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
    const params = new URLSearchParams();
    if (tab?.id != null) params.set('tabId', String(tab.id));
    if (tab?.windowId != null) params.set('windowId', String(tab.windowId));
    const qs = params.toString();
    const win = await api.windows.create({
      url: palettePageUrl() + (qs ? `?${qs}` : ''),
      type: 'popup',
      width: FALLBACK_WIDTH,
      height: FALLBACK_HEIGHT,
      left,
      top,
      focused: true,
    });
    fallback = { windowId: win.id, originTabId: tab?.id, originWindowId: tab?.windowId };
    await persist();
  }

  async function openPalette() {
    await ready;
    if (actionPorts.size) return closeActionPopups();
    const tab = await activeTab();
    if (!tab) return openFallback(null);
    if (tab.windowId === fallback.windowId) return closeFallback();
    if (await sendToggle(tab.id)) return;
    if (canInject(tab.url)) {
      try {
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
        if (await sendToggle(tab.id)) return;
      } catch { /* fall through */ }
    }
    if (await openActionPopup(tab)) return;
    await openFallback(tab);
  }

  function fallbackCtx() {
    if (fallback.windowId == null) return {};
    return { tabId: fallback.originTabId, windowId: fallback.originWindowId };
  }

  async function closeFallback() {
    await ready;
    if (fallback.windowId == null) return;
    const id = fallback.windowId;
    fallback = { windowId: null };
    await persist();
    try { await api.windows.remove(id); } catch { /* already gone */ }
  }

  async function closeFromSender(sender) {
    await ready;
    const id = sender?.tab?.windowId;
    if (id == null) return closeFallback();
    if (id === fallback.windowId) { fallback = { windowId: null }; await persist(); }
    try { await api.windows.remove(id); } catch { /* already gone */ }
  }

  async function handleWindowRemoved(windowId) {
    await ready;
    if (windowId === fallback.windowId) { fallback = { windowId: null }; await persist(); }
  }

  async function handleFocusChanged(windowId) {
    await ready;
    if (fallback.windowId == null) return;
    if (windowId === api.windows.WINDOW_ID_NONE || windowId === fallback.windowId) return;
    await closeFallback();
  }

  return {
    openPalette,
    fallbackCtx,
    ctxFor,
    isPopupSender,
    closeFallback,
    closeFromSender,
    trackActionPopup,
    handleWindowRemoved,
    handleFocusChanged,
    isFallbackWindow: (id) => id === fallback.windowId,
  };
}
