import { createPalette } from './palette.js';

const palette = createPalette({
  root: document.getElementById('app'),
  host: 'window',
  send: (msg) => chrome.runtime.sendMessage(msg),
  onClose: () => chrome.runtime.sendMessage({ type: 'close' }).catch(() => window.close()),
  faviconUrl: (url) => chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'),
});

palette.open();
