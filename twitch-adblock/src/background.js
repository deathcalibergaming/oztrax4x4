// Counts blocked ad breaks: a running total in storage for the popup, and a
// per-tab count on the toolbar badge.
const tabCounts = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['enabled', 'useBackupStream', 'adsBlocked']);
  await chrome.storage.local.set({
    enabled: stored.enabled ?? true,
    useBackupStream: stored.useBackupStream ?? true,
    adsBlocked: stored.adsBlocked ?? 0,
  });
  chrome.action.setBadgeBackgroundColor({ color: '#9146ff' });
});

// Increments are chained so two tabs hitting an ad at once can't race.
let pending = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'ad-blocked') return;
  pending = pending.then(async () => {
    const { adsBlocked = 0 } = await chrome.storage.local.get('adsBlocked');
    await chrome.storage.local.set({ adsBlocked: adsBlocked + 1 });
  });
  const tabId = sender.tab && sender.tab.id;
  if (tabId !== undefined) {
    const n = (tabCounts.get(tabId) || 0) + 1;
    tabCounts.set(tabId, n);
    chrome.action.setBadgeText({ tabId, text: String(n) });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabCounts.delete(tabId));
