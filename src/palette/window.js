import { createPalette } from './palette.js';

// action.html runs as the toolbar action popup: Chrome owns its lifetime, so
// closing is just window.close(); a port lets the worker close it when the
// shortcut is pressed while it is open. palette.html runs in a separate
// fallback window that the worker removes.
const isActionPopup = location.pathname.endsWith('/action.html');

const palette = createPalette({
  root: document.getElementById('app'),
  host: 'window',
  send: (msg) => chrome.runtime.sendMessage(msg),
  onClose: isActionPopup
    ? () => window.close()
    // Ask the worker to remove this window; if it cannot (e.g. it was restarted), close ourselves.
    : () => chrome.runtime.sendMessage({ type: 'close' }).catch(() => {}).finally(() => window.close()),
  faviconUrl: (url) => chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'),
});

if (isActionPopup) {
  const port = chrome.runtime.connect({ name: 'action-popup' });
  port.onMessage.addListener((m) => { if (m?.type === 'close') window.close(); });
}

palette.open();
