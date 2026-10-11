import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));

test('manifest is MV3 with module service worker', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.background.type, 'module');
});

test('manifest declares required permissions', () => {
  for (const p of ['tabs', 'history', 'bookmarks', 'sessions', 'scripting', 'storage', 'activeTab', 'favicon']) {
    assert.ok(manifest.permissions.includes(p), `missing permission ${p}`);
  }
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  assert.ok(manifest.host_permissions.includes('https://suggestqueries.google.com/*'));
});

test('manifest wires shortcut, content script and web accessible resources', () => {
  assert.equal(manifest.commands['open-palette'].suggested_key.mac, 'Command+Shift+K');
  assert.equal(manifest.commands['open-palette'].suggested_key.default, 'Ctrl+Shift+K');
  assert.deepEqual(manifest.content_scripts[0].js, ['overlay.js']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  const resources = manifest.web_accessible_resources[0].resources;
  assert.ok(resources.includes('palette/*'));
  assert.ok(resources.includes('_favicon/*'));
  assert.equal(manifest.options_page, 'options.html');
});
