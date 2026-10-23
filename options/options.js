import { DEFAULTS } from '../config.js';

const form = document.getElementById('form');
const NUMBERS = ['minWaitSec', 'maxWaitSec', 'perHour', 'perDay', 'perZip', 'maxAttempts', 'jobTimeoutSec'];

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...settings };
  for (const el of form.elements) if (el.name) el.value = s[el.name];
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = { folder: form.elements.folder.value.trim() || DEFAULTS.folder };
  for (const k of NUMBERS) s[k] = Number(form.elements[k].value);
  if (s.maxWaitSec < s.minWaitSec) [s.minWaitSec, s.maxWaitSec] = [s.maxWaitSec, s.minWaitSec];
  await chrome.storage.local.set({ settings: s });
  document.getElementById('msg').textContent = 'Saved.';
  load();
});

document.getElementById('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const items = text.match(/https?:\/\/(?:www\.)?canva\.com\/templates\/[^\s,;"'<>]+/g) || [];
  const res = await chrome.runtime.sendMessage({ type: 'ADD_MANY', items });
  document.getElementById('import-msg').textContent = `Found ${items.length} links. Added ${res.added}, skipped ${res.skipped}.`;
  e.target.value = '';
});

load();
