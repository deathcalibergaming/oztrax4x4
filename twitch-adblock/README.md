# Twitch Ad Shield

A Chrome extension (Manifest V3) that blocks Twitch stream ads. There's
nothing to build: load the folder as-is.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this `twitch-adblock` folder.
3. Reload any Twitch tabs that were already open.

It also works in other Chromium browsers (Edge, Brave, Opera, Vivaldi) on
version 111 or later.

## How it works

Twitch doesn't serve ads from a separate ad server the way most sites do. It
splices ("stitches") them into the video stream itself, on its own servers,
so blocking ad domains does almost nothing. The ads show up as extra
segments in the HLS playlist the player re-downloads every couple of
seconds.

The player does its networking in a Web Worker, out of reach of normal
content scripts. So:

- `src/page.js` runs in the page's own JavaScript world at `document_start`
  and replaces `window.Worker`. When the player creates its worker, the
  extension reads the worker's source and puts `src/worker-hook.js` in front
  of it.
- `src/worker-hook.js` wraps `fetch` inside the worker. It remembers each
  channel's stream variants from the master playlist (`usher.ttvnw.net`),
  then checks every media playlist refresh for ad segments. When an ad break
  starts it:
  1. **Backup stream** (default): asks Twitch for a playback token under a
     different player type (`embed`, then `popout`, then `autoplay`), which
     is often served without ads, picks the matching quality, and gives the
     player that playlist until the break ends. Then it switches back.
  2. **Strip**: if no ad-free copy is available (or the backup option is
     off), it cuts the ad segments, ad metadata and prefetch hints out of
     the playlist. The picture holds on the last live frame until the break
     is over, instead of playing the ad.
- `src/content.js` passes your settings into the page and reports each
  blocked break to `src/background.js`, which keeps the count shown in the
  popup and on the toolbar badge.
- `src/content.css` hides leftover ad UI (the "Ad" label and countdown,
  squeezeback frames).
- `rules/ad-domains.json` blocks the few third-party ad networks Twitch
  pages still call (Amazon, DoubleClick, IMA, Google syndication).

The popup has two switches: **Block ads** (takes effect in open players
immediately) and **Use ad-free backup stream**.

## Limitations

- Twitch changes its ad delivery regularly. If ads come back, the likely
  breakage points are the worker-source test in `page.js`
  (`PLAYER_WORKER`) and the ad markers in `worker-hook.js` (`hasAds`).
- When no ad-free backup is available, a break shows a frozen frame (or a
  short buffering spinner) rather than the stream. Usually under a minute.
- Switching to the backup can cost a moment of buffering, and the backup
  may top out at a lower quality than you picked.
- Pre-roll breaks that start before the first playlist loads are handled
  the same way; there's nothing extra to do, but they're the most likely to
  show a brief stall.

## Development

```sh
npm test            # playlist parsing, ad stripping, backup-stream switching
npm run icons       # redraw icons/*.png from tools/make-icons.mjs
```

Tests run on Node 18+ with no dependencies.
