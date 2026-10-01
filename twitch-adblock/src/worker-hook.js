// Runs inside Twitch's video player Web Worker.
//
// page.js never calls this function directly: it stringifies it and prepends
// `(ttvabWorkerHook)(self, config)` to the player worker's own source, so the
// hook wraps `fetch` before the player makes its first request. That means the
// function must be fully self-contained - no references to anything outside
// its own body.
//
// Twitch serves "stitched" ads: ad segments are spliced server-side into the
// HLS media playlist the player polls every couple of seconds. The hook
// watches those playlists and, when ad segments show up:
//   1. asks for a second copy of the stream under a different player type
//      (embed, popout, ...), which is often served without ads, and hands the
//      player that playlist until the break is over; or, failing that,
//   2. strips the ad segments out of the playlist, so the player holds on the
//      last live frame instead of playing the ad.
function ttvabWorkerHook(scope, config) {
  'use strict';

  const GQL_URL = 'https://gql.twitch.tv/gql';
  // Twitch's public web client ID - the same one twitch.tv itself sends.
  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const ACCESS_TOKEN_QUERY =
    'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {' +
    ' streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename }' +
    ' videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename }' +
    '}';
  // How long to stop asking for a backup stream once every player type has
  // come back with ads too. Playlists refresh every ~2s, so without this a
  // long break would fire a burst of GQL requests on every refresh.
  const BACKUP_RETRY_MS = 15000;

  config = config || {};
  let settings = Object.assign(
    { enabled: true, useBackupStream: true, backupPlayerTypes: ['embed', 'popout', 'autoplay'] },
    config.settings
  );
  let authHeaders = Object.assign({}, config.headers);

  const realFetch = scope.fetch.bind(scope);
  const channels = new Map(); // channel login -> state
  const variants = new Map(); // media playlist URL -> { channel, resolution, frameRate }

  let bus = null;
  if (config.busName && typeof scope.BroadcastChannel === 'function') {
    bus = new scope.BroadcastChannel(config.busName);
    bus.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'settings' && msg.settings) settings = Object.assign(settings, msg.settings);
      if (msg.type === 'headers' && msg.headers) authHeaders = Object.assign(authHeaders, msg.headers);
    };
  }
  function notify(msg) {
    if (bus) {
      try { bus.postMessage(msg); } catch (e) { /* the page went away */ }
    }
  }

  // ---- playlist parsing -------------------------------------------------

  function parseAttributes(line) {
    const attrs = {};
    const body = line.slice(line.indexOf(':') + 1);
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    let m;
    while ((m = re.exec(body))) attrs[m[1]] = m[2].replace(/^"|"$/g, '');
    return attrs;
  }

  function parseMasterPlaylist(text, baseUrl) {
    const lines = text.split('\n').map((l) => l.trim());
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const attrs = parseAttributes(lines[i]);
      let j = i + 1;
      while (j < lines.length && (lines[j] === '' || lines[j].startsWith('#'))) j++;
      if (j >= lines.length) break;
      out.push({
        url: new URL(lines[j], baseUrl).href,
        resolution: attrs.RESOLUTION || '',
        frameRate: parseFloat(attrs['FRAME-RATE']) || 0,
        bandwidth: parseInt(attrs.BANDWIDTH, 10) || 0,
      });
      i = j;
    }
    return out;
  }

  // Live segments are titled "live"; ad segments carry the ad's own title.
  function isLiveSegment(extinfLine) {
    const title = extinfLine.slice(extinfLine.indexOf(',') + 1);
    return title.includes('live');
  }

  function hasAds(text) {
    if (text.includes('stitched-ad') || text.includes('X-TV-TWITCH-AD')) return true;
    return text.split('\n').some((l) => l.startsWith('#EXTINF') && !isLiveSegment(l));
  }

  // Removes ad segments, ad metadata and (during a break) the low-latency
  // prefetch hints, which point at ad segments too. Segments removed from the
  // front of the playlist advance EXT-X-MEDIA-SEQUENCE so the player's
  // sequence numbering still lines up with the segments that remain.
  function stripAdSegments(text) {
    const lines = text.split('\n');
    const out = [];
    let removedBeforeFirstKept = 0;
    let keptAny = false;
    let seqIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-DATERANGE') && /stitched-ad|X-TV-TWITCH-AD|twitch-ad/i.test(line)) continue;
      if (line.startsWith('#EXT-X-TWITCH-PREFETCH:')) continue;
      if (line.startsWith('#EXTINF')) {
        if (isLiveSegment(line)) {
          keptAny = true;
          out.push(line);
          continue;
        }
        // Drop the EXTINF, any tags between it and its URI, and the URI.
        while (i + 1 < lines.length && (lines[i + 1].startsWith('#') || lines[i + 1].trim() === '')) i++;
        i++;
        if (!keptAny) removedBeforeFirstKept++;
        continue;
      }
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seqIndex = out.length;
      out.push(line);
    }

    if (seqIndex >= 0 && removedBeforeFirstKept > 0) {
      const seq = parseInt(out[seqIndex].split(':')[1], 10);
      if (!Number.isNaN(seq)) out[seqIndex] = '#EXT-X-MEDIA-SEQUENCE:' + (seq + removedBeforeFirstKept);
    }
    return out.join('\n');
  }

  function pickVariant(list, wanted) {
    if (!list.length) return null;
    if (wanted) {
      const exact = list.find((v) => v.resolution === wanted.resolution && Math.round(v.frameRate) === Math.round(wanted.frameRate));
      if (exact) return exact;
      const height = (r) => parseInt(String(r).split('x')[1], 10) || 0;
      const target = height(wanted.resolution);
      if (target) {
        return list.slice().sort((a, b) => Math.abs(height(a.resolution) - target) - Math.abs(height(b.resolution) - target))[0];
      }
    }
    return list[0];
  }

  // ---- backup stream ----------------------------------------------------

  async function getAccessToken(channel, playerType) {
    const headers = { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' };
    for (const name of ['X-Device-Id', 'Client-Integrity', 'Client-Version', 'Client-Session-Id']) {
      if (authHeaders[name]) headers[name] = authHeaders[name];
    }
    const res = await realFetch(GQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operationName: 'PlaybackAccessToken_Template',
        query: ACCESS_TOKEN_QUERY,
        variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const token = json && json.data && json.data.streamPlaybackAccessToken;
    return token && token.value && token.signature ? token : null;
  }

  async function loadBackupVariants(state, playerType) {
    const token = await getAccessToken(state.channel, playerType);
    if (!token) return null;
    const url = new URL(state.masterUrl);
    url.searchParams.set('sig', token.signature);
    url.searchParams.set('token', token.value);
    url.searchParams.set('p', String(Math.floor(Math.random() * 1e7)));
    const res = await realFetch(url.href);
    if (!res.ok) return null;
    return parseMasterPlaylist(await res.text(), url.href);
  }

  // Returns an ad-free media playlist from another player type, or null.
  async function getBackupPlaylist(state, variant) {
    if (Date.now() < state.backupRetryAt) return null;
    const types = settings.backupPlayerTypes || [];
    // Start with whichever type worked last time in this break.
    const order = state.backupType ? [state.backupType].concat(types.filter((t) => t !== state.backupType)) : types;

    for (const playerType of order) {
      try {
        if (!state.backups[playerType]) state.backups[playerType] = await loadBackupVariants(state, playerType);
        const list = state.backups[playerType];
        const chosen = list && pickVariant(list, variant);
        if (!chosen) continue;
        const res = await realFetch(chosen.url);
        if (!res.ok) {
          state.backups[playerType] = null;
          continue;
        }
        const text = await res.text();
        if (!hasAds(text)) {
          state.backupType = playerType;
          return text;
        }
      } catch (e) {
        state.backups[playerType] = null;
      }
    }
    state.backupType = null;
    state.backupRetryAt = Date.now() + BACKUP_RETRY_MS;
    return null;
  }

  // ---- fetch hook -------------------------------------------------------

  function channelState(channel, masterUrl) {
    let state = channels.get(channel);
    if (!state) {
      state = { channel, masterUrl, inAd: false, method: null, backups: {}, backupType: null, backupRetryAt: 0 };
      channels.set(channel, state);
    }
    if (masterUrl) state.masterUrl = masterUrl;
    return state;
  }

  function respondWith(text, original) {
    return new Response(text, { status: original.status, statusText: original.statusText, headers: original.headers });
  }

  async function onMasterPlaylist(url, res) {
    const text = await res.text();
    const channel = decodeURIComponent(new URL(url).pathname.split('/').pop().replace(/\.m3u8$/, '')).toLowerCase();
    channelState(channel, url);
    for (const v of parseMasterPlaylist(text, url)) {
      variants.set(v.url, { channel, resolution: v.resolution, frameRate: v.frameRate });
    }
    return respondWith(text, res);
  }

  async function onMediaPlaylist(url, variant, res) {
    const text = await res.text();
    const state = channelState(variant.channel);

    if (!hasAds(text)) {
      if (state.inAd) {
        state.inAd = false;
        notify({ type: 'ad', state: 'end', channel: state.channel, method: state.method });
      }
      return respondWith(text, res);
    }

    if (!state.inAd) {
      state.inAd = true;
      state.backups = {};
      state.backupType = null;
      state.backupRetryAt = 0;
      state.method = null;
      notify({ type: 'ad', state: 'start', channel: state.channel });
    }

    let out = null;
    if (settings.useBackupStream && state.masterUrl) out = await getBackupPlaylist(state, variant);
    const method = out ? 'backup' : 'strip';
    if (!out) out = stripAdSegments(text);
    if (method !== state.method) {
      state.method = method;
      notify({ type: 'ad', state: 'method', channel: state.channel, method });
    }
    return respondWith(out, res);
  }

  scope.fetch = async function (input, init) {
    let url;
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    } catch (e) {
      return realFetch(input, init);
    }
    if (!settings.enabled || typeof url !== 'string') return realFetch(input, init);

    try {
      if (/^https:\/\/usher\.ttvnw\.net\/api\/channel\/hls\/[^/]+\.m3u8/.test(url)) {
        const res = await realFetch(input, init);
        return res.ok ? onMasterPlaylist(url, res) : res;
      }
      const variant = url.includes('.m3u8') ? variants.get(url) : null;
      if (variant) {
        const res = await realFetch(input, init);
        return res.ok ? onMediaPlaylist(url, variant, res) : res;
      }
    } catch (e) {
      // Never break playback over a bug in here.
      if (scope.console) scope.console.warn('[Twitch Ad Shield]', e);
    }
    return realFetch(input, init);
  };

  // Exposed for the unit tests; harmless inside the worker.
  return { parseMasterPlaylist, hasAds, stripAdSegments, pickVariant, channels, variants };
}
