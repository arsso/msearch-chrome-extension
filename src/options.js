import { getSettings } from './settings.js';

const engine = document.getElementById('engine');
const suggest = document.getElementById('suggest');
const ok = document.getElementById('ok');

const settings = await getSettings(chrome);
engine.value = settings.searchEngine;
suggest.checked = settings.suggestEnabled;

async function save() {
  await chrome.storage.sync.set({ searchEngine: engine.value, suggestEnabled: suggest.checked });
  ok.textContent = 'Saved';
  setTimeout(() => { ok.textContent = ''; }, 1200);
}

engine.addEventListener('change', save);
suggest.addEventListener('change', save);
