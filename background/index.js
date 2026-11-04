// Service worker start: wires Chrome events to the queue, pacer, tabs and downloads.
// Listeners are added at the top level so Chrome can wake the worker for them.
import { update, read, settings, activeJob } from './store.js';
import { tick, finishJob, start, pause, restore, watchdog } from './pacer.js';
import { injectRunner, closeTab, closeJobTabs, closeWorkerWindow } from './tabs.js';
import { onCreated, onChanged, onDeterminingFilename, maybeBuildZip } from './downloads.js';
import { keepAwake } from './notify.js';
import { countFiles } from '../lib/fileStore.js';
import { WORK_SEC_PER_JOB } from '../config.js';

const TEMPLATE_PATH = /^\/templates\/[A-Za-z0-9_-]{6,}/;
const LOGIN_PATH = /^\/(login|signup)\b/;

// ---------- startup ----------

function setupAlarms() {
  chrome.alarms.create('watchdog', { periodInMinutes: 1 });
}

function setupContentSettings() {
  try {
    if (chrome.contentSettings && chrome.contentSettings.popups) {
      chrome.contentSettings.popups.set({
        primaryPattern: '*://*.canva.com/*',
        setting: 'allow',
      });
      chrome.contentSettings.popups.set({
        primaryPattern: '*://canva.com/*',
        setting: 'allow',
      });
    }
  } catch (_) {}
}

setupContentSettings();

chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
  setupContentSettings();
  restore();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
  setupContentSettings();
  restore();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tick') tick();
  if (alarm.name === 'watchdog') watchdog();
});

// ---------- tabs ----------

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const d = await read();
  let job = activeJob(d);
  if (!job) return;
  const url = tab.url ? new URL(tab.url) : null;
  const path = url ? url.pathname : '';

  // "Use this template" opened the editor in a new tab that Chrome did not
  // link to our tab: follow it when it is a Canva design page.
  if (
    job.tabId !== tabId &&
    job.step === 'use-template' &&
    url &&
    /(^|\.)canva\.com$/.test(url.hostname) &&
    /^\/design/.test(path) &&
    Date.now() - job.updatedAt < 90000
  ) {
    const oldTab = job.tabId;
    await update((x) => {
      const j = x.queue.find((y) => y.id === job.id);
      if (j) {
        j.tabId = tabId;
        j.updatedAt = Date.now();
      }
    });
    closeTab(oldTab);
    job = { ...job, tabId };
  }

  if (job.tabId !== tabId) return;
  if (['downloading', 'done'].includes(job.state) || job.step === 'download-clicked') return;
  if (LOGIN_PATH.test(path)) {
    return finishJob(job.id, { kind: 'stop', error: 'Logged out of Canva' });
  }

  // If "Use this template" was already clicked, only run when we actually land on the /design editor page.
  // Ignore non-design navigations (e.g. template preview modal closing back to /).
  if (job.step === 'use-template' && !/^\/design/.test(path)) return;

  const afterUse = job.step === 'use-template' || /^\/design/.test(path);
  await update((x) => {
    const j = x.queue.find((y) => y.id === job.id);
    if (j && j.state === 'opening') {
      j.state = 'clicking';
      j.step = 'page-loaded';
      j.updatedAt = Date.now();
    }
  });
  try {
    await injectRunner(tabId, job.id, afterUse);
  } catch (e) {
    await finishJob(job.id, { kind: 'retry', error: `Could not start the runner: ${e.message}` });
  }
});

// "Use this template" may open the editor in a new tab: follow it.
chrome.tabs.onCreated.addListener(async (tab) => {
  const { workerWindowId } = await chrome.storage.local.get('workerWindowId');
  let oldTemplateTab = null;
  await update((d) => {
    const job = activeJob(d);
    if (!job || job.state !== 'clicking') return;
    const isOpener = tab.openerTabId != null && tab.openerTabId === job.tabId;
    const isWorkerNewTab = workerWindowId != null && tab.windowId === workerWindowId && job.step === 'use-template';
    if (isOpener || isWorkerNewTab) {
      if (!job.templateTabId) job.templateTabId = job.tabId;
      oldTemplateTab = job.templateTabId;
      job.tabId = tab.id;
      job.updatedAt = Date.now();
    }
  });
  if (oldTemplateTab != null && oldTemplateTab !== tab.id) {
    setTimeout(() => closeTab(oldTemplateTab), 1500);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const d = await read();
  const job = activeJob(d);
  if (job && ['opening', 'clicking'].includes(job.state)) {
    // Closing the template preview tab is expected and desired to save RAM.
    if (job.templateTabId === tabId) return;
    if (job.step === 'use-template') return;
    if (job.tabId === tabId) {
      await finishJob(job.id, { kind: 'stop', error: 'The download tab was closed' });
    }
  }
});

// ---------- downloads ----------

chrome.downloads.onCreated.addListener(onCreated);
chrome.downloads.onChanged.addListener(onChanged);
chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);

// ---------- adding templates ----------

function titleFromUrl(path) {
  const slug = path.split('/')[2] || '';
  const words = slug.replace(/^[A-Za-z0-9]{6,}-?/, '').split('-').filter(Boolean);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Canva template';
}

function normalize(item) {
  const raw = typeof item === 'string' ? item : item && item.url;
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)canva\.com$/.test(u.hostname) || !TEMPLATE_PATH.test(u.pathname)) return null;
  const url = `https://www.canva.com${u.pathname.endsWith('/') ? u.pathname : u.pathname + '/'}`;
  const title = (typeof item === 'object' && item.title) || titleFromUrl(u.pathname);
  return { url, title: String(title).slice(0, 120) };
}

async function addMany(items) {
  const s = await settings();
  return update((d) => {
    const known = new Set(d.queue.map((j) => j.url));
    let added = 0;
    let skipped = 0;
    for (const it of items || []) {
      const n = normalize(it);
      if (!n || known.has(n.url)) {
        skipped++;
        continue;
      }
      const isPrem = typeof it === 'object' && Boolean(it.isPremium);
      // If onlyPremium filter is active and the item was marked non-premium:
      if (s.onlyPremium && typeof it === 'object' && it.isPremium === false) {
        skipped++;
        continue;
      }
      known.add(n.url);
      d.queue.push({
        id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        url: n.url,
        title: n.title,
        isPremium: isPrem,
        state: 'queued',
        step: null,
        attempts: 0,
        tabId: null,
        downloadId: null,
        error: null,
        addedAt: Date.now(),
        updatedAt: Date.now(),
      });
      added++;
    }
    return { added, skipped };
  });
}

// ---------- popup status ----------

async function status() {
  const s = await settings();
  const d = await read();
  const counts = { queued: 0, active: 0, done: 0, skipped: 0, failed: 0 };
  for (const j of d.queue) {
    if (j.state === 'queued') counts.queued++;
    else if (['opening', 'clicking', 'downloading'].includes(j.state)) counts.active++;
    else counts[j.state]++;
  }
  const waiting = counts.queued + counts.active;
  const perJob = (s.minWaitSec + s.maxWaitSec) / 2 + WORK_SEC_PER_JOB;
  const leftToday = Math.max(0, s.perDay - d.stats.dayCount);
  let eta = '';
  if (waiting) {
    if (waiting <= leftToday) eta = `about ${Math.max(1, Math.round((waiting * perJob) / 60))} minutes`;
    else eta = `about ${1 + Math.ceil((waiting - leftToday) / s.perDay)} days`;
  }
  const recent = [...d.queue]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 40)
    .map(({ id, title, url, state, step, error, attempts, isPremium }) => ({
      id,
      title,
      url,
      state,
      step,
      error,
      attempts,
      isPremium: Boolean(isPremium),
    }));

  // Auto-collect any already-skipped Pro templates from queue into premiumQueue
  const proKnown = new Set((d.premiumQueue || []).map((p) => p.url));
  let proAdded = false;
  for (const j of d.queue) {
    if (j.state === 'skipped' && /pro|premium|paid|subscription/i.test(j.error || '') && !proKnown.has(j.url)) {
      if (!d.premiumQueue) d.premiumQueue = [];
      d.premiumQueue.push({
        id: `pro_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        url: j.url,
        title: j.title || 'Canva Pro Template',
        error: j.error,
        addedAt: j.updatedAt || Date.now(),
      });
      proKnown.add(j.url);
      proAdded = true;
    }
  }
  if (proAdded) {
    chrome.storage.local.set({ premiumQueue: d.premiumQueue });
  }

  return {
    state: d.state,
    stats: d.stats,
    settings: s,
    counts,
    eta,
    recent,
    storedFiles: await countFiles(),
    premiumQueue: d.premiumQueue || [],
  };
}

// ---------- messages from popup, options, picker and runner ----------

const handlers = {
  ADD_MANY: (m) => addMany(m.items),
  START: () => start(),
  PAUSE: () => pause(),
  MAKE_ZIP: () => maybeBuildZip(true),
  STATUS: () => status(),
  RETRY_FAILED: () =>
    update((d) => {
      d.queue.forEach((j) => {
        if (j.state === 'failed') Object.assign(j, { state: 'queued', attempts: 0, error: null });
      });
    }),
  RETRY_JOB: (m) =>
    update((d) => {
      const j = d.queue.find((x) => x.id === m.jobId);
      if (j && ['failed', 'skipped'].includes(j.state)) Object.assign(j, { state: 'queued', attempts: 0, error: null });
    }),
  REMOVE_JOB: (m) =>
    update((d) => {
      d.queue = d.queue.filter((j) => j.id !== m.jobId || j.id === d.state.activeJobId);
    }),
  CLEAR_DONE: () =>
    update((d) => {
      d.queue = d.queue.filter((j) => !['done', 'skipped'].includes(j.state));
    }),
  EMPTY_QUEUE: async () => {
    chrome.alarms.clear('tick');
    let jobToClose = null;
    let count = 0;
    await update((d) => {
      count = d.queue.length + (d.premiumQueue ? d.premiumQueue.length : 0);
      jobToClose = activeJob(d);
      d.queue = [];
      d.premiumQueue = [];
      d.state.running = false;
      d.state.paused = false;
      d.state.reason = null;
      d.state.activeJobId = null;
      d.state.nextAt = 0;
    });
    if (jobToClose) {
      await closeJobTabs(jobToClose).catch(() => {});
    }
    await closeWorkerWindow().catch(() => {});
    keepAwake(false);
    return { ok: true, count };
  },
  GET_SETTINGS: async () => settings(),
  SET_SETTING: async (m) => {
    const s = await settings();
    if (m && m.key !== undefined) {
      s[m.key] = m.value;
      await chrome.storage.local.set({ settings: s });
    }
    return { ok: true, settings: s };
  },
  FILTER_ONLY_PREMIUM: async () => {
    const s = await settings();
    s.onlyPremium = true;
    s.hasPremiumAccount = true;
    await chrome.storage.local.set({ settings: s });

    return update((d) => {
      let moved = 0;
      if (d.premiumQueue && d.premiumQueue.length) {
        for (const item of d.premiumQueue) {
          const existing = d.queue.find((j) => j.url === item.url);
          if (existing) {
            if (existing.state !== 'done') {
              Object.assign(existing, { state: 'queued', attempts: 0, error: null, isPremium: true, updatedAt: Date.now() });
              moved++;
            }
          } else {
            d.queue.push({
              id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
              url: item.url,
              title: item.title,
              isPremium: true,
              state: 'queued',
              step: null,
              attempts: 0,
              tabId: null,
              downloadId: null,
              error: null,
              addedAt: Date.now(),
              updatedAt: Date.now(),
            });
            moved++;
          }
        }
      }

      // Filter out queued jobs that are explicitly marked non-premium
      let removedFree = 0;
      d.queue = d.queue.filter((j) => {
        if (j.id === d.state.activeJobId) return true;
        if (j.state !== 'queued') return true;
        if (j.isPremium === false) {
          removedFree++;
          return false;
        }
        return true;
      });

      return { moved, removedFree, onlyPremium: true };
    });
  },
  MOVE_PREMIUM_TO_QUEUE: () =>
    update((d) => {
      if (!d.premiumQueue || !d.premiumQueue.length) return { moved: 0 };
      let moved = 0;
      for (const item of d.premiumQueue) {
        const existing = d.queue.find((j) => j.url === item.url);
        if (existing) {
          if (existing.state !== 'done') {
            Object.assign(existing, { state: 'queued', attempts: 0, error: null, isPremium: true, updatedAt: Date.now() });
            moved++;
          }
        } else {
          d.queue.push({
            id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            url: item.url,
            title: item.title,
            isPremium: true,
            state: 'queued',
            step: null,
            attempts: 0,
            tabId: null,
            downloadId: null,
            error: null,
            addedAt: Date.now(),
            updatedAt: Date.now(),
          });
          moved++;
        }
      }
      return { moved };
    }),
  RETRY_PREMIUM_JOB: (m) =>
    update((d) => {
      const item = (d.premiumQueue || []).find((p) => p.id === m.id || p.url === m.url);
      if (!item) return;
      const existing = d.queue.find((j) => j.url === item.url);
      if (existing) {
        Object.assign(existing, { state: 'queued', attempts: 0, error: null, isPremium: true, updatedAt: Date.now() });
      } else {
        d.queue.push({
          id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          url: item.url,
          title: item.title,
          isPremium: true,
          state: 'queued',
          step: null,
          attempts: 0,
          tabId: null,
          downloadId: null,
          error: null,
          addedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }),
  REMOVE_PREMIUM_JOB: (m) =>
    update((d) => {
      d.premiumQueue = (d.premiumQueue || []).filter((p) => p.id !== m.id && p.url !== m.url);
    }),
  CLEAR_PREMIUM_QUEUE: () =>
    update((d) => {
      d.premiumQueue = [];
    }),
  STEP: (m) =>
    update((d) => {
      const j = activeJob(d);
      if (j && j.id === m.jobId && j.state !== 'downloading') {
        j.state = 'clicking';
        j.step = m.step;
        j.updatedAt = Date.now();
      }
    }),
  RESULT: async (m) => {
    const d = await read();
    const j = activeJob(d);
    if (!j || j.id !== m.jobId || j.state === 'downloading') return;
    await finishJob(m.jobId, { kind: m.kind, error: m.error });
  },
  NAVIGATE_JOB: async (m) => {
    const d = await read();
    const job = activeJob(d);
    if (!job || job.id !== m.jobId || !job.tabId) return;
    try {
      const u = new URL(m.url, 'https://www.canva.com');
      if (/(^|\.)canva\.com$/.test(u.hostname) && /^\/design/.test(u.pathname)) {
        await update((x) => {
          const j = x.queue.find((y) => y.id === job.id);
          if (j) {
            j.step = 'use-template';
            j.updatedAt = Date.now();
          }
        });
        await chrome.tabs.update(job.tabId, { url: u.href, active: true });
      }
    } catch (_) {}
  },
  GET_JOB_STATUS: async (m, sender) => {
    const d = await read();
    const job = activeJob(d);
    if (!job || job.id !== m.jobId) return { active: false, switchedTab: false };
    const senderTabId = sender?.tab?.id;
    return {
      active: true,
      tabId: job.tabId,
      step: job.step,
      switchedTab: Boolean(senderTabId && job.tabId && job.tabId !== senderTabId),
    };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  const fn = handlers[msg.type];
  if (!fn) return;
  Promise.resolve(fn(msg, sender))
    .then((r) => sendResponse(r === undefined ? { ok: true } : r))
    .catch((e) => sendResponse({ error: e.message }));
  return true;
});
