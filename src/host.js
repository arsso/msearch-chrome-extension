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
