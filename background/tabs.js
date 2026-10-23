// Opens each template in the worker window, puts the runner script into it,
// and closes the tab as soon as the template is finished.
import { update } from './store.js';

// Templates open in their own Chrome window, as the visible tab. Canva's editor
// may not draw its buttons in a hidden background tab, so keep this window
// open and not minimized while the queue runs.
async function workerWindow() {
  const { workerWindowId } = await chrome.storage.local.get('workerWindowId');
  if (workerWindowId != null) {
    try {
      const win = await chrome.windows.get(workerWindowId);
      if (win) return win.id;
    } catch {
      // window was closed
    }
  }
  return null;
}

export async function openJobTab(job) {
  let tab;
  const windowId = await workerWindow();
  if (windowId != null) {
    // Reuse existing tab in the worker window to prevent tab churn, popups, and virtual desktop switching
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs && tabs.length > 0) {
      tab = tabs[0];
      await chrome.tabs.update(tab.id, { url: job.url, active: true });
      for (let i = 1; i < tabs.length; i++) {
        await chrome.tabs.remove(tabs[i].id).catch(() => {});
      }
    } else {
      tab = await chrome.tabs.create({ windowId, url: job.url, active: true });
    }
  } else {
    const win = await chrome.windows.create({ url: job.url, focused: false, width: 1280, height: 900, type: 'normal' });
    await chrome.storage.local.set({ workerWindowId: win.id });
    tab = win.tabs[0];
  }
  await update((d) => {
    const j = d.queue.find((x) => x.id === job.id);
    if (j) {
      j.tabId = tab.id;
      j.templateTabId = tab.id;
      j.updatedAt = Date.now();
    }
  });
}

// The runner is not in the manifest: it only goes into tabs the extension opened.
// afterUse: "Use this template" was already clicked; only the editor steps are left.
export async function injectRunner(tabId, jobId, afterUse) {
  // 1. Install interceptor in the page's MAIN execution world to disable focus-stealing
  // and force window.open to navigate in the current tab instead of opening popups/tabs
  // that cause Windows to switch virtual desktops.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (window.__canvaBulkInterceptorInstalled) return;
        window.__canvaBulkInterceptorInstalled = true;

        // Disarm focus stealing: prevent Canva or window.open from switching Windows virtual desktops
        window.focus = function () {};

        // Redirect window.open to in-place navigation
        const origOpen = window.open;
        window.open = function (url, target, features) {
          if (url && typeof url === 'string') {
            window.location.href = url;
            return window;
          }
          const proxy = {
            set location(val) {
              if (typeof val === 'string') {
                window.location.href = val;
              } else if (val && val.href) {
                window.location.href = val.href;
              }
            },
            get location() {
              return window.location;
            },
            focus() {},
            blur() {},
            close() {},
            closed: false,
            document: window.document,
          };
          return proxy;
        };
      },
    });
  } catch (_) {}

  // 2. Inject selectors and runner in the isolated world
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/selectors.js', 'content/runner.js'],
  });
  await chrome.tabs.sendMessage(tabId, { type: 'RUN', jobId, afterUse });
}

export async function closeTab(tabId) {
  if (tabId == null) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const { workerWindowId } = await chrome.storage.local.get('workerWindowId');
    if (tab.windowId === workerWindowId) {
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      // Keep worker window open by navigating to about:blank if it's the last tab
      if (tabs.length === 1) {
        await chrome.tabs.update(tabId, { url: 'about:blank' });
        return;
      }
    }
    await chrome.tabs.remove(tabId);
  } catch {
    // already closed
  }
}

// Closes any secondary tabs and resets worker window tab to about:blank when a template job finishes.
export async function closeJobTabs(job) {
  const ids = new Set();
  if (job?.tabId) ids.add(job.tabId);
  if (job?.templateTabId) ids.add(job.templateTabId);

  try {
    const { workerWindowId } = await chrome.storage.local.get('workerWindowId');
    if (workerWindowId != null) {
      const tabs = await chrome.tabs.query({ windowId: workerWindowId });
      if (tabs && tabs.length > 0) {
        // Reset primary worker tab to about:blank to immediately release Canva RAM
        await chrome.tabs.update(tabs[0].id, { url: 'about:blank' });
        // Close any other tabs that might have opened
        for (let i = 1; i < tabs.length; i++) {
          ids.add(tabs[i].id);
        }
        // Don't close the primary worker tab
        ids.delete(tabs[0].id);
      }
    }
  } catch (_) {}

  for (const tid of ids) {
    await closeTab(tid);
  }
}

// When the queue is finished, close the window the templates opened in.
export async function closeWorkerWindow() {
  const { workerWindowId } = await chrome.storage.local.get('workerWindowId');
  if (workerWindowId == null) return;
  try {
    await chrome.windows.remove(workerWindowId);
  } catch {
    // already closed
  }
  await chrome.storage.local.remove('workerWindowId');
}
