export const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
};

export const DEFAULT_SETTINGS = { suggestEnabled: true, searchEngine: 'google' };

export async function getSettings(api) {
  let stored = {};
  try { stored = (await api.storage.sync.get(DEFAULT_SETTINGS)) ?? {}; } catch { /* keep defaults */ }
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (!ENGINES[merged.searchEngine]) merged.searchEngine = DEFAULT_SETTINGS.searchEngine;
  merged.suggestEnabled = merged.suggestEnabled !== false;
  return merged;
}

export function searchUrl(engineId, query) {
  const engine = ENGINES[engineId] ?? ENGINES.google;
  return engine.url + encodeURIComponent(query);
}
