import { connect, DEMO } from './net.js';
import { checkGuess, splitAlts } from './match.js';
import { toUri, fetchInfo, createPlayer } from './spotify.js';

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const QUIZ_KEY = 'bq-quiz-v1';
const GAME_KEY = 'bq-game-v1';
const DEFAULTS = { duration: 30, artistBonus: true, autoReveal: true, endEarly: true, shuffle: false };
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
  tr.innerHTML = game && name !== 'setup'
    ? `<span class="caps small muted">Room</span> <span class="caps" style="font-size:22px;color:var(--gold-soft)">${esc(game.code)}</span>
       <span class="caps small muted" style="margin-left:14px">${Object.keys(game.players).length} players</span>`
    : '';
}

// ───────────────────────── SETUP ─────────────────────────
function renderSongs() {
  const list = $('#song-list');
  list.innerHTML = quiz.songs.map((s, i) => `
    <div class="song-row" data-id="${s.id}">
      <div class="num">${i + 1}</div>
      <div class="thumb" style="${s.thumb ? `background-image:url('${esc(s.thumb)}')` : ''}">${s.thumb ? '' : '🎵'}</div>
      <div class="fields">
        <label class="wide">Spotify link<input data-f="url" value="${esc(s.url)}" placeholder="https://open.spotify.com/track/…"></label>
        <label>Song title (the answer)<input data-f="title" value="${esc(s.title)}" placeholder="e.g. Bad Romance"></label>
        <label>Original artist<input data-f="artist" value="${esc(s.artist)}" placeholder="e.g. Lady Gaga"></label>
        <label>Also accept <small>(comma-separated, optional)</small><input data-f="alts" value="${esc(s.alts)}" placeholder="e.g. Rah rah ah ah ah"></label>
        <label>Start at (seconds)<input data-f="start" type="number" min="0" step="1" value="${Number(s.start) || 0}"></label>
        <div class="cover-name">${s.coverName ? '🪕 Spotify track: ' + esc(s.coverName) : ''}</div>
      </div>
      <div class="row-btns">
        <button class="ghost icon" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="ghost icon" data-act="down" title="Move down" ${i === quiz.songs.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="ghost icon" data-act="del" title="Remove">✕</button>
      </div>
    </div>`).join('');
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
  if (s.thumb) { th.style.backgroundImage = `url('${s.thumb}')`; th.textContent = ''; }
  row.querySelector('.cover-name').textContent = s.coverName ? '🪕 Spotify track: ' + s.coverName : '';
  const t = row.querySelector('[data-f=title]'); if (!t.value) t.value = s.title;
}

$('#song-list').addEventListener('input', (e) => {
  const f = e.target.dataset.f; if (!f) return;
  const s = quiz.songs.find((x) => x.id === e.target.closest('.song-row').dataset.id);
  s[f] = f === 'start' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
  if (f === 'url') markUrl(s);
  saveQuiz();
});
$('#song-list').addEventListener('change', (e) => {
  if (e.target.dataset.f !== 'url') return;
  const s = quiz.songs.find((x) => x.id === e.target.closest('.song-row').dataset.id);
  lookupSong(s);
});
$('#song-list').addEventListener('click', (e) => {
  const act = e.target.dataset.act; if (!act) return;
  const i = quiz.songs.findIndex((x) => x.id === e.target.closest('.song-row').dataset.id);
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

$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'bardcore-quiz.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#btn-import').onclick = () => $('#file-import').click();
$('#file-import').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.songs)) throw new Error('No songs in file');
    quiz = { songs: data.songs.map((s) => ({ ...blankSong(), ...s, id: uid() })), settings: { ...DEFAULTS, ...data.settings } };
    saveQuiz(); renderSongs(); renderSettings();
  } catch (err) { alert('Could not read that file: ' + err.message); }
  e.target.value = '';
};

function renderSettings() {
  const st = quiz.settings;
  $('#set-duration').value = st.duration; $('#duration-val').textContent = st.duration + ' s';
  $('#set-artist').checked = st.artistBonus;
  $('#set-autoreveal').checked = st.autoReveal;
  $('#set-early').checked = st.endEarly;
  $('#set-shuffle').checked = st.shuffle;
}
$('#set-duration').oninput = (e) => { quiz.settings.duration = Number(e.target.value); $('#duration-val').textContent = e.target.value + ' s'; saveQuiz(); };
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
  if (errors.length) { box.innerHTML = errors.map(esc).join('<br>'); box.hidden = false; box.scrollIntoView({ behavior: 'smooth' }); return; }
  box.hidden = true;
  newGame(songs);
};

// ───────────────────────── GAME ─────────────────────────
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
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
    alert('Could not connect to Supabase: ' + err.message + '\nCheck js/config.js and the README.');
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
    box.innerHTML = `<p style="color:var(--ink)">Scan unavailable.<br>Go to <b>${esc(url)}</b></p>`;
  }
}

function renderLobbyPlayers() {
  const ps = Object.entries(game.players);
  $('#player-count').textContent = ps.length ? `${ps.length} player${ps.length === 1 ? '' : 's'} joined` : 'Waiting for players…';
  $('#lobby-players').innerHTML = ps.map(([pid, p]) => `<span class="chip removable" data-pid="${pid}">${esc(p.name)}</span>`).join('');
  $('#kick-hint').hidden = !ps.length;
  show('lobby');
}
$('#lobby-players').onclick = (e) => {
  const pid = e.target.dataset.pid; if (!pid) return;
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
    : song.artist.split('/').map((s) => s.trim()).filter(Boolean);
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
    toastAll = 'Everyone got it!';
  }
}
let toastAll = '';

// ── question ──
function ensurePlayer(uri) {
  if (player) return player;
  player = createPlayer($('#spotify-embed'), uri, {
    onPlaying: (on) => { $('#player-box').classList.toggle('playing', on); if (on) $('#play-hint').hidden = true; },
    onBlocked: () => { $('#play-hint').hidden = false; $('#player-box').classList.add('peek'); $('#btn-peek').textContent = 'Hide player'; },
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
  const song = game.songs[i];
  ensurePlayer(song.uri).playClip(song.uri, song.start).catch(() => {});
  startTicking();
}

function renderQuestion() {
  $('#q-label').textContent = `SONG ${game.qIndex + 1} OF ${game.songs.length}`;
  $('#player-box').classList.remove('peek');
  $('#btn-reveal').classList.remove('primary');
  $('#btn-peek').textContent = 'Show player';
  $('#btn-pause').textContent = '❚❚ Pause music';
  renderQuestionPlayers();
  tick();
}

function renderQuestionPlayers() {
  if (game.phase !== 'question') return;
  const ps = Object.entries(game.players);
  const got = ps.filter(([pid]) => game.round.solved[pid]?.title != null).length;
  $('#answered').textContent = toastAll || `${got} of ${ps.length} have found it`;
  $('#q-players').innerHTML = ps.map(([pid, p]) => {
    const s = game.round.solved[pid] || {};
    return `<span class="chip ${s.title != null ? 'solved' : ''}">${esc(p.name)}${s.artist != null ? '<span class="star">★</span>' : ''}</span>`;
  }).join('');
  show('question');
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
  $('#timer-bar').style.width = (100 * rem / game.round.duration) + '%';
  if (rem <= 0 && !game.round.locked) {
    game.round.locked = true;
    saveGame();
    $('#btn-reveal').classList.add('primary');
    broadcast();
    if (game.settings.autoReveal || toastAll) setTimeout(() => game.phase === 'question' && reveal(), 1200);
  }
  if (Date.now() - lastSync > 3000) { lastSync = Date.now(); broadcast(); }
}

$('#btn-replay').onclick = () => { player?.replay(); $('#btn-pause').textContent = '❚❚ Pause music'; };
let paused = false;
const togglePause = (btn) => {
  paused = !paused;
  paused ? player?.pause() : player?.resume();
  document.querySelectorAll('#btn-pause, #btn-pause-2').forEach((b) => { b.textContent = paused ? '▶ Play music' : '❚❚ Pause music'; });
};
$('#btn-pause').onclick = () => togglePause();
$('#btn-pause-2').onclick = () => togglePause();
$('#btn-plus').onclick = () => {
  if (game.phase !== 'question') return;
  game.round.endsAt = Math.max(Date.now(), game.round.endsAt) + 10000;
  game.round.locked = false;
  $('#timer').classList.remove('low');
  saveGame(); broadcast(); tick();
};
$('#btn-peek').onclick = () => {
  const on = $('#player-box').classList.toggle('peek');
  $('#btn-peek').textContent = on ? 'Hide player' : 'Show player';
};
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
  $('#rv-cover').textContent = r.coverName ? `Bardcore version: “${r.coverName}”` : '';
  const img = $('#rv-thumb');
  if (r.thumb) { img.src = r.thumb; img.hidden = false; } else img.hidden = true;

  const got = r.round.filter((x) => x.pts > 0);
  $('#rv-round').innerHTML = got.length
    ? got.map((x, i) => `<li style="animation-delay:${i * 80}ms">
        <span class="rank">${x.title ? '✓' : ''}${x.artist ? '★' : ''}</span>
        <span class="name">${esc(x.name)}</span>
        <span class="muted small">${x.secs != null ? x.secs + ' s' : ''}</span>
        <span class="delta">+${x.pts}</span></li>`).join('')
    : '<li><span class="name muted">Nobody got this one! 🐉</span></li>';

  $('#rv-board').innerHTML = r.board.slice(0, 10).map((x, i) => `<li style="animation-delay:${300 + i * 80}ms">
      <span class="rank">${x.rank}.</span>
      <span class="name">${esc(x.name)}</span>
      <span class="move ${x.move > 0 ? 'up' : x.move < 0 ? 'down' : ''}">${x.move > 0 ? '▲' + x.move : x.move < 0 ? '▼' + -x.move : ''}</span>
      <span class="delta">${x.delta ? '+' + x.delta : ''}</span>
      <span class="pts">${x.score}</span></li>`).join('') || '<li><span class="name muted">No players yet</span></li>';

  const last = game.qIndex >= game.songs.length - 1;
  $('#btn-next').textContent = last ? 'Final results 🏆' : 'Next song →';
  show('reveal');
}

$('#btn-next').onclick = () => {
  if (game.qIndex >= game.songs.length - 1) finish();
  else { paused = false; document.querySelectorAll('#btn-pause, #btn-pause-2').forEach((b) => { b.textContent = '❚❚ Pause music'; }); startQuestion(game.qIndex + 1); }
};

// ── final ──
function finish() {
  clearInterval(tickTimer);
  player?.pause();
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
      <div class="score">${b[i].score} pts</div>
      <div class="block">${b[i].rank}</div>
    </div>` : '').join('');
  $('#final-board').innerHTML = b.map((x) => `<li><span class="rank">${x.rank}.</span><span class="name">${esc(x.name)}</span><span class="pts">${x.score}</span></li>`).join('');
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
  box.innerHTML = `A game is in progress (room <b>${esc(g.code)}</b>, ${g.qIndex >= 0 ? `song ${g.qIndex + 1} of ${g.songs.length}` : 'in the lobby'}, ${Object.keys(g.players).length} players).
    <button class="gold icon" id="btn-resume" style="margin-left:10px">Resume it</button>
    <button class="ghost icon" id="btn-discard">Discard</button>`;
  box.hidden = false;
  $('#btn-resume').onclick = async () => {
    game = g;
    await goOnline();
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
