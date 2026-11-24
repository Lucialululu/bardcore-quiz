// Spotify Embed (iFrame API) wrapper. No developer account or API key needed.
// If the host browser is logged in to Spotify, full tracks play; otherwise
// Spotify usually limits the embed to 30-second previews.

export function toUri(input) {
  const s = String(input ?? '').trim();
  let m = s.match(/^spotify:(track|episode):([A-Za-z0-9]{22})$/);
  if (m) return `spotify:${m[1]}:${m[2]}`;
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|episode)\/([A-Za-z0-9]{22})/i);
  return m ? `spotify:${m[1]}:${m[2]}` : null;
}

export function toUrl(uri) {
  const [, type, id] = String(uri).split(':');
  return `https://open.spotify.com/${type}/${id}`;
}

// Track name + cover art via Spotify's public oEmbed endpoint.
export async function fetchInfo(uri) {
  try {
    const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(toUrl(uri)));
    if (!r.ok) return null;
    const j = await r.json();
    return { name: j.title || '', thumb: j.thumbnail_url || '' };
  } catch {
    return null;
  }
}

let apiPromise = null;
function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = (IFrameAPI) => resolve(IFrameAPI);
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => reject(new Error('Could not load the Spotify player'));
    document.body.appendChild(s);
  });
  return apiPromise;
}

const timeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

/**
 * createPlayer(el, firstUri, { onPlaying, onBlocked })
 * Returns { playClip(uri, startSec), replay(), pause(), resume(), ready }
 */
export function createPlayer(el, firstUri, { onPlaying = () => {}, onBlocked = () => {} } = {}) {
  let controller = null;
  let currentUri = firstUri;
  let startedCurrent = false;
  let clipStart = 0;
  let pendingSeek = null;
  let playingSeen = false;
  let readyResolvers = [];

  const ready = timeout(
    loadApi().then(
      (API) =>
        new Promise((resolve) => {
          API.createController(el, { uri: firstUri, width: '100%', height: 152 }, (c) => {
            controller = c;
            c.addListener('ready', () => {
              const rs = readyResolvers;
              readyResolvers = [];
              rs.forEach((r) => r());
            });
            c.addListener('playback_update', (e) => {
              const d = e.data || {};
              if (!d.isPaused) {
                playingSeen = true;
                onPlaying(true);
                const pos = (d.position || 0) / 1000;
                if (pendingSeek != null) {
                  const target = pendingSeek;
                  pendingSeek = null;
                  if (pos < target - 1.5) c.seek(target);
                }
              } else {
                onPlaying(false);
              }
            });
            resolve(c);
          });
        }),
    ),
    15000,
    'The Spotify player did not load',
  );

  const waitReady = () => timeout(new Promise((r) => readyResolvers.push(r)), 6000, 'load').catch(() => {});

  function watchdog() {
    playingSeen = false;
    setTimeout(() => { if (!playingSeen) onBlocked(); }, 4000);
  }

  async function playClip(uri, startSec = 0) {
    const c = await ready;
    clipStart = Math.max(0, Number(startSec) || 0);
    if (uri !== currentUri) {
      currentUri = uri;
      startedCurrent = false;
      const w = waitReady();
      c.loadUri(uri);
      await w;
    }
    if (!startedCurrent) {
      startedCurrent = true;
      pendingSeek = clipStart > 0 ? clipStart : null;
      c.play();
    } else {
      c.seek(clipStart);
      c.resume();
    }
    watchdog();
  }

  async function replay() {
    const c = await ready.catch(() => null);
    if (!c) return;
    c.seek(clipStart);
    c.resume();
    watchdog();
  }

  return {
    ready,
    playClip,
    replay,
    pause: () => ready.then((c) => c.pause()).catch(() => {}),
    resume: () => ready.then((c) => c.resume()).catch(() => {}),
  };
}
