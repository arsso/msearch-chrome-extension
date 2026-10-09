const DEBOUNCE_MS = 60;

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  navigate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  command: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 17 6-5-6-5M12 19h8"/></svg>',
  suggest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

const TAGS = {
  tab: 'Switch to tab',
  command: 'Command',
  bookmark: 'Bookmark',
  history: 'History',
  recentlyClosed: 'Recently closed',
  suggest: 'Search',
  search: 'Search',
  navigate: 'Go to',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url ?? ''; }
}

export function createPalette({ root, host, send, onClose = () => {}, faviconUrl = null }) {
  const rootEl = el('div', 'ms-root');
  rootEl.dataset.host = host;
  rootEl.hidden = true;
  rootEl.innerHTML = `
    <div class="ms-backdrop"></div>
    <div class="ms-panel" role="dialog" aria-label="Command palette">
      <div class="ms-inputwrap">${ICONS.search}<input class="ms-input" placeholder="Search tabs, history, bookmarks, or the web…" spellcheck="false" autocomplete="off" autocapitalize="off"></div>
      <ul class="ms-list" role="listbox"></ul>
      <div class="ms-error" role="alert"></div>
      <div class="ms-footer"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>⌘↵</kbd> new tab</span><span><kbd>esc</kbd> close</span></div>
    </div>`;
  root.append(rootEl);

  const input = rootEl.querySelector('.ms-input');
  const list = rootEl.querySelector('.ms-list');
  const errorEl = rootEl.querySelector('.ms-error');

  let open = false;
  let results = [];
  let selected = 0;
  let seq = 0;
  let timer = null;

  function render() {
    list.replaceChildren();
    results.forEach((r, i) => {
      const li = el('li', 'ms-item');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === selected));
      li.dataset.index = String(i);

      const icon = el('span', 'ms-icon');
      if (ICONS[r.type]) icon.innerHTML = ICONS[r.type];
      else if (faviconUrl && r.url) {
        const img = document.createElement('img');
        img.src = faviconUrl(r.url);
        img.alt = '';
        img.onerror = () => { img.remove(); icon.textContent = (hostOf(r.url)[0] ?? '?').toUpperCase(); };
        icon.append(img);
      } else icon.textContent = (hostOf(r.url)[0] ?? '?').toUpperCase();

      const text = el('div', 'ms-text');
      text.append(el('div', 'ms-title', r.title));
      const sub = r.type === 'command' ? r.description : (r.url ? hostOf(r.url) : '');
      if (sub) text.append(el('div', 'ms-sub', sub));

      li.append(icon, text, el('span', 'ms-tag', TAGS[r.type] ?? r.type));
      li.addEventListener('mousemove', () => { if (selected !== i) { selected = i; updateSelection(); } });
      li.addEventListener('click', (e) => { selected = i; choose({ meta: e.metaKey || e.ctrlKey }); });
      list.append(li);
    });
  }

  function updateSelection() {
    for (const li of list.children) {
      const on = Number(li.dataset.index) === selected;
      li.setAttribute('aria-selected', String(on));
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  }

  async function query(text) {
    const mySeq = ++seq;
    let res;
    try { res = await send({ type: 'query', text, seq: mySeq }); } catch (e) { showError(e?.message ?? String(e)); return; }
    if (!res || res.seq !== mySeq || !open) return;
    if (res.ok === false) { showError(res.error ?? 'Search failed'); return; }
    results = res.results ?? [];
    selected = 0;
    showError('');
    render();
  }

  function scheduleQuery() {
    clearTimeout(timer);
    timer = setTimeout(() => query(input.value), DEBOUNCE_MS);
  }

  function showError(msg) { errorEl.textContent = msg; }

  async function choose(modifiers) {
    const r = results[selected];
    if (!r) return;
    let res;
    try { res = await send({ type: 'execute', result: r, modifiers }); } catch (e) { showError(e?.message ?? String(e)); return; }
    if (!res?.ok) { showError(res?.error ? `Couldn't do that: ${res.error}` : "Couldn't do that"); return; }
    if (res.copy) { try { await navigator.clipboard.writeText(res.copy); } catch { showError('Clipboard blocked by the page'); return; } }
    close();
  }

  function onKey(e) {
    if (!open) return;
    // Nothing typed into the palette may reach the page's own shortcut handlers.
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown': selected = Math.min(results.length - 1, selected + 1); updateSelection(); break;
      case 'ArrowUp': selected = Math.max(0, selected - 1); updateSelection(); break;
      case 'Tab': selected = e.shiftKey ? Math.max(0, selected - 1) : Math.min(results.length - 1, selected + 1); updateSelection(); break;
      case 'Enter': choose({ meta: e.metaKey || e.ctrlKey }); break;
      case 'Escape': close(); break;
      default: return;
    }
    e.preventDefault();
  }

  rootEl.addEventListener('keydown', onKey);
  for (const type of ['keyup', 'keypress']) rootEl.addEventListener(type, (e) => e.stopPropagation());
  input.addEventListener('input', scheduleQuery);
  rootEl.querySelector('.ms-backdrop').addEventListener('click', () => close());

  function openPalette() {
    if (open) return;
    open = true;
    rootEl.hidden = false;
    input.value = '';
    results = [];
    selected = 0;
    showError('');
    render();
    input.focus();
    query('');
  }

  function close() {
    if (!open) return;
    open = false;
    clearTimeout(timer);
    rootEl.hidden = true;
    input.blur();
    onClose();
  }

  return { open: openPalette, close, isOpen: () => open };
}
