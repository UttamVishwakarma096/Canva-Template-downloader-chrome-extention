// Hidden page: reads stored files, builds one ZIP and gives back a link to it.
// A service worker cannot make blob links, so this page does it.
import { listFiles } from '../lib/fileStore.js';
import { buildZip, uniqueNames } from '../lib/zip.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'BUILD_ZIP') return;
  (async () => {
    const files = await listFiles(msg.limit);
    if (!files.length) return { error: 'no files to pack' };
    const names = uniqueNames(files.map((f) => f.name));
    const zip = await buildZip(files.map((f, i) => ({ name: names[i], blob: f.blob })));
    return { url: URL.createObjectURL(zip), keys: files.map((f) => f.jobId) };
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true;
});
