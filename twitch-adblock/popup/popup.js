const DEFAULTS = { enabled: true, useBackupStream: true, adsBlocked: 0 };
const enabled = document.getElementById('enabled');
const useBackupStream = document.getElementById('useBackupStream');
const count = document.getElementById('count');

function render(state) {
  enabled.checked = state.enabled;
  useBackupStream.checked = state.useBackupStream;
  useBackupStream.disabled = !state.enabled;
  count.textContent = Number(state.adsBlocked || 0).toLocaleString();
}

chrome.storage.local.get(DEFAULTS, render);

enabled.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabled.checked });
  useBackupStream.disabled = !enabled.checked;
});
useBackupStream.addEventListener('change', () => chrome.storage.local.set({ useBackupStream: useBackupStream.checked }));
document.getElementById('reset').addEventListener('click', () => chrome.storage.local.set({ adsBlocked: 0 }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.adsBlocked) count.textContent = Number(changes.adsBlocked.newValue || 0).toLocaleString();
});
