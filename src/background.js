import { gather } from './sources.js';
import { rank } from './ranking.js';
import { execute } from './actions.js';
import { getSettings, ENGINES } from './settings.js';
import { createHostController } from './host.js';

const host = createHostController(chrome);

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-palette') host.openPalette();
});
chrome.action.onClicked.addListener(() => host.openPalette());
chrome.windows.onRemoved.addListener((id) => host.handleWindowRemoved(id));
chrome.windows.onFocusChanged.addListener((id) => host.handleFocusChanged(id));

function ctxFor(sender) {
  if (sender.tab && !host.isFallbackWindow(sender.tab.windowId)) {
    return { tabId: sender.tab.id, windowId: sender.tab.windowId };
  }
  return host.fallbackCtx();
}

async function handle(msg, sender) {
  const ctx = ctxFor(sender);
  switch (msg?.type) {
    case 'query': {
      const settings = await getSettings(chrome);
      const candidates = await gather(msg.text ?? '', ctx, chrome, settings);
      const results = rank(msg.text ?? '', candidates, { engineName: ENGINES[settings.searchEngine].name });
      return { results, seq: msg.seq };
    }
    case 'execute': {
      const settings = await getSettings(chrome);
      const out = await execute(msg.result, msg.modifiers ?? {}, ctx, chrome, settings);
      return { ok: true, ...out };
    }
    case 'close': {
      if (!sender.tab || host.isFallbackWindow(sender.tab.windowId)) await host.closeFallback();
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e), seq: msg?.seq }));
  return true;
});
