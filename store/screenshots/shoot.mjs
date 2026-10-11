import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXT = process.argv[2];
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'msearch-profile-'));

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN,
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--hide-scrollbars'],
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
// Extension pages expose the full chrome.* API to page.evaluate; the worker does not.
const api = await context.newPage();
await api.goto(`chrome-extension://${extId}/options.html`);

// Seed bookmarks (neutral, public sites).
await api.evaluate(async () => {
  const items = [
    ['GitHub', 'https://github.com/'],
    ['MDN Web Docs', 'https://developer.mozilla.org/'],
    ['Chrome Extensions docs', 'https://developer.chrome.com/docs/extensions'],
    ['Git documentation', 'https://git-scm.com/doc'],
  ];
  for (const [title, url] of items) await chrome.bookmarks.create({ title, url });
});

// Seed history by visiting pages, leave some open as tabs, close one.
const visit = async (url) => {
  const p = await context.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  return p;
};
const closed = await visit('https://git-scm.com/book/en/v2');
await closed.close();
for (const p of context.pages()) if (p !== api && p.url() === 'about:blank') await p.close();
const tabs = [];
tabs.push(await visit('https://developer.mozilla.org/en-US/docs/Web/JavaScript'));
tabs.push(await visit('https://github.com/git/git'));
tabs.push(await visit('https://developer.chrome.com/docs/extensions/develop'));
tabs.push(await visit('https://en.wikipedia.org/wiki/Git'));
const page = tabs[tabs.length - 1];
await page.bringToFront();
await page.evaluate(() => document.querySelectorAll('#centralNotice, #siteNotice, .vector-sticky-header').forEach((n) => n.remove()));
await page.waitForTimeout(1000);

// Send the toggle, then close this helper tab so it does not show up in the
// palette's tab list (the palette queries tabs after it finishes loading).
const toggle = () => api.evaluate(async () => {
  const [t] = await chrome.tabs.query({ url: 'https://en.wikipedia.org/*' });
  const me = await chrome.tabs.getCurrent();
  chrome.tabs.sendMessage(t.id, { type: 'toggle' });
  chrome.tabs.remove(me.id);
}).catch(() => {});

// Shot 1: empty palette, recent tabs.
await toggle();
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '1-recent-tabs.png') });

// Shot 2: typing a query.
await page.keyboard.type('git', { delay: 60 });
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(OUT, '2-search.png') });

await context.close();
console.log('done', OUT);
