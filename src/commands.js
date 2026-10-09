export const COMMANDS = [
  { id: 'new-tab', title: 'New tab', aliases: ['nt', 'yeni sekme'], description: 'Open a new tab' },
  { id: 'close-tab', title: 'Close tab', aliases: ['ct', 'kapat', 'sekmeyi kapat'], description: 'Close the current tab' },
  { id: 'reopen-closed', title: 'Reopen closed tab', aliases: ['undo', 'geri aç', 'son kapatılan'], description: 'Restore the most recently closed tab' },
  { id: 'copy-url', title: 'Copy URL', aliases: ['url', 'kopyala', 'adresi kopyala'], description: 'Copy the current page address' },
  { id: 'pin-tab', title: 'Pin / Unpin tab', aliases: ['pin', 'sabitle'], description: 'Toggle pinning for the current tab' },
  { id: 'mute-tab', title: 'Mute / Unmute tab', aliases: ['mute', 'sessiz', 'sustur'], description: 'Toggle sound for the current tab' },
  { id: 'reload', title: 'Reload page', aliases: ['refresh', 'yenile'], description: 'Reload the current page' },
  { id: 'duplicate', title: 'Duplicate tab', aliases: ['dup', 'çoğalt'], description: 'Open a copy of the current tab' },
  { id: 'incognito', title: 'New incognito window', aliases: ['gizli', 'private'], description: 'Open a new incognito window' },
  { id: 'bookmark-page', title: 'Bookmark this page', aliases: ['yer imi', 'favori'], description: 'Add the current page to bookmarks' },
];

export function commandCandidates() {
  return COMMANDS.map(c => ({
    type: 'command',
    commandId: c.id,
    title: c.title,
    aliases: c.aliases,
    description: c.description,
  }));
}

async function currentTab(ctx, api) {
  if (ctx.tabId == null) throw new Error('No current tab');
  return api.tabs.get(ctx.tabId);
}

const RUNNERS = {
  'new-tab': async (_ctx, api) => { await api.tabs.create({ active: true }); },
  'close-tab': async (ctx, api) => { await api.tabs.remove((await currentTab(ctx, api)).id); },
  'reopen-closed': async (_ctx, api) => { await api.sessions.restore(); },
  'copy-url': async (ctx, api) => ({ copy: (await currentTab(ctx, api)).url }),
  'pin-tab': async (ctx, api) => { const t = await currentTab(ctx, api); await api.tabs.update(t.id, { pinned: !t.pinned }); },
  'mute-tab': async (ctx, api) => { const t = await currentTab(ctx, api); await api.tabs.update(t.id, { muted: !t.mutedInfo?.muted }); },
  'reload': async (ctx, api) => { await api.tabs.reload((await currentTab(ctx, api)).id); },
  'duplicate': async (ctx, api) => { await api.tabs.duplicate((await currentTab(ctx, api)).id); },
  'incognito': async (_ctx, api) => { await api.windows.create({ incognito: true }); },
  'bookmark-page': async (ctx, api) => { const t = await currentTab(ctx, api); await api.bookmarks.create({ title: t.title, url: t.url }); },
};

export async function runCommand(id, ctx, api) {
  const run = RUNNERS[id];
  if (!run) throw new Error(`Unknown command: ${id}`);
  return (await run(ctx, api)) ?? {};
}
