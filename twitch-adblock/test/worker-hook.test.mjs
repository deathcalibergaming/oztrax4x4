// Run with `node --test test/` from twitch-adblock/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/worker-hook.js', import.meta.url), 'utf8');
const ttvabWorkerHook = new Function(source + '\nreturn ttvabWorkerHook;')();

const USHER = 'https://usher.ttvnw.net/api/channel/hls/somechannel.m3u8?sig=main&token=main';
const MASTER = (tag) => `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000
https://video-weaver.example.hls.ttvnw.net/v1/playlist/${tag}-1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="720p60",FRAME-RATE=60.000
https://video-weaver.example.hls.ttvnw.net/v1/playlist/${tag}-720.m3u8
`;
const LIVE = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:2.000,live
https://cdn.example/live-100.ts
#EXTINF:2.000,live
https://cdn.example/live-101.ts
#EXT-X-TWITCH-PREFETCH:https://cdn.example/live-102.ts`;
const AD_AT_END = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:2.000,live
https://cdn.example/live-100.ts
#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-10-01T00:00:00Z",X-TV-TWITCH-AD-URL="https://ads.example"
#EXTINF:2.000,Amazon|123
https://cdn.example/ad-1.ts
#EXT-X-TWITCH-PREFETCH:https://cdn.example/ad-2.ts`;
const AD_AT_START = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:200
#EXTINF:2.000,Amazon|123
https://cdn.example/ad-9.ts
#EXTINF:2.000,Amazon|123
https://cdn.example/ad-10.ts
#EXTINF:2.000,live
https://cdn.example/live-202.ts`;

function makeScope(routes) {
  const calls = [];
  const scope = {
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push({ url, init });
      for (const [match, reply] of routes) {
        if (url.startsWith(match)) {
          const body = typeof reply === 'function' ? reply(url, init) : reply;
          return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
        }
      }
      return new Response('not found', { status: 404 });
    },
  };
  return { scope, calls };
}

test('parses master playlists', () => {
  const { parseMasterPlaylist } = ttvabWorkerHook(makeScope([]).scope, {});
  const list = parseMasterPlaylist(MASTER('main'), USHER);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    url: 'https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-1080.m3u8',
    resolution: '1920x1080',
    frameRate: 60,
    bandwidth: 8000000,
  });
});

test('detects ads', () => {
  const { hasAds } = ttvabWorkerHook(makeScope([]).scope, {});
  assert.equal(hasAds(LIVE), false);
  assert.equal(hasAds(AD_AT_END), true);
  assert.equal(hasAds(AD_AT_START), true);
});

test('strips trailing ad segments, metadata and prefetch hints', () => {
  const { stripAdSegments, hasAds } = ttvabWorkerHook(makeScope([]).scope, {});
  const out = stripAdSegments(AD_AT_END);
  assert.equal(hasAds(out), false);
  assert.ok(out.includes('live-100.ts'));
  assert.ok(!out.includes('ad-1.ts'));
  assert.ok(!out.includes('ad-2.ts'));
  assert.ok(out.includes('#EXT-X-MEDIA-SEQUENCE:100'));
});

test('advances the media sequence past leading ad segments', () => {
  const { stripAdSegments } = ttvabWorkerHook(makeScope([]).scope, {});
  const out = stripAdSegments(AD_AT_START);
  assert.ok(out.includes('#EXT-X-MEDIA-SEQUENCE:202'));
  assert.ok(out.includes('live-202.ts'));
  assert.ok(!out.includes('ad-9.ts'));
});

test('picks the closest backup variant', () => {
  const { pickVariant } = ttvabWorkerHook(makeScope([]).scope, {});
  const list = [
    { url: 'a', resolution: '1920x1080', frameRate: 60 },
    { url: 'b', resolution: '1280x720', frameRate: 30 },
  ];
  assert.equal(pickVariant(list, { resolution: '1280x720', frameRate: 30 }).url, 'b');
  assert.equal(pickVariant(list, { resolution: '852x480', frameRate: 30 }).url, 'b');
  assert.equal(pickVariant(list, null).url, 'a');
});

test('swaps in an ad-free backup stream during a break', async () => {
  let mainHasAd = true;
  const { scope, calls } = makeScope([
    ['https://usher.ttvnw.net/api/channel/hls/somechannel.m3u8?sig=main', MASTER('main')],
    ['https://usher.ttvnw.net/api/channel/hls/somechannel.m3u8?sig=embed-sig', MASTER('backup')],
    ['https://gql.twitch.tv/gql', { data: { streamPlaybackAccessToken: { value: '{"t":1}', signature: 'embed-sig' } } }],
    ['https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-720.m3u8', () => (mainHasAd ? AD_AT_END : LIVE)],
    ['https://video-weaver.example.hls.ttvnw.net/v1/playlist/backup-720.m3u8', LIVE.replace('live-101', 'backup-101')],
  ]);
  ttvabWorkerHook(scope, { settings: { backupPlayerTypes: ['embed'] }, headers: { 'X-Device-Id': 'dev' } });

  const master = await scope.fetch(USHER);
  assert.equal(await master.text(), MASTER('main'));

  const during = await (await scope.fetch('https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-720.m3u8')).text();
  assert.ok(during.includes('backup-101.ts'), 'served the backup playlist');
  const gql = calls.find((c) => c.url === 'https://gql.twitch.tv/gql');
  assert.equal(JSON.parse(gql.init.body).variables.playerType, 'embed');
  assert.equal(gql.init.headers['X-Device-Id'], 'dev');

  mainHasAd = false;
  const after = await (await scope.fetch('https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-720.m3u8')).text();
  assert.equal(after, LIVE, 'back on the main stream once the break ends');
});

test('falls back to stripping when the backup also has ads', async () => {
  const { scope, calls } = makeScope([
    ['https://usher.ttvnw.net/api/channel/hls/somechannel.m3u8?sig=main', MASTER('main')],
    ['https://usher.ttvnw.net/api/channel/hls/somechannel.m3u8?sig=embed-sig', MASTER('backup')],
    ['https://gql.twitch.tv/gql', { data: { streamPlaybackAccessToken: { value: 'x', signature: 'embed-sig' } } }],
    ['https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-1080.m3u8', AD_AT_END],
    ['https://video-weaver.example.hls.ttvnw.net/v1/playlist/backup-1080.m3u8', AD_AT_END],
  ]);
  const hook = ttvabWorkerHook(scope, { settings: { backupPlayerTypes: ['embed'] } });
  await scope.fetch(USHER);
  const out = await (await scope.fetch('https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-1080.m3u8')).text();
  assert.equal(hook.hasAds(out), false);

  // The next refresh inside the retry window must not hit GQL again.
  const gqlCalls = calls.filter((c) => c.url.startsWith('https://gql')).length;
  await scope.fetch('https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-1080.m3u8');
  assert.equal(calls.filter((c) => c.url.startsWith('https://gql')).length, gqlCalls);
});

test('passes everything through untouched when disabled', async () => {
  const { scope } = makeScope([
    ['https://usher.ttvnw.net/', MASTER('main')],
    ['https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-720.m3u8', AD_AT_END],
  ]);
  ttvabWorkerHook(scope, { settings: { enabled: false } });
  await scope.fetch(USHER);
  const out = await (await scope.fetch('https://video-weaver.example.hls.ttvnw.net/v1/playlist/main-720.m3u8')).text();
  assert.equal(out, AD_AT_END);
});
