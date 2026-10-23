// Decides when the next template starts: one at a time, random waits,
// hourly and daily limits. Also ends each job and restarts after a reboot.
import { update, read, settings, activeJob, isActive, today } from './store.js';
import { openJobTab, closeTab, closeWorkerWindow } from './tabs.js';
import { notify, keepAwake } from './notify.js';
import { maybeBuildZip } from './downloads.js';

let timer = null;

// Alarms fire at most every 30 seconds, so short waits also use a timer
// while the service worker is awake. tick() is safe to call twice.
function schedule(ms) {
  const when = Date.now() + Math.max(ms, 1000);
  chrome.alarms.create('tick', { when });
  clearTimeout(timer);
  if (ms < 60000) timer = setTimeout(tick, Math.max(ms, 1000));
}

const randomWait = (s) => (s.minWaitSec + Math.random() * (s.maxWaitSec - s.minWaitSec)) * 1000;

function nextMidnight() {
  const t = new Date();
  t.setHours(24, 0, 30, 0);
  return t.getTime();
}

// New day: send yesterday's summary and reset the counters.
function rollStats(d) {
  const now = Date.now();
  let summary = null;
  if (d.stats.day !== today()) {
    const s = d.stats;
    if (s.dayCount) summary = `${s.day}: ${s.daySaved} saved, ${s.daySkipped} skipped, ${s.dayFailed} failed.`;
    d.stats = { day: today(), dayCount: 0, daySaved: 0, daySkipped: 0, dayFailed: 0, hourStart: now, hourCount: 0 };
  }
  if (now - d.stats.hourStart >= 3600e3) {
    d.stats.hourStart = now;
    d.stats.hourCount = 0;
  }
  return summary;
}

export async function tick() {
  const s = await settings();
  let action = null;
  let summary = null;
  await update((d) => {
    summary = rollStats(d);
    if (!d.state.running || d.state.activeJobId) return;
    const now = Date.now();
    if (now < d.state.nextAt - 500) {
      action = { wait: d.state.nextAt - now };
      return;
    }
    if (d.stats.dayCount >= s.perDay) {
      d.state.nextAt = nextMidnight();
      action = { wait: d.state.nextAt - now };
      return;
    }
    if (d.stats.hourCount >= s.perHour) {
      d.state.nextAt = d.stats.hourStart + 3600e3;
      action = { wait: d.state.nextAt - now };
      return;
    }
    const job = d.queue.find((j) => j.state === 'queued');
    if (!job) {
      d.state.running = false;
      d.state.reason = 'Queue finished';
      action = { finished: true };
      return;
    }
    Object.assign(job, {
      state: 'opening',
      step: 'open-tab',
      attempts: (job.attempts || 0) + 1,
      tabId: null,
      downloadId: null,
      error: null,
      updatedAt: now,
    });
    d.state.activeJobId = job.id;
    d.stats.dayCount++;
    d.stats.hourCount++;
    action = { start: { ...job } };
  });

  if (summary) notify('Daily summary', summary);
  if (!action) return;
  if (action.wait) return schedule(action.wait);
  if (action.finished) {
    keepAwake(false);
    closeWorkerWindow();
    const { stats } = await read();
    notify('Queue finished', `Today: ${stats.daySaved} saved, ${stats.daySkipped} skipped, ${stats.dayFailed} failed.`);
    return maybeBuildZip(true);
  }
  keepAwake(true);
  try {
    await openJobTab(action.start);
  } catch (e) {
    await finishJob(action.start.id, { kind: 'retry', error: `Could not open tab: ${e.message}` });
  }
}

// result: { ok: true, loose? } or { kind: 'retry' | 'skip' | 'stop', error }
export async function finishJob(jobId, result) {
  const s = await settings();
  let tabId = null;
  let stopped = null;
  const handled = await update((d) => {
    const job = d.queue.find((j) => j.id === jobId);
    if (!job || d.state.activeJobId !== jobId) return false;
    tabId = job.tabId;
    if (result.ok) {
      job.state = 'done';
      job.error = result.loose ? 'Saved outside the ZIP (in the not-in-zip folder)' : null;
      d.stats.daySaved++;
    } else if (result.kind === 'skip') {
      job.state = 'skipped';
      job.error = result.error;
      d.stats.daySkipped++;
    } else if (result.kind === 'stop') {
      // Not the template's fault: put it back and stop everything.
      job.state = 'queued';
      job.attempts = Math.max(0, (job.attempts || 1) - 1);
      job.error = result.error;
      d.state.running = false;
      d.state.paused = true;
      d.state.reason = result.error;
      stopped = result.error;
    } else if ((job.attempts || 0) < s.maxAttempts) {
      job.state = 'queued';
      job.error = `${result.error} (will try again)`;
    } else {
      job.state = 'failed';
      job.error = result.error;
      d.stats.dayFailed++;
    }
    job.tabId = null;
    job.updatedAt = Date.now();
    d.state.activeJobId = null;
    d.state.nextAt = Date.now() + randomWait(s);
    return true;
  });
  if (!handled) return;
  await closeTab(tabId);
  if (stopped) {
    keepAwake(false);
    notify('Canva download stopped', `${stopped}. Fix it, then press Start in the popup.`);
    return;
  }
  const { state } = await read();
  if (state.running) schedule(state.nextAt - Date.now());
  maybeBuildZip(false);
}

export async function start() {
  await update((d) => {
    d.state.running = true;
    d.state.paused = false;
    d.state.reason = null;
    d.state.nextAt = 0;
  });
  keepAwake(true);
  await tick();
}

// The job that is open now still finishes; no new job starts.
export async function pause() {
  await update((d) => {
    d.state.running = false;
    d.state.paused = true;
    d.state.reason = 'Paused by you';
  });
  keepAwake(false);
}

// After Chrome or the PC restarts: the open job starts again from the beginning.
export async function restore() {
  let tabId = null;
  await update((d) => {
    const job = activeJob(d);
    if (isActive(job)) {
      tabId = job.tabId;
      job.state = 'queued';
      job.attempts = Math.max(0, (job.attempts || 1) - 1);
      job.tabId = null;
    }
    d.state.activeJobId = null;
    d.state.zipBuilding = false;
    d.state.zipDownloadId = null;
    d.state.nextAt = 0;
  });
  await closeTab(tabId);
  const { state } = await read();
  if (state.running) {
    keepAwake(true);
    await tick();
  }
  maybeBuildZip(!state.running);
}

// Runs every minute: catches a job that stopped moving.
export async function watchdog() {
  const s = await settings();
  const d = await read();
  const job = activeJob(d);
  if (isActive(job) && Date.now() - job.updatedAt > s.jobTimeoutSec * 1000) {
    await finishJob(job.id, { kind: 'retry', error: `No progress for ${s.jobTimeoutSec} seconds at step "${job.step}"` });
    return;
  }
  if (!job && d.state.running) await tick();
}
