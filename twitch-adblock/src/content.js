// Isolated-world content script: carries the user's settings from extension
// storage into the page (page.js) and reports blocked ad breaks back to the
// background worker for the counter and badge.
(() => {
  'use strict';
  const FROM_PAGE = 'ttvab-page';
  const FROM_CONTENT = 'ttvab-content';
  const DEFAULTS = { enabled: true, useBackupStream: true };

  function sendSettings() {
    chrome.storage.local.get(DEFAULTS, (stored) => {
      const settings = { enabled: !!stored.enabled, useBackupStream: !!stored.useBackupStream };
      document.documentElement.classList.toggle('ttvab-on', settings.enabled);
      window.postMessage({ source: FROM_CONTENT, type: 'settings', settings }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== FROM_PAGE) return;
    const msg = event.data;
    if (msg.type === 'ready') sendSettings();
    if (msg.type === 'ad' && msg.state === 'start') {
      chrome.runtime.sendMessage({ type: 'ad-blocked', channel: msg.channel }).catch(() => {});
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('enabled' in changes || 'useBackupStream' in changes)) sendSettings();
  });

  sendSettings();
})();
