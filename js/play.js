import { connect, DEMO } from './net.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// Each phone (tab, in demo mode) gets a stable id so a refresh keeps its score.
const idKey = DEMO ? null : 'bq-pid';
let pid = (idKey && store.get(idKey)) || (DEMO && sessionStorage.getItem('bq-pid')) || Math.random().toString(36).slice(2, 12);
if (idKey) store.set(idKey, pid); else sessionStorage.setItem('bq-pid', pid);

let net = null;
let code = '';
let myName = '';
let state = null;
let currentQ = 0;
let endsAt = 0;
let duration = 1;
let gotState = false;
let lastHello = 0;
let tickTimer = null;
const pending = {};      // gid -> { kind, text }
const tries = { title: [], artist: [] };

function show(name) {
  document.querySelectorAll('[data-screen]').forEach((el) => { el.hidden = el.dataset.screen !== name; });
}
function message(html) { $('#msg-text').innerHTML = html; show('msg'); }
function setStatus(ok) {
  $('#status-line').innerHTML = code ? `<span class="status-dot ${ok ? '' : 'off'}"></span>${ok ? 'Room ' + esc(code) : 'Reconnecting'}` : '';
}

// ───────── join ─────────
const params = new URLSearchParams(location.search);
$('#in-code').value = (params.get('room') || store.get('bq-last-room') || '').toUpperCase();
$('#in-name').value = store.get('bq-name') || '';
$('#demo-banner').hidden = !DEMO;
if ($('#in-code').value) $('#in-name').focus();

$('#join-form').onsubmit = async (e) => {
  e.preventDefault();
  code = $('#in-code').value.trim().toUpperCase();
  myName = $('#in-name').value.trim().slice(0, 20);
  if (!/^[A-Z]{4}$/.test(code)) { $('#join-error').textContent = 'The room code is 4 letters.'; return; }
  if (!myName) { $('#join-error').textContent = 'Add a name so the host knows who you are.'; return; }
  $('#join-error').textContent = '';
  store.set('bq-name', myName);
  store.set('bq-last-room', code);
  $('#btn-join').disabled = true;
  $('#btn-join').textContent = 'Joining';
  try {
    net = await connect(code, onMessage, (s) => {
      setStatus(s === 'connected');
      if (s === 'connected' && net) hello(true);
    });
  } catch (err) {
    $('#btn-join').disabled = false; $('#btn-join').textContent = 'Join the game';
    $('#join-error').textContent = "Couldn't reach the game server. Check your connection and try again.";
    return;
  }
  setStatus(true);
  hello(true);
  $('#wait-name').textContent = myName;
  $('#wait-text').textContent = 'Looking for the host';
  $('#wait-count').textContent = '';
  show('wait');
  setTimeout(() => {
    if (!gotState) $('#wait-text').innerHTML = `No game found in room <b>${esc(code)}</b> yet. Check the code on the big screen, or wait for the host to open the lobby.`;
  }, 5000);
  // keep saying hello until the host has seen us
  setInterval(() => { if (!gotState || !isKnown()) hello(); }, 3000);
};

function hello(force) {
  if (!net) return;
  if (!force && Date.now() - lastHello < 2500) return;
  lastHello = Date.now();
  net.send({ t: 'hello', pid, name: myName });
}
const isKnown = () => !!state?.players?.some((p) => p.pid === pid);

// ───────── messages ─────────
function onMessage(m) {
  if (!m) return;
  if (m.t === 'state') onState(m);
  else if (m.t === 'result' && m.pid === pid) onResult(m);
  else if (m.t === 'kick' && m.pid === pid) {
    net?.close(); net = null;
    message('The host removed you from this game. You can join again with a different name.');
  }
}

function onState(s) {
  if (s.phase === 'closed') { if (state) message('The host ended the game. Thanks for playing.'); return; }
  gotState = true;
  state = s;
  if (!isKnown() && s.phase !== 'final') { hello(); }
  const me = s.players?.find((p) => p.pid === pid);
  const myScore = me?.score ?? 0;

  if (s.phase === 'lobby') {
    $('#wait-name').textContent = myName;
    $('#wait-text').textContent = 'Watch the big screen. The first song starts soon.';
    $('#wait-count').textContent = `${s.players.length} player${s.players.length === 1 ? '' : 's'} in the room`;
    show('wait');
  } else if (s.phase === 'question') {
    if (s.q !== currentQ) newQuestion(s);
    $('#pq-label').textContent = `Song ${s.q} of ${s.total}`;
    $('#pq-score').textContent = `${myScore} pts`;
    duration = s.duration || 1;
    const newEnds = Date.now() + s.remaining;
    if (Math.abs(newEnds - endsAt) > 400) endsAt = newEnds;
    $('#artist-wrap').hidden = !s.artistBonus;
    const mine = s.solved?.[pid] || {};
    if (mine.title != null) markSolved('title', mine.title);
    if (mine.artist != null) markSolved('artist', mine.artist);
    setLocked(s.locked);
    if (!tickTimer) tickTimer = setInterval(tick, 200);
    tick();
    show('question');
  } else if (s.phase === 'reveal') {
    const r = s.reveal;
    $('#pr-title').textContent = r.title;
    $('#pr-artist').textContent = r.artist ? 'by ' + r.artist : '';
    const pts = r.round.find((x) => x.pid === pid)?.pts || 0;
    $('#pr-points').textContent = pts ? `+${pts}` : 'No points';
    const row = r.board.find((x) => x.pid === pid);
    $('#pr-rank').innerHTML = row ? `You're in place <b>${row.rank}</b> of ${r.board.length}, with ${row.score} points in total.` : '';
    show('reveal');
  } else if (s.phase === 'final') {
    const row = s.board.find((x) => x.pid === pid);
    $('#pf-rank').textContent = row ? `#${row.rank}` : '—';
    $('#pf-score').textContent = row ? `${row.score} points` : '';
    const w = s.board[0];
    $('#pf-winner').innerHTML = w ? (w.pid === pid ? 'You won. The realm salutes you.' : `<b>${esc(w.name)}</b> won with ${w.score} points.`) : '';
    show('final');
  }
}

// ───────── question ─────────
function newQuestion(s) {
  currentQ = s.q;
  tries.title = []; tries.artist = [];
  for (const k of ['title', 'artist']) {
    $(`#${k}-area`).hidden = false;
    $(`#${k}-solved`).hidden = true;
    $(`#${k}-input`).value = '';
    $(`#${k}-input`).disabled = false;
    $(`#${k}-fb`).textContent = ''; $(`#${k}-fb`).className = 'feedback';
    $(`#${k}-tries`).innerHTML = '';
  }
  setTimeout(() => $('#title-input').focus(), 50);
}

function tick() {
  if (state?.phase !== 'question') return;
  const rem = Math.max(0, endsAt - Date.now());
  const secs = Math.ceil(rem / 1000);
  const frac = Math.min(1, rem / duration);
  $('#pq-timer').textContent = rem > 0 ? secs : "Time's up";
  $('#pq-timer').classList.toggle('up', rem <= 0);
  $('#pq-bar').style.width = (100 * frac) + '%';
  $('#pq-thermo').style.setProperty('--heat', (1 - frac).toFixed(3));
}

function setLocked(locked) {
  $('#locked-box').hidden = !locked;
  for (const k of ['title', 'artist']) {
    $(`#${k}-input`).disabled = locked;
    $(`#${k}-form`).querySelector('button').disabled = locked;
  }
}

function markSolved(kind, points) {
  $(`#${kind}-area`).hidden = true;
  const box = $(`#${kind}-solved`);
  if (!box.hidden) return;
  box.innerHTML = kind === 'title'
    ? `<span class="tick"><svg><use href="#i-check"/></svg></span>Correct<span class="pts">+${points}</span>`
    : `<span class="tick"><svg><use href="#i-star"/></svg></span>Artist bonus<span class="pts">+${points}</span>`;
  box.hidden = false;
  if (kind === 'title' && !$('#artist-wrap').hidden && $('#artist-area').hidden === false) setTimeout(() => $('#artist-input').focus(), 50);
}

function submitGuess(kind) {
  const input = $(`#${kind}-input`);
  const text = input.value.trim();
  if (!text || !net) return;
  const gid = Math.random().toString(36).slice(2, 8);
  pending[gid] = { kind, text };
  net.send({ t: 'guess', pid, kind, text, gid });
  const fb = $(`#${kind}-fb`);
  fb.className = 'feedback pending'; fb.textContent = 'Checking';
}
$('#title-form').onsubmit = (e) => { e.preventDefault(); submitGuess('title'); };
$('#artist-form').onsubmit = (e) => { e.preventDefault(); submitGuess('artist'); };

const CLOSE = ['So close! Check the spelling 🔥', 'Nearly there 🔥', "Warm. You're on the right track 🔥"];
const WRONG = ['Not that one. Try again', 'Wrong tune. Try again', 'No match. Keep guessing'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function onResult(m) {
  const p = pending[m.gid]; delete pending[m.gid];
  const kind = m.kind;
  const fb = $(`#${kind}-fb`);
  const input = $(`#${kind}-input`);
  if (m.verdict === 'correct' || m.verdict === 'already') {
    markSolved(kind, m.points);
    if (m.total != null) $('#pq-score').textContent = `${m.total} pts`;
    navigator.vibrate?.(80);
    return;
  }
  if (m.verdict === 'locked') { setLocked(true); fb.textContent = ''; return; }
  if (m.verdict === 'unknown') { hello(true); fb.className = 'feedback pending'; fb.textContent = 'Reconnecting. Send it again in a second'; return; }

  const close = m.verdict === 'close';
  fb.className = 'feedback ' + (close ? 'close' : 'wrong');
  fb.textContent = close ? pick(CLOSE) : pick(WRONG);
  fb.classList.remove('nudge'); void fb.offsetWidth; fb.classList.add('nudge');
  if (p) {
    tries[kind].unshift({ text: p.text, close });
    tries[kind] = tries[kind].slice(0, 6);
    $(`#${kind}-tries`).innerHTML = tries[kind].map((t) => `<span class="${t.close ? 'close' : ''}">${esc(t.text)}</span>`).join('');
  }
  if (!close) input.value = '';   // keep near-misses so they can fix the spelling
  input.focus();
}

$('#btn-leave').onclick = () => location.reload();
$('#btn-msg-back').onclick = () => location.reload();
