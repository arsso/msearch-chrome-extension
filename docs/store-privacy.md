# Chrome Web Store — Privacy tab text for msearch

## Single purpose

msearch is a keyboard-driven command palette for the browser. It lets the user open one search box (Cmd/Ctrl+Shift+K) to switch tabs, reopen recently closed tabs, open history and bookmark entries, run browser commands (new tab, duplicate, close, reload, etc.) and launch a web search, all from a single list.

## Permission justifications

**tabs** — Lists the open tabs (title and URL) in the palette so the user can switch to, close, duplicate or reload them, and opens new tabs for search results and history/bookmark entries.

**history** — Searches the user's local browsing history by the typed text so matching pages can be shown in the palette and reopened. History is read on the device only and never transmitted.

**bookmarks** — Searches bookmarks by the typed text so they can be opened from the palette, and lets the user bookmark the current page with a palette command.

**sessions** — Lists recently closed tabs in the palette and restores the selected one ("reopen closed tab" command).

**scripting** — Injects the palette overlay script into a tab that was already open before the extension was installed or updated, so the keyboard shortcut works without reloading the page.

**storage** — Saves the user's settings (preferred search engine and whether search suggestions are enabled) via chrome.storage.sync.

**favicon** — Displays site favicons next to tab, history and bookmark entries in the palette using Chrome's built-in _favicon endpoint.

**activeTab** — Not used. Remove it from manifest.json before submitting (see note below).

**Host permission: <all_urls>** — The palette is rendered as an overlay on top of the current page, so the content script must be able to run on any site the user presses the shortcut on. The script only draws the palette UI in an isolated iframe; it does not read or modify page content.

**Host permission: https://suggestqueries.google.com/*** — Fetches search-as-you-type suggestions for the text the user is typing, when the user has enabled suggestions in the options page.

## Remote code

**Are you using remote code?** No.
Justification: All JavaScript is packaged inside the extension. The only network request is a JSON fetch to suggestqueries.google.com for search suggestions; no code is downloaded or evaluated.

## Data usage

Tick **none** of the data categories. Nothing is collected or transmitted to the developer. The only data that leaves the device is the text the user types in the palette, sent to Google's suggestion endpoint when suggestions are enabled, and the search query sent to the user's chosen search engine when they press Enter. State this in the privacy policy.

Certifications — tick all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy (host this at a public URL and link it in the listing)

msearch Privacy Policy

msearch does not collect, store or transmit any personal data to the developer or to any third party.

- Tabs, browsing history, bookmarks and recently closed tabs are read locally on your device only to display matching entries in the palette. They never leave your browser.
- Your settings (search engine, suggestions on/off) are stored with Chrome's sync storage, which is tied to your own Google account and is not accessible to the developer.
- When search suggestions are enabled (default: on, can be turned off in the options page), the text you type in the palette is sent to Google's suggestion service (suggestqueries.google.com) to show completions. No other identifier is sent with it.
- When you run a web search from the palette, the query is sent to the search engine you selected in the options page.
- The extension contains no analytics, tracking or advertising code and does not read or modify the content of the pages you visit.

Contact: arssolabs@gmail.com
Last updated: 2026-10-11
