// Chrome notifications and keeping the PC awake while the queue runs.
export function notify(title, message) {
  chrome.notifications.create('', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 1,
  });
}

export function keepAwake(on) {
  if (on) chrome.power.requestKeepAwake('system');
  else chrome.power.releaseKeepAwake();
}
