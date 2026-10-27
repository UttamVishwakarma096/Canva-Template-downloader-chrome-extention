// Queue, state and stats live in chrome.storage.local so nothing is lost
// when Chrome stops the service worker or the PC restarts.
import { DEFAULTS } from '../config.js';

const ACTIVE = ['opening', 'clicking', 'downloading'];

const emptyState = () => ({
  running: false, // the queue is started
  paused: false,
  reason: null, // why the queue stopped, shown in the popup
  nextAt: 0, // time the next template may start
  activeJobId: null,
  zipPart: 1,
  zipBuilding: false,
  zipDownloadId: null,
  zipKeys: [],
});

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

const emptyStats = () => ({
  day: today(),
  dayCount: 0, // templates started today (counts against the daily limit)
  daySaved: 0,
  daySkipped: 0,
  dayFailed: 0,
  hourStart: Date.now(),
  hourCount: 0,
});

export async function settings() {
  const { settings: s } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...s, format: 'pptx' };
}

export async function read() {
  const d = await chrome.storage.local.get(['queue', 'premiumQueue', 'state', 'stats']);
  return {
    queue: d.queue || [],
    premiumQueue: d.premiumQueue || [],
    state: { ...emptyState(), ...d.state },
    stats: { ...emptyStats(), ...d.stats },
  };
}

// Run changes one after another, so two events never overwrite each other.
let chain = Promise.resolve();
export function update(mutate) {
  const run = chain.then(async () => {
    const d = await read();
    const out = await mutate(d);
    await chrome.storage.local.set({
      queue: d.queue,
      premiumQueue: d.premiumQueue,
      state: d.state,
      stats: d.stats,
    });
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

export const activeJob = (d) => d.queue.find((j) => j.id === d.state.activeJobId) || null;
export const isActive = (job) => !!job && ACTIVE.includes(job.state);
