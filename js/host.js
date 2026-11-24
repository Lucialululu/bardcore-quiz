import { connect, DEMO } from './net.js';
import { checkGuess, splitAlts } from './match.js';
import { toUri, fetchInfo, createPlayer } from './spotify.js';
import { songsFromCsv, songsToCsv } from './csv.js';

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const QUIZ_KEY = 'bq-quiz-v1';
const GAME_KEY = 'bq-game-v1';
const DEFAULTS = { duration: 30, artistBonus: true, autoReveal: true, endEarly: true, shuffle: false, roomCode: '' };
const TITLE_MAX = 1000, TITLE_MIN = 400, ARTIST_PTS = 300;

const blankSong = () => ({ id: uid(), url: '', title: '', artist: '', alts: '', start: 0, thumb: '', coverName: '' });

let quiz = load(QUIZ_KEY) || { songs: [], settings: {} };
quiz.settings = { ...DEFAULTS, ...quiz.settings };
if (!quiz.songs.length) quiz.songs.push(blankSong());
const saveQuiz = () => save(QUIZ_KEY, quiz);

let game = null;     // live game state (host is the single source of truth)
let net = null;      // realtime connection
let player = null;   // spotify controller
let tickTimer = null;

// ───────────────────────── screens ─────────────────────────
let currentScreen = null;
function show(name) {
  document.querySelectorAll('[data-screen]').forEach((el) => { el.hidden = el.dataset.screen !== name; });
  if (name !== currentScreen) { currentScreen = name; window.scrollTo(0, 0); }
  const tr = $('#top-right');
  const n = game ? Object.keys(game.players).length : 0;
  tr.innerHTML = game && name !== 'setup'
    ? `<span class="room-pill">${n} ${n === 1 ? 'player' : 'players'} in room <b>${esc(game.code)}</b></span>`
    : '';
}

// ───────────────────────── SETUP ─────────────────────────
function renderSongs() {
  const list = $('#song-list');
  list.innerHTML = quiz.songs.map((s, i) => `
    <div class="song-row" data-id="${s.id}">
      <div class="thumb" style="${s.thumb ? `background-image:url('${esc(s.thumb)}')` : ''}">
        <span class="idx">${i + 1}</span>${s.thumb ? '' : '<svg><use href="#i-note"/></svg>'}
      </div>
      <div class="fields">
        <label class="field wide">Spotify link<input data-f="url" value="${esc(s.url)}" placeholder="https://open.spotify.com/track/…" inputmode="url"></label>
        <label class="field">Song title, the answer<input data-f="title" value="${esc(s.title)}" placeholder="Bad Romance"></label>
        <label class="field">Original artist<input data-f="artist" value="${esc(s.artist)}" placeholder="Lady Gaga"></label>
        <label class="field"><span>Also accept <span class="hint">comma-separated</span></span><input data-f="alts" value="${esc(s.alts)}" placeholder="Rah rah ah ah ah"></label>
        <label class="field"><span>Start at <span class="hint">seconds in</span></span><input data-f="start" type="number" min="0" step="1" value="${Number(s.start) || 0}"></label>
        <div class="cover-name">${s.coverName ? 'On Spotify as “' + esc(s.coverName) + '”' : ''}</div>
      </div>
      <div class="row-btns">
        <button data-act="up" aria-label="Move up" title="Move up" ${i === 0 ? 'disabled' : ''}><svg><use href="#i-up"/></svg></button>
        <button data-act="down" aria-label="Move down" title="Move down" ${i === quiz.songs.length - 1 ? 'disabled' : ''}><svg><use href="#i-down"/></svg></button>
        <button data-act="del" aria-label="Remove song" title="Remove song"><svg><use href="#i-x"/></svg></button>
      </div>
    </div>`).join('');
  renderSummary();
  quiz.songs.forEach((s) => markUrl(s));
}

function rowOf(id) { return document.querySelector(`.song-row[data-id="${id}"]`); }
function markUrl(s) {
  const row = rowOf(s.id); if (!row) return;
  const bad = s.url.trim() && !toUri(s.url);
  row.querySelector('[data-f=url]').classList.toggle('bad', !!bad);
}

async function lookupSong(s) {
  const uri = toUri(s.url);
  if (!uri) return;
  const info = await fetchInfo(uri);
  if (!info) return;
  s.thumb = info.thumb; s.coverName = info.name;
  // Suggest an answer from the cover's name, e.g. "Bad Romance (Bardcore)" -> "Bad Romance"
  if (!s.title && info.name) {
    s.title = info.name.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s+[-–|].*$/, '').trim();
  }
  saveQuiz();
  const row = rowOf(s.id); if (!row) return;
  const th = row.querySelector('.thumb');
  if (s.thumb) { th.style.backgroundImage = `url('${s.thumb}')`; th.querySelector('svg')?.remove(); }
  row.querySelector('.cover-name').textContent = s.coverName ? `On Spotify as “${s.coverName}”` : '';
  const t = row.querySelector('[data-f=title]'); if (!t.value) t.value = s.title;
}

$('#song-list').addEventListener('input', (e) => {
  const f = e.target.dataset.f; if (!f) return;
  const s = quiz.songs.find((x) => x.id === e.target.closest('.song-row').dataset.id);
  s[f] = f === 'start' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
  if (f === 'url') { markUrl(s); renderSummary(); }
  saveQuiz();
});
$('#song-list').addEventListener('change', (e) => {
  if (e.target.dataset.f !== 'url') return;
  const s = quiz.songs.find((x) => x.id === e.target.closest('.song-row').dataset.id);
  lookupSong(s);
});
$('#song-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act;
  const i = quiz.songs.findIndex((x) => x.id === btn.closest('.song-row').dataset.id);
  if (act === 'del') { quiz.songs.splice(i, 1); if (!quiz.songs.length) quiz.songs.push(blankSong()); }
  if (act === 'up' && i > 0) [quiz.songs[i - 1], quiz.songs[i]] = [quiz.songs[i], quiz.songs[i - 1]];
  if (act === 'down' && i < quiz.songs.length - 1) [quiz.songs[i + 1], quiz.songs[i]] = [quiz.songs[i], quiz.songs[i + 1]];
  saveQuiz(); renderSongs();
});

$('#btn-add').onclick = () => {
  quiz.songs.push(blankSong()); saveQuiz(); renderSongs();
  rowOf(quiz.songs.at(-1).id).querySelector('[data-f=url]').focus();
};
$('#btn-bulk-toggle').onclick = () => { $('#bulk').hidden = !$('#bulk').hidden; };
$('#btn-bulk-add').onclick = () => {
  const lines = $('#bulk-text').value.split(/\s+/).filter((l) => toUri(l));
  if (!lines.length) return;
  // Replace a single empty starter row
  if (quiz.songs.length === 1 && !quiz.songs[0].url && !quiz.songs[0].title) quiz.songs = [];
  const added = lines.map((url) => ({ ...blankSong(), url }));
  quiz.songs.push(...added);
  $('#bulk-text').value = ''; $('#bulk').hidden = true;
  saveQuiz(); renderSongs();
  added.forEach(lookupSong);
};

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Export as CSV so it opens in Excel, Numbers or Google Sheets
$('#btn-export').onclick = () => {
  const songs = quiz.songs.filter((x) => x.url.trim() || x.title.trim());
  download('bardcore-quiz.csv', '\uFEFF' + songsToCsv(songs), 'text/csv;charset=utf-8');
};
$('#btn-template').onclick = (e) => {
  e.preventDefault();
  download('bardcore-quiz-template.csv', '\uFEFF' + songsToCsv([
    { url: 'https://open.spotify.com/track/PASTE_TRACK_ID_HERE', title: 'Bad Romance', artist: 'Lady Gaga', alts: 'Rah rah ah ah ah, Gaga oh la la', start: 0 },
    { url: 'https://open.spotify.com/track/PASTE_TRACK_ID_HERE', title: 'Bohemian Rhapsody', artist: 'Queen', alts: '', start: 15 },
  ]), 'text/csv;charset=utf-8');
};
$('#btn-import').onclick = () => $('#file-import').click();
$('#file-import').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  const box = $('#import-msg');
  try {
    const text = await file.text();
    let incoming = [], settings = null;
    if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) {
      const data = JSON.parse(text);
      if (!Array.isArray(data.songs)) throw new Error('there are no songs in it');
      incoming = data.songs; settings = data.settings;
    } else {
      incoming = songsFromCsv(text);
    }
    if (!incoming.length) throw new Error('no rows with a Spotify link or song title were found');
    // Added after the songs you already have; nothing is overwritten.
    const keep = quiz.songs.filter((x) => x.url.trim() || x.title.trim());
    const added = incoming.map((x) => ({ ...blankSong(), ...x, id: uid(), start: Math.max(0, Number(x.start) || 0) }));
    quiz.songs = [...keep, ...added];
    if (settings) quiz.settings = { ...DEFAULTS, ...settings };
    saveQuiz(); renderSongs(); renderSettings();
    added.filter((x) => !x.thumb).forEach(lookupSong);
    const bad = added.filter((x) => !toUri(x.url)).length;
    box.className = bad ? 'notice warn' : 'notice';
    box.innerHTML = `<span>Added <b>${added.length}</b> ${added.length === 1 ? 'song' : 'songs'} from ${esc(file.name)}.${bad ? ` ${bad === 1 ? '1 of them needs' : bad + ' of them need'} a valid Spotify link (marked in orange).` : ''}</span>`;
    box.hidden = false;
  } catch (err) {
    box.className = 'notice error';
    box.innerHTML = `<span><b>Couldn't import ${esc(file.name)}:</b> ${esc(err.message)}.</span>`;
    box.hidden = false;
  }
};

function renderSummary() {
  const n = quiz.songs.filter((s) => toUri(s.url)).length;
  const mins = Math.max(1, Math.round((n * (quiz.settings.duration + 15)) / 60));
  $('#setup-summary').textContent = n ? `${n} ${n === 1 ? 'song' : 'songs'}, roughly ${mins} min of play` : 'Add your first song to get started';
}
function renderDuration() {
  const d = quiz.settings.duration;
  $('#duration-val').innerHTML = `${d}<small>s</small>`;
  const el = $('#set-duration');
  el.style.setProperty('--fill', ((d - el.min) / (el.max - el.min)) * 100 + '%');
}

function renderSettings() {
  const st = quiz.settings;
  $('#set-duration').value = st.duration; renderDuration();
  $('#set-artist').checked = st.artistBonus;
  $('#set-autoreveal').checked = st.autoReveal;
  $('#set-early').checked = st.endEarly;
  $('#set-shuffle').checked = st.shuffle;
  $('#set-code').value = st.roomCode || '';
}
$('#set-duration').oninput = (e) => { quiz.settings.duration = Number(e.target.value); renderDuration(); renderSummary(); saveQuiz(); };
$('#set-code').oninput = (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  e.target.value = v;
  quiz.settings.roomCode = v;
  e.target.classList.toggle('bad', v.length > 0 && v.length < 4);
  saveQuiz();
};
[['#set-artist', 'artistBonus'], ['#set-autoreveal', 'autoReveal'], ['#set-early', 'endEarly'], ['#set-shuffle', 'shuffle']]
  .forEach(([sel, key]) => { $(sel).onchange = (e) => { quiz.settings[key] = e.target.checked; saveQuiz(); }; });

function validate() {
  const errors = [];
  const songs = quiz.songs.filter((s) => s.url.trim() || s.title.trim());
  if (!songs.length) errors.push('Add at least one song.');
  songs.forEach((s, i) => {
    const n = quiz.songs.indexOf(s) + 1;
    if (!toUri(s.url)) errors.push(`Song ${n}: the Spotify link doesn't look right.`);
    if (!s.title.trim()) errors.push(`Song ${n}: write the song title players must guess.`);
    if (quiz.settings.artistBonus && !s.artist.trim()) errors.push(`Song ${n}: add the original artist (or turn off the artist bonus).`);
  });
  return { errors, songs };
}

$('#btn-open-lobby').onclick = () => {
  const { errors, songs } = validate();
  const box = $('#setup-errors');
  box.className = 'notice warn';
  if (errors.length) { box.innerHTML = errors.map(esc).join('<br>'); box.hidden = false; box.scrollIntoView({ behavior: 'smooth' }); return; }
  box.hidden = true;
  newGame(songs).catch(() => {});
};

// ───────────────────────── GAME ─────────────────────────
// Each player keeps one heraldic tincture for the whole game
const initial = (name) => (String(name).trim()[0] || '?').toUpperCase();
function tint(pid) {
  let h = 0;
  for (const c of String(pid)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 'tint-' + (h % 6);
}

function makeCode() {
  const fixed = String(quiz.settings.roomCode || '').toUpperCase();
  if (/^[A-Z]{4}$/.test(fixed)) return fixed;
  const A = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

async function newGame(songs) {
  let list = songs.map((s) => ({ ...s, uri: toUri(s.url) }));
  if (quiz.settings.shuffle) list = list.sort(() => Math.random() - 0.5);
  game = {
    code: makeCode(), createdAt: Date.now(), phase: 'lobby', qIndex: -1,
    songs: list, settings: { ...quiz.settings }, players: {}, round: null, lastReveal: null,
  };
  saveGame();
  await goOnline();
  enterLobby();
}

function saveGame() { if (game) save(GAME_KEY, game); }

async function goOnline() {
  if (net) { try { net.close(); } catch {} net = null; }
  try {
    net = await connect(game.code, onMessage);
  } catch (err) {
    const box = $('#setup-errors');
    box.className = 'notice error';
    box.innerHTML = `<span><b>Couldn't connect to Supabase.</b> ${esc(err.message)}. Check the URL and key in <code>js/config.js</code>, and that Realtime is enabled for the project.</span>`;
    box.hidden = false;
    show('setup');
    throw err;
  }
}

function joinUrl() {
  const base = location.origin + location.pathname.replace(/host(\.html)?$/, '');
  return base.replace(/\/$/, '') + '/';
}

function enterLobby() {
  game.phase = 'lobby'; saveGame();
  $('#room-code').textContent = game.code;
  $('#join-url').textContent = joinUrl().replace(/^https?:\/\//, '');
  renderLobbyPlayers();
  makeQr(`${joinUrl()}?room=${game.code}`);
  show('lobby');
  broadcast();
}

async function makeQr(url) {
  const box = $('#qr');
  try {
    const QR = (await import('https://esm.sh/qrcode@1.5.4')).default;
    const src = await QR.toDataURL(url, { margin: 1, width: 600, color: { dark: '#2b1d0e', light: '#f3e6c8' } });
    box.innerHTML = `<img src="${src}" alt="QR code to join">`;
  } catch {
    box.innerHTML = `<p>QR code unavailable.<br>Go to <b>${esc(url)}</b></p>`;
  }
}

function renderLobbyPlayers() {
  const ps = Object.entries(game.players);
  $('#player-count').textContent = ps.length ? `${ps.length} ${ps.length === 1 ? 'player' : 'players'} ready` : 'Waiting for players';
  $('#lobby-players').innerHTML = ps.map(([pid, p]) => `<span class="chip removable ${tint(pid)}" data-pid="${pid}"><span class="av">${esc(initial(p.name))}</span>${esc(p.name)}</span>`).join('');
  $('#kick-hint').hidden = !ps.length;
  show('lobby');
}
$('#lobby-players').onclick = (e) => {
  const pid = e.target.closest('[data-pid]')?.dataset.pid; if (!pid) return;
  if (!confirm(`Remove ${game.players[pid].name}?`)) return;
  delete game.players[pid]; saveGame();
  net?.send({ t: 'kick', pid });
  renderLobbyPlayers(); broadcast();
};
$('#btn-back-setup').onclick = () => { show('setup'); renderResumeBanner(); };
$('#btn-start').onclick = () => startQuestion(0);

// ── messages from phones ──
function onMessage(m) {
  if (!m || !game) return;
  if (m.t === 'hello') {
    const name = String(m.name || '').trim().slice(0, 20) || 'Bard';
    if (!game.players[m.pid]) game.players[m.pid] = { name, score: 0, joinedAt: Date.now() };
    else game.players[m.pid].name = name;
    saveGame();
    if (game.phase === 'lobby') renderLobbyPlayers();
    if (game.phase === 'question') renderQuestionPlayers();
    broadcast();
  } else if (m.t === 'guess') {
    onGuess(m);
  }
}

function remaining() {
  return game?.round ? Math.max(0, game.round.endsAt - Date.now()) : 0;
}

function onGuess({ pid, kind, text, gid }) {
  const p = game.players[pid];
  if (!p) { net.send({ t: 'result', pid, gid, kind, verdict: 'unknown' }); return; }
  if (game.phase !== 'question' || game.round.locked || remaining() <= 0) {
    net.send({ t: 'result', pid, gid, kind, verdict: 'locked' }); return;
  }
  if (kind === 'artist' && !game.settings.artistBonus) return;
  const song = game.songs[game.qIndex];
  const solved = (game.round.solved[pid] ||= {});
  if (solved[kind] != null) { net.send({ t: 'result', pid, gid, kind, verdict: 'already', points: solved[kind] }); return; }

  const answers = kind === 'title'
    ? [song.title, ...splitAlts(song.alts)]
    : [song.artist, ...song.artist.split(/[/;]/)].map((s) => s.trim()).filter(Boolean);
  const verdict = checkGuess(text, answers);
  let points = 0;
  if (verdict === 'correct') {
    if (kind === 'title') {
      const frac = remaining() / game.round.duration;
      points = Math.round((TITLE_MIN + (TITLE_MAX - TITLE_MIN) * Math.min(1, frac)) / 10) * 10;
      solved.titleSecs = Math.round((Date.now() - game.round.startedAt) / 100) / 10;
    } else {
      points = ARTIST_PTS;
    }
    solved[kind] = points;
    p.score += points;
    saveGame();
    renderQuestionPlayers();
    broadcast();
    maybeEndEarly();
  }
  net.send({ t: 'result', pid, gid, kind, verdict, points, total: p.score });
}

function maybeEndEarly() {
  if (!game.settings.endEarly) return;
  const pids = Object.keys(game.players);
  if (!pids.length) return;
  const all = pids.every((pid) => {
    const s = game.round.solved[pid];
    return s && s.title != null && (!game.settings.artistBonus || s.artist != null);
  });
  if (all) {
    game.round.endsAt = Math.min(game.round.endsAt, Date.now() + 1500);
    toastAll = 'Everyone found it';
  }
}
let toastAll = '';

// ── question ──
function ensurePlayer(uri) {
  if (player) return player;
  player = createPlayer($('#spotify-embed'), uri, {
    onPlaying: (on) => { $('#player-box').classList.toggle('playing', on); if (on) $('#play-hint').hidden = true; },
    onBlocked: () => { $('#play-hint').hidden = false; setPeek(true); },
  });
  player.ready.catch(() => {
    $('#play-hint').hidden = false;
    $('#play-hint').textContent = "The Spotify player couldn't load. Check your internet connection or ad blocker, then reload.";
  });
  return player;
}

function startQuestion(i, keepSolved = false) {
  const prevSolved = keepSolved && game.round ? game.round.solved : {};
  game.qIndex = i;
  game.phase = 'question';
  const dur = game.settings.duration * 1000;
  game.round = { startedAt: Date.now(), endsAt: Date.now() + dur, duration: dur, solved: prevSolved, locked: false };
  game.lastReveal = null;
  toastAll = '';
  saveGame();
  renderQuestion();
  show('question');
  broadcast();
  setPaused(false);
  const song = game.songs[i];
  ensurePlayer(song.uri).playClip(song.uri, song.start).catch(() => {});
  startTicking();
}

function renderQuestion() {
  $('#q-label').textContent = `Song ${game.qIndex + 1} of ${game.songs.length}`;
  $('#player-box').classList.remove('peek');

  setPeek(false);
  setPaused(false);
  renderDots();
  renderQuestionPlayers();
  tick();
}

function renderQuestionPlayers() {
  if (game.phase !== 'question') return;
  const ps = Object.entries(game.players);
  const got = ps.filter(([pid]) => game.round.solved[pid]?.title != null).length;
  $('#answered').innerHTML = toastAll
    ? esc(toastAll)
    : ps.length ? `<b>${got}</b> of ${ps.length} have found it` : 'No players yet';
  $('#q-players').innerHTML = ps.map(([pid, p]) => {
    const s = game.round.solved[pid] || {};
    return `<span class="chip ${tint(pid)} ${s.title != null ? 'solved' : ''}"><span class="av">${s.title != null ? '<svg><use href="#i-check"/></svg>' : esc(initial(p.name))}</span>${esc(p.name)}${s.artist != null ? '<span class="star" title="Artist bonus">★</span>' : ''}</span>`;
  }).join('');
  show('question');
}

function renderDots() {
  $('#q-dots').innerHTML = game.songs.map((_, i) => `<i class="${i < game.qIndex ? 'done' : i === game.qIndex ? 'now' : ''}"></i>`).join('');
}

function startTicking() {
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 250);
}
let lastSync = 0;
function tick() {
  if (!game || game.phase !== 'question') return;
  const rem = remaining();
  const secs = Math.ceil(rem / 1000);
  const t = $('#timer');
  t.textContent = rem > 0 ? secs : "Time's up!";
  t.classList.toggle('low', secs <= 5 && secs > 0);
  t.classList.toggle('up', rem <= 0);
  const frac = Math.min(1, rem / game.round.duration);
  $('#timer-bar').style.width = (100 * frac) + '%';
  $('#thermo').style.setProperty('--heat', (1 - frac).toFixed(3));
  if (rem <= 0 && !game.round.locked) {
    game.round.locked = true;
    saveGame();

    broadcast();
    if (game.settings.autoReveal || toastAll) setTimeout(() => game.phase === 'question' && reveal(), 1200);
  }
  if (Date.now() - lastSync > 3000) { lastSync = Date.now(); broadcast(); }
}

let paused = false;
function setPaused(on) {
  paused = on;
  document.querySelectorAll('#btn-pause, #btn-pause-2').forEach((b) => { b.dataset.on = String(on); });
}
function setPeek(on) {
  $('#player-box').classList.toggle('peek', on);
  $('#btn-peek').dataset.on = String(on);
}
$('#btn-replay').onclick = () => { player?.replay(); setPaused(false); };
const togglePause = () => {
  setPaused(!paused);
  paused ? player?.pause() : player?.resume();
};
$('#btn-pause').onclick = togglePause;
$('#btn-pause-2').onclick = togglePause;
$('#btn-plus').onclick = () => {
  if (game.phase !== 'question') return;
  game.round.endsAt = Math.max(Date.now(), game.round.endsAt) + 10000;
  game.round.locked = false;
  $('#timer').classList.remove('low');
  saveGame(); broadcast(); tick();
};
$('#btn-peek').onclick = () => setPeek(!$('#player-box').classList.contains('peek'));
$('#btn-reveal').onclick = () => reveal();

// ── reveal ──
function reveal() {
  if (game.phase !== 'question') return;
  game.round.locked = true;
  const song = game.songs[game.qIndex];
  const entries = Object.entries(game.players);

  const round = entries
    .map(([pid, p]) => {
      const s = game.round.solved[pid] || {};
      const pts = (s.title || 0) + (s.artist || 0);
      return { pid, name: p.name, pts, title: s.title != null, artist: s.artist != null, secs: s.titleSecs ?? null };
    })
    .sort((a, b) => b.pts - a.pts || (a.secs ?? 1e9) - (b.secs ?? 1e9));

  const board = boardFrom(entries, (pid) => round.find((r) => r.pid === pid)?.pts || 0);

  game.lastReveal = { title: song.title, artist: song.artist, coverName: song.coverName, thumb: song.thumb, round, board };
  game.phase = 'reveal';
  saveGame();
  renderReveal();
  broadcast();
}

function boardFrom(entries, deltaOf) {
  const now = entries.map(([pid, p]) => ({ pid, name: p.name, score: p.score, delta: deltaOf(pid) }))
    .sort((a, b) => b.score - a.score);
  const before = [...now].sort((a, b) => (b.score - b.delta) - (a.score - a.delta)).map((x) => x.pid);
  return now.map((x, i) => {
    // equal scores share a rank
    const rank = i > 0 && now[i - 1].score === x.score ? null : i + 1;
    return { ...x, rank, move: before.indexOf(x.pid) - i };
  }).map((x, i, arr) => ({ ...x, rank: x.rank ?? arr.slice(0, i).reverse().find((y) => y.rank)?.rank ?? 1 }));
}

function renderReveal() {
  const r = game.lastReveal;
  $('#rv-title').textContent = r.title;
  $('#rv-artist').textContent = r.artist ? 'by ' + r.artist : '';
  $('#rv-cover').textContent = r.coverName ? `You heard “${r.coverName}”` : '';
  $('#rv-art').outerHTML = r.thumb
    ? `<img id="rv-art" src="${esc(r.thumb)}" alt="">`
    : `<div id="rv-art" class="art"><svg><use href="#i-note"/></svg></div>`;

  const got = r.round.filter((x) => x.pts > 0);
  $('#rv-round').innerHTML = got.length
    ? got.map((x, i) => `<li style="animation-delay:${i * 70}ms">
        <span class="rank">${i + 1}</span>
        <span class="name">${esc(x.name)}<small>${x.secs != null ? x.secs + ' s' : ''}${x.artist ? ' · artist ★' : ''}</small></span>
        <span></span>
        <span class="delta">+${x.pts}</span></li>`).join('')
    : '<li class="empty">Nobody found this one. A tough crowd, or a tough song.</li>';

  $('#rv-board').innerHTML = r.board.slice(0, 10).map((x, i) => `<li style="animation-delay:${250 + i * 70}ms">
      <span class="rank ${x.rank === 1 ? 'medal' : ''}">${x.rank}</span>
      <span class="name">${esc(x.name)}${x.move ? `<span class="move ${x.move > 0 ? 'up' : 'down'}">${x.move > 0 ? '▲' + x.move : '▼' + -x.move}</span>` : ''}</span>
      <span class="delta">${x.delta ? '+' + x.delta : ''}</span>
      <span class="pts">${x.score}</span></li>`).join('') || '<li class="empty">No players yet</li>';

  const last = game.qIndex >= game.songs.length - 1;
  $('#btn-next').textContent = last ? 'Show final results' : `Play song ${game.qIndex + 2}`;
  show('reveal');
}

$('#btn-next').onclick = () => {
  if (game.qIndex >= game.songs.length - 1) finish();
  else startQuestion(game.qIndex + 1);
};

// End early: jump straight to the podium with the points so far
document.querySelectorAll('.end-game').forEach((b) => {
  b.onclick = () => {
    if (!game || game.phase === 'final') return;
    const where = game.qIndex >= 0 ? ` You're on song ${game.qIndex + 1} of ${game.songs.length}.` : '';
    if (!confirm(`End the game now and show the final results?${where}`)) return;
    finish();
  };
});

// ── final ──
function finish() {
  clearInterval(tickTimer);
  if (game.round) game.round.locked = true;
  player?.pause();
  setPaused(true);
  game.phase = 'final';
  game.finalBoard = boardFrom(Object.entries(game.players), () => 0);
  saveGame();
  renderFinal();
  broadcast();
}

function renderFinal() {
  const b = game.finalBoard;
  const order = [1, 0, 2]; // 2nd, 1st, 3rd
  $('#podium').innerHTML = order.map((i) => b[i] ? `
    <div class="step p${i + 1}">
      <div class="who">${esc(b[i].name)}</div>
      <div class="score">${b[i].score} points</div>
      <div class="block">${b[i].rank}</div>
    </div>` : '').join('');
  $('#final-board').innerHTML = b.map((x) => `<li><span class="rank ${x.rank === 1 ? 'medal' : ''}">${x.rank}</span><span class="name">${esc(x.name)}</span><span></span><span class="pts">${x.score}</span></li>`).join('')
    || '<li class="empty">No players took part</li>';
  show('final');
}

$('#btn-new-game').onclick = () => {
  net?.send({ t: 'state', phase: 'closed' });
  localStorage.removeItem(GAME_KEY);
  game = null;
  show('setup'); renderResumeBanner();
};

// ── broadcast public state to phones ──
function broadcast() {
  if (!net || !game) return;
  const st = {
    t: 'state', code: game.code, phase: game.phase,
    q: game.qIndex + 1, total: game.songs.length, artistBonus: game.settings.artistBonus,
    players: Object.entries(game.players).map(([pid, p]) => ({ pid, name: p.name, score: p.score })),
  };
  if (game.phase === 'question') {
    st.remaining = remaining();
    st.duration = game.round.duration;
    st.locked = game.round.locked || st.remaining <= 0;
    st.solved = Object.fromEntries(Object.entries(game.round.solved).map(([pid, s]) => [pid, { title: s.title ?? null, artist: s.artist ?? null }]));
  }
  if (game.phase === 'reveal') {
    const r = game.lastReveal;
    st.reveal = { title: r.title, artist: r.artist, coverName: r.coverName, thumb: r.thumb, round: r.round.map(({ pid, pts }) => ({ pid, pts })), board: r.board };
  }
  if (game.phase === 'final') st.board = game.finalBoard;
  net.send(st);
}

// ───────────────────────── resume after refresh ─────────────────────────
function renderResumeBanner() {
  const g = load(GAME_KEY);
  const box = $('#resume-banner');
  if (!g || g.phase === 'final' || Date.now() - g.createdAt > 6 * 3600e3) { box.hidden = true; return; }
  box.innerHTML = `<span>A game is still running in room <b>${esc(g.code)}</b>, ${g.qIndex >= 0 ? `at song ${g.qIndex + 1} of ${g.songs.length}` : 'in the lobby'}, with ${Object.keys(g.players).length} players.</span>
    <button class="btn-light" id="btn-resume">Resume game</button>
    <button class="btn-quiet" id="btn-discard">Discard it</button>`;
  box.hidden = false;
  $('#btn-resume').onclick = async () => {
    game = g;
    try { await goOnline(); } catch { return; }
    if (game.phase === 'lobby') enterLobby();
    else if (game.phase === 'question') {
      // Restart the current song with a fresh timer (keeps points already earned)
      startQuestion(game.qIndex, true);
    } else if (game.phase === 'reveal') { renderReveal(); broadcast(); }
  };
  $('#btn-discard').onclick = () => { localStorage.removeItem(GAME_KEY); box.hidden = true; };
}

// ───────────────────────── init ─────────────────────────
$('#demo-banner').hidden = !DEMO;
renderSongs();
renderSettings();
renderResumeBanner();
show('setup');

// Warn before accidentally closing the tab mid-game
window.addEventListener('beforeunload', (e) => {
  if (game && game.phase !== 'final' && game.phase !== 'lobby') { e.preventDefault(); e.returnValue = ''; }
});
