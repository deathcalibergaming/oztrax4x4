// Runs in the twitch.tv page's own JavaScript world (MAIN), at document_start,
// after worker-hook.js has defined ttvabWorkerHook in the same world.
//
// Twitch's player does its networking inside a Web Worker it builds from a
// blob: URL, out of reach of a content script. So this replaces
// window.Worker: when the player creates its worker, the worker's source is
// read back and re-wrapped with ttvabWorkerHook in front of it.
//
// It also relays messages between the extension (content.js, isolated world,
// via window.postMessage) and the hooked workers (via a BroadcastChannel whose
// name is unique to this tab, so two Twitch tabs never hear each other).
(() => {
  'use strict';
  if (window.__ttvabInstalled || typeof ttvabWorkerHook !== 'function') return;
  window.__ttvabInstalled = true;

  const FROM_PAGE = 'ttvab-page';
  const FROM_CONTENT = 'ttvab-content';
  const busName = 'ttvab-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const bus = new BroadcastChannel(busName);

  let settings = { enabled: true, useBackupStream: true };
  const headers = {};
  const deviceCookie = document.cookie.match(/(?:^|;\s*)unique_id=([^;]+)/);
  if (deviceCookie) headers['X-Device-Id'] = decodeURIComponent(deviceCookie[1]);

  // ---- extension <-> page <-> workers ------------------------------------

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== FROM_CONTENT) return;
    if (event.data.type === 'settings' && event.data.settings) {
      settings = Object.assign({}, settings, event.data.settings);
      bus.postMessage({ type: 'settings', settings });
    }
  });

  bus.onmessage = (event) => {
    const msg = event.data;
    if (msg && msg.type === 'ad') window.postMessage(Object.assign({ source: FROM_PAGE }, msg), '*');
  };

  // content.js may load before or after this script; whichever comes second
  // completes the handshake.
  window.postMessage({ source: FROM_PAGE, type: 'ready' }, '*');

  // ---- borrow the headers Twitch's own GQL calls carry --------------------
  // The backup-stream token request is more likely to succeed with the same
  // device ID and integrity token the site is already using.

  const CAPTURED = ['X-Device-Id', 'Device-ID', 'Client-Integrity', 'Client-Version', 'Client-Session-Id'];
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      if (typeof url === 'string' && url.startsWith('https://gql.twitch.tv/')) {
        const h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
        let changed = false;
        for (const name of CAPTURED) {
          const value = h.get(name);
          const key = name === 'Device-ID' ? 'X-Device-Id' : name;
          if (value && headers[key] !== value) {
            headers[key] = value;
            changed = true;
          }
        }
        if (changed) bus.postMessage({ type: 'headers', headers });
      }
    } catch (e) {
      /* header capture is best-effort */
    }
    return realFetch.apply(this, arguments);
  };

  // ---- Worker hook --------------------------------------------------------

  const RealWorker = window.Worker;
  const PLAYER_WORKER = /amazon-ivs|wasmworker|ivs-wasm/i;

  function readSync(url) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    return xhr.status >= 200 && xhr.status < 300 ? xhr.responseText : null;
  }

  function wrapPlayerWorker(url, options) {
    if (options && options.type === 'module') return null;
    const href = String(url);
    if (!href.startsWith('blob:')) return null;
    const source = readSync(href);
    if (!source || !PLAYER_WORKER.test(source)) return null;
    const config = { settings, headers, busName };
    const code = '(' + ttvabWorkerHook.toString() + ')(self, ' + JSON.stringify(config) + ');\n' + source;
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }

  class HookedWorker extends RealWorker {
    constructor(url, options) {
      let target = url;
      try {
        target = wrapPlayerWorker(url, options) || url;
      } catch (e) {
        console.warn('[Twitch Ad Shield] could not hook the player worker', e);
      }
      super(target, options);
    }
  }

  Object.defineProperty(window, 'Worker', { value: HookedWorker, writable: true, configurable: true });
})();
