import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, searchUrl, DEFAULT_SETTINGS } from '../src/settings.js';

function fakeApi(stored) {
  return { storage: { sync: { get: async () => stored } } };
}

test('getSettings merges stored values over defaults', async () => {
  assert.deepEqual(await getSettings(fakeApi({})), DEFAULT_SETTINGS);
  assert.deepEqual(await getSettings(fakeApi({ searchEngine: 'bing' })), { suggestEnabled: true, searchEngine: 'bing' });
});

test('getSettings falls back to defaults on unknown engine', async () => {
  assert.equal((await getSettings(fakeApi({ searchEngine: 'nope' }))).searchEngine, 'google');
});

test('searchUrl encodes the query per engine', () => {
  assert.equal(searchUrl('google', 'a b&c'), 'https://www.google.com/search?q=a%20b%26c');
  assert.equal(searchUrl('duckduckgo', 'x'), 'https://duckduckgo.com/?q=x');
  assert.equal(searchUrl('bing', 'x'), 'https://www.bing.com/search?q=x');
  assert.equal(searchUrl('unknown', 'x'), 'https://www.google.com/search?q=x');
});
