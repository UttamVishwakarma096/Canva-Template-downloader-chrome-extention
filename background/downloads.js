// Catches the file Canva downloads, stores it in IndexedDB, and builds ZIP files.
import { update, read, settings, activeJob } from './store.js';
import { finishJob } from './pacer.js';
import { notify } from './notify.js';
import { putFile, countFiles, deleteFiles } from '../lib/fileStore.js';
import { safeName } from '../lib/zip.js';

const isOurs = (item) => item.byExtensionId === chrome.runtime.id;

function extensionFor(type, url) {
  if (/presentationml|powerpoint/.test(type)) return 'pptx';
  if (/pdf/.test(type)) return 'pdf';
  if (/png/.test(type)) return 'png';
  if (/jpe?g/.test(type)) return 'jpg';
  if (/zip/.test(type)) return 'zip';
  const m = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url || '');
  return m ? m[1].toLowerCase() : 'pptx';
}

// A new download started. If it belongs to the open job, collect it.
export async function onCreated(item) {
  if (isOurs(item)) return;
  let job = null;
  await update((d) => {
    const j = activeJob(d);
    if (!j || !['opening', 'clicking'].includes(j.state)) return;
    j.state = 'downloading';
    j.step = 'download-started';
    j.downloadId = item.id;
    j.updatedAt = Date.now();
    job = { ...j };
  });
  if (!job) return;

  const url = item.finalUrl || item.url;
  if (/^(https?|data):/.test(url)) {
    try {
      await chrome.downloads.pause(item.id);
    } catch {
      // small files may already be finished
    }
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error('empty file');
      const ext = extensionFor(blob.type, item.filename || url);
      await putFile({ jobId: job.id, name: `${safeName(job.title)}.${ext}`, blob, savedAt: Date.now() });
      await removeDownload(item.id);
      await finishJob(job.id, { ok: true });
      return;
    } catch (e) {
      console.warn('Could not collect file, saving it normally instead:', e);
    }
    try {
      await chrome.downloads.resume(item.id);
    } catch {
      // not paused
    }
  }
  // Backup plan: Chrome saves the file normally (see onDeterminingFilename).
  await update((d) => {
    const j = d.queue.find((x) => x.id === job.id);
    if (j) j.loose = true;
  });
  const [now] = await chrome.downloads.search({ id: item.id });
  if (now && now.state === 'complete') await finishJob(job.id, { ok: true, loose: true });
}

async function removeDownload(id) {
  try {
    await chrome.downloads.cancel(id);
  } catch {
    // already finished: delete the single file, it is in the ZIP now
    try {
      await chrome.downloads.removeFile(id);
    } catch {
      // nothing to remove
    }
  }
  try {
    await chrome.downloads.erase({ id });
  } catch {
    // fine
  }
}

// Only used for files that could not be collected: give them a clean name.
export function onDeterminingFilename(item, suggest) {
  if (isOurs(item)) return;
  (async () => {
    const d = await read();
    const job = activeJob(d);
    if (!job || job.downloadId !== item.id) return suggest();
    const s = await settings();
    const ext = extensionFor(item.mime || '', item.filename || item.url);
    suggest({ filename: `${safeName(s.folder)}/not-in-zip/${safeName(job.title)}.${ext}`, conflictAction: 'uniquify' });
  })().catch(() => suggest());
  return true;
}

export async function onChanged(delta) {
  const state = delta.state && delta.state.current;
  if (!state || state === 'in_progress') return;
  const d = await read();

  if (delta.id === d.state.zipDownloadId) {
    if (state === 'complete') await zipSaved();
    else if (state === 'interrupted') await zipFailed(delta.error && delta.error.current);
    return;
  }

  const job = activeJob(d);
  if (!job || job.downloadId !== delta.id || job.state !== 'downloading' || !job.loose) return;
  if (state === 'complete') {
    await finishJob(job.id, { ok: true, loose: true });
  } else if (state === 'interrupted') {
    const reason = (delta.error && delta.error.current) || 'unknown';
    if (/FILE_NO_SPACE|USER_CANCELED/.test(reason)) {
      await finishJob(job.id, { kind: 'stop', error: `Download stopped: ${reason === 'FILE_NO_SPACE' ? 'disk is full' : 'cancelled'}` });
    } else {
      try {
        await chrome.downloads.resume(delta.id);
      } catch {
        await finishJob(job.id, { kind: 'retry', error: `Download stopped (${reason})` });
      }
    }
  }
}

// ---------- ZIP ----------

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/zip.html',
      reasons: ['BLOBS'],
      justification: 'Build ZIP files from the downloaded templates',
    });
  }
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // not open
  }
}

// force: build even if there are fewer files than one full ZIP.
export async function maybeBuildZip(force) {
  const s = await settings();
  const count = await countFiles();
  if (!count || (!force && count < s.perZip)) return;

  const go = await update((d) => {
    if (d.state.zipBuilding) return false;
    d.state.zipBuilding = true;
    return true;
  });
  if (!go) return;

  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'BUILD_ZIP', limit: s.perZip });
    if (!res || res.error) throw new Error(res ? res.error : 'no answer from ZIP page');
    const { state } = await read();
    const folder = safeName(s.folder);
    const id = await chrome.downloads.download({
      url: res.url,
      filename: `${folder}/${folder} ${new Date().toLocaleDateString('en-CA')} part-${state.zipPart}.zip`,
      conflictAction: 'uniquify',
    });
    await update((d) => {
      d.state.zipDownloadId = id;
      d.state.zipKeys = res.keys;
    });
  } catch (e) {
    await zipFailed(e.message);
  }
}

async function zipSaved() {
  const { state } = await read();
  const keys = state.zipKeys || [];
  await deleteFiles(keys);
  await closeOffscreen();
  await update((d) => {
    d.state.zipBuilding = false;
    d.state.zipDownloadId = null;
    d.state.zipKeys = [];
    d.state.zipPart++;
  });
  notify('ZIP saved', `Part ${state.zipPart} with ${keys.length} templates is in your Downloads folder.`);
  const now = await read();
  maybeBuildZip(!now.state.running);
}

async function zipFailed(reason) {
  await closeOffscreen();
  await update((d) => {
    d.state.zipBuilding = false;
    d.state.zipDownloadId = null;
    d.state.zipKeys = [];
  });
  notify('ZIP not saved', `${reason || 'Unknown error'}. The files are kept. Try "Make ZIP now" in the popup.`);
}
