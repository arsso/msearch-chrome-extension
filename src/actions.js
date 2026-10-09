import { runCommand } from './commands.js';
import { searchUrl } from './settings.js';

async function openUrl(url, newTab, ctx, api) {
  if (newTab || ctx.tabId == null) {
    await api.tabs.create({ url, active: true });
  } else {
    await api.tabs.update(ctx.tabId, { url });
  }
}

export async function execute(result, modifiers, ctx, api, settings) {
  const newTab = Boolean(modifiers?.meta);
  switch (result.type) {
    case 'tab':
      await api.tabs.update(result.tabId, { active: true });
      await api.windows.update(result.windowId, { focused: true });
      return {};
    case 'bookmark':
    case 'history':
    case 'navigate':
      await openUrl(result.url, newTab, ctx, api);
      return {};
    case 'recentlyClosed':
      if (result.sessionId) await api.sessions.restore(result.sessionId);
      else await openUrl(result.url, newTab, ctx, api);
      return {};
    case 'search':
    case 'suggest':
      await openUrl(searchUrl(settings.searchEngine, result.query), newTab, ctx, api);
      return {};
    case 'command':
      return runCommand(result.commandId, ctx, api);
    default:
      throw new Error(`Unknown result type: ${result.type}`);
  }
}
