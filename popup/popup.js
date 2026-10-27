// The popup only sends commands and shows progress. Closing it does not stop the queue.
const $ = (id) => document.getElementById(id);
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

const STATE_WORDS = {
  queued: 'waiting',
  opening: 'opening',
  clicking: 'clicking',
  downloading: 'downloading',
  done: 'saved',
  skipped: 'skipped',
  failed: 'failed',
};

function item(job) {
  const li = document.createElement('li');
  const t = document.createElement('span');
  t.className = 't';
  const name = document.createElement('a');
  name.className = 'name';
  name.textContent = job.title;
  name.href = job.url;
  name.target = '_blank';
  t.append(name);
  if (job.error) {
    const err = document.createElement('span');
    err.className = 'err';
    err.textContent = job.error;
    t.append(err);
  }
  const st = document.createElement('span');
  st.className = 'state';
  st.textContent = STATE_WORDS[job.state] || job.state;
  if (['opening', 'clicking', 'downloading'].includes(job.state) && job.step) st.textContent += ` (${job.step})`;
  li.append(t, st);
  if (['failed', 'skipped'].includes(job.state)) {
    const b = document.createElement('button');
    b.textContent = 'Retry';
    b.onclick = () => send('RETRY_JOB', { jobId: job.id }).then(refresh);
    li.append(b);
  }
  if (job.state === 'queued') {
    const b = document.createElement('button');
    b.textContent = 'Remove';
    b.onclick = () => send('REMOVE_JOB', { jobId: job.id }).then(refresh);
    li.append(b);
  }
  return li;
}

let lastStatus = null;

function premiumItem(job) {
  const li = document.createElement('li');
  const t = document.createElement('span');
  t.className = 't';
  const name = document.createElement('a');
  name.className = 'name';
  name.textContent = job.title || 'Canva Pro Template';
  name.href = job.url;
  name.target = '_blank';
  t.append(name);
  if (job.error) {
    const err = document.createElement('span');
    err.className = 'err';
    err.textContent = job.error;
    t.append(err);
  }
  const st = document.createElement('span');
  st.className = 'state gold';
  st.textContent = 'Pro';
  li.append(t, st);

  const btnQueue = document.createElement('button');
  btnQueue.textContent = 'Queue';
  btnQueue.title = 'Add to active download queue';
  btnQueue.onclick = () => send('RETRY_PREMIUM_JOB', { id: job.id, url: job.url }).then(refresh);

  const btnRemove = document.createElement('button');
  btnRemove.textContent = 'Remove';
  btnRemove.title = 'Remove from premium queue';
  btnRemove.onclick = () => send('REMOVE_PREMIUM_JOB', { id: job.id, url: job.url }).then(refresh);

  li.append(btnQueue, btnRemove);
  return li;
}

async function refresh() {
  const s = await send('STATUS');
  if (!s || s.error) return;
  lastStatus = s;
  const badge = $('badge');
  badge.className = 'badge' + (s.state.running ? ' running' : s.state.paused ? ' paused' : '');
  const sleeping = s.state.running && !s.state.activeJobId && s.state.nextAt - Date.now() > 120000;
  badge.textContent = s.state.running ? (sleeping ? 'Sleeping' : 'Running') : s.state.paused ? 'Paused' : 'Stopped';

  $('reason').hidden = !s.state.reason;
  $('reason').textContent = s.state.reason || '';
  $('n-queued').textContent = s.counts.queued + s.counts.active;
  $('n-done').textContent = s.counts.done;
  $('n-skipped').textContent = s.counts.skipped;
  $('n-failed').textContent = s.counts.failed;
  const premCount = s.premiumQueue ? s.premiumQueue.length : 0;
  $('n-premium').textContent = premCount;
  $('premium-count').textContent = premCount;
  $('eta').textContent = s.eta ? `Finish: ${s.eta}. Files waiting for the next ZIP: ${s.storedFiles}.` : `Files waiting for the next ZIP: ${s.storedFiles}.`;
  const next = sleeping ? ` Next start: ${new Date(s.state.nextAt).toLocaleString()}.` : '';
  $('today').textContent = `Today: ${s.stats.dayCount} of ${s.settings.perDay} started.${next}`;
  $('start').disabled = s.state.running;
  $('pause').disabled = !s.state.running;

  const list = $('list');
  list.replaceChildren(...s.recent.map(item));
  if (!s.recent.length) list.textContent = 'Empty. Tick templates on Canva, or paste links above.';

  const premList = $('premium-list');
  if (s.premiumQueue && s.premiumQueue.length) {
    premList.replaceChildren(...s.premiumQueue.map(premiumItem));
  } else {
    premList.textContent = 'No premium templates tagged yet.';
  }
}

$('start').onclick = () => send('START').then(refresh);
$('pause').onclick = () => send('PAUSE').then(refresh);
$('zip').onclick = () => send('MAKE_ZIP').then(refresh);
$('retry').onclick = () => send('RETRY_FAILED').then(refresh);
$('clear').onclick = () => send('CLEAR_DONE').then(refresh);
$('move-premium').onclick = async () => {
  const res = await send('MOVE_PREMIUM_TO_QUEUE');
  $('premium-msg').textContent = res && res.moved ? `Queued ${res.moved} premium template(s) for download.` : 'No new premium templates to queue.';
  setTimeout(() => { $('premium-msg').textContent = ''; }, 4000);
  refresh();
};
$('copy-premium').onclick = async () => {
  const list = (lastStatus?.premiumQueue || []);
  if (!list.length) {
    $('premium-msg').textContent = 'Premium queue is empty.';
    setTimeout(() => { $('premium-msg').textContent = ''; }, 3000);
    return;
  }
  const urls = list.map((p) => p.url).join('\n');
  await navigator.clipboard.writeText(urls);
  $('copy-premium').textContent = 'Copied!';
  setTimeout(() => { $('copy-premium').textContent = 'Copy URLs'; }, 2000);
};
$('clear-premium').onclick = async () => {
  await send('CLEAR_PREMIUM_QUEUE');
  $('premium-msg').textContent = 'Premium queue cleared.';
  setTimeout(() => { $('premium-msg').textContent = ''; }, 3000);
  refresh();
};
$('debug').onclick = async () => {
  const s = await send('STATUS');
  const text = JSON.stringify({ version: chrome.runtime.getManifest().version, state: s.state, counts: s.counts, recent: s.recent.slice(0, 10) }, null, 1);
  await navigator.clipboard.writeText(text);
  $('debug').textContent = 'Copied';
  setTimeout(() => ($('debug').textContent = 'Copy debug info'), 2000);
};
$('options').onclick = () => chrome.runtime.openOptionsPage();
$('add').onclick = async () => {
  const items = $('links').value.split(/\s+/).filter(Boolean);
  const res = await send('ADD_MANY', { items });
  $('add-msg').textContent = `Added ${res.added}. Skipped ${res.skipped} (already in queue or not a Canva template link).`;
  if (res.added) $('links').value = '';
  refresh();
};

refresh();
setInterval(refresh, 2000);
