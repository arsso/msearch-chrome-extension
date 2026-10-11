(() => {
  if (window.__msearch) return;
  const state = { palette: null, loading: null };
  window.__msearch = state;

  // Registered at document_start so it runs before any page handler on the
  // window; the palette only acts on keys while it is open. Re-bound on every
  // open as well: adding the same listener again is a no-op when it is still
  // there, and restores it when it is not.
  const forwardKey = (e) => { if (state.palette?.isOpen()) state.palette.handleKey(e); };
  function bindKeys() {
    for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, forwardKey, true);
  }
  bindKeys();

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
          captureKeys: false,
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
      .then((p) => { bindKeys(); if (p.isOpen()) p.close(); else p.open(); respond({ ok: true }); })
      .catch((e) => respond({ ok: false, error: e?.message ?? String(e) }));
    return true;
  });
})();
