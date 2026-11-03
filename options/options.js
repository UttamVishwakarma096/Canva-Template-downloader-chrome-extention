import { DEFAULTS } from '../config.js';

const form = document.getElementById('form');
const NUMBERS = ['minWaitSec', 'maxWaitSec', 'perHour', 'perDay', 'perZip', 'maxAttempts', 'jobTimeoutSec'];

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...settings };
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = Boolean(s[el.name]);
    else el.value = s[el.name];
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = {
    folder: form.elements.folder.value.trim() || DEFAULTS.folder,
    format: form.elements.format.value || DEFAULTS.format,
    hasPremiumAccount: Boolean(form.elements.hasPremiumAccount.checked),
    onlyPremium: Boolean(form.elements.onlyPremium.checked),
  };
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

const emptyBtn = document.getElementById('empty-queue-btn');
if (emptyBtn) {
  emptyBtn.addEventListener('click', async () => {
    emptyBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'EMPTY_QUEUE' });
      const count = res && res.count != null ? res.count : 0;
      const msg = document.getElementById('empty-msg');
      if (msg) {
        msg.textContent = `Queue emptied (${count} template(s) removed).`;
        setTimeout(() => {
          msg.textContent = '';
        }, 4000);
      }
    } catch (err) {
      console.error('Failed to empty queue:', err);
    } finally {
      emptyBtn.disabled = false;
    }
  });
}

load();
