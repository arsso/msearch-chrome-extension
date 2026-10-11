# msearch

Arc-style command palette for Chrome: one box for open tabs, history, bookmarks,
web search and browser commands.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `src/` folder.
3. Shortcut is `⌘⇧K` (`Ctrl+Shift+K` on Windows/Linux). Chrome only assigns it at install time and
   silently skips it when another extension already uses the key; check or set it at
   `chrome://extensions/shortcuts`. Chrome does not let extensions take `⌘T`.
4. Reload any tabs that were already open before installing (content scripts only attach to new loads;
   the extension injects on demand, but a reload is the sure path).

## Usage

- `↑ ↓` or `Tab` to move, `↵` to open, `⌘↵` to open in a new tab, `Esc` to close.
- Empty box shows your most recent tabs. Type to search tabs, bookmarks, history, suggestions and commands.
- Type a URL or domain to get a **Go to** row.
- Commands (also by Turkish alias): New tab, Close tab, Reopen closed tab, Copy URL, Pin / Unpin tab,
  Mute / Unmute tab, Reload page, Duplicate tab, New incognito window, Bookmark this page.

## Settings

Right-click the extension icon → Options: search engine (Google / DuckDuckGo / Bing) and whether
to fetch search suggestions (sends typed text to Google when on).

## Development

```
npm test
```

### Manual checklist

- [ ] On a normal page (e.g. github.com) the shortcut opens the palette centred over the page; Esc closes.
- [ ] On `chrome://extensions` the shortcut opens the palette in a small popup window; it closes when you click another window.
- [ ] Empty query lists recent tabs; typing part of a tab title and pressing Enter switches to it.
- [ ] Typing a history term shows History rows; `⌘↵` opens it in a new tab.
- [ ] Typing `example.com` shows **Go to example.com** above the search row.
- [ ] `kapat` runs Close tab; `undo` reopens it.
- [ ] `kopyala` copies the URL (paste somewhere to check).
- [ ] On Gmail or GitHub the palette looks the same (no site CSS leaking in) and site shortcuts do not fire while typing.
- [ ] On a page that pulls focus back to its own input, or that handles Esc / arrows at window level, typing still lands in the palette and Esc closes it.
- [ ] Clicking the palette footer or list padding, then pressing Esc, still closes it.
- [ ] While the popup window is open, the shortcut closes it.
- [ ] With Chrome in macOS fullscreen, the shortcut on a new tab shows a centred panel on a dimmed backdrop, not a stretched one.
- [ ] With suggestions off, DevTools → service worker → Network shows no request to suggestqueries.google.com.
- [ ] Clicking outside the panel (the dimmed backdrop) closes it.
