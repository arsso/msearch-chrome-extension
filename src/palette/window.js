import { createPalette } from './palette.js';

const palette = createPalette({
  root: document.getElementById('app'),
  host: 'window',
  send: (msg) => chrome.runtime.sendMessage(msg),
  // Ask the worker to remove this window; if it cannot (e.g. it was restarted), close ourselves.
  onClose: () => chrome.runtime.sendMessage({ type: 'close' }).catch(() => {}).finally(() => window.close()),
  faviconUrl: (url) => chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'),
});

palette.open();
