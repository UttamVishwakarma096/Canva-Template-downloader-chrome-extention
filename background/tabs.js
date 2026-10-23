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
      if (win && win.state !== 'minimized') return win.id;
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
    tab = await chrome.tabs.create({ windowId, url: job.url, active: true });
  } else {
    const win = await chrome.windows.create({ url: job.url, focused: false, width: 1280, height: 900, type: 'normal' });
    await chrome.storage.local.set({ workerWindowId: win.id });
    tab = win.tabs[0];
  }
  await update((d) => {
    const j = d.queue.find((x) => x.id === job.id);
    if (j) {
      j.tabId = tab.id;
      j.updatedAt = Date.now();
    }
  });
}

// The runner is not in the manifest: it only goes into tabs the extension opened.
// afterUse: "Use this template" was already clicked; only the editor steps are left.
export async function injectRunner(tabId, jobId, afterUse) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/selectors.js', 'content/runner.js'],
  });
  await chrome.tabs.sendMessage(tabId, { type: 'RUN', jobId, afterUse });
}

export async function closeTab(tabId) {
  if (tabId == null) return;
  try {
    // Keep the worker window open: leave an empty tab behind if this is the last one.
    const tab = await chrome.tabs.get(tabId);
    const { workerWindowId } = await chrome.storage.local.get('workerWindowId');
    if (tab.windowId === workerWindowId) {
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      if (tabs.length === 1) await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true });
    }
    await chrome.tabs.remove(tabId);
  } catch {
    // already closed
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
