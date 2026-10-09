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
