// Tiny CSV reader/writer for quiz files. Handles quoted fields ("a, b"),
// doubled quotes, commas or semicolons as separators, and an optional header row.

export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some(Boolean));
}

const COLS = {
  url: /spotify|link|url/i,
  title: /title|song|answer/i,
  artist: /artist|singer|band/i,
  alts: /also|alt|accept/i,
  start: /start|sec/i,
};

// rows -> [{url, title, artist, alts, start}]
export function songsFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  let order = ['url', 'title', 'artist', 'alts', 'start'];
  const head = rows[0];
  const looksLikeHeader = !head.some((c) => /open\.spotify\.com|^spotify:/i.test(c)) &&
    head.some((c) => Object.values(COLS).some((re) => re.test(c)));
  let body = rows;
  if (looksLikeHeader) {
    order = head.map((h) => {
      // check the more specific columns first so "song title" isn't read as a link
      for (const key of ['alts', 'artist', 'start', 'url', 'title']) if (COLS[key].test(h)) return key;
      return null;
    });
    body = rows.slice(1);
  }
  return body.map((r) => {
    const s = {};
    order.forEach((key, i) => { if (key && r[i] != null && s[key] == null) s[key] = r[i]; });
    return {
      url: s.url || '', title: s.title || '', artist: s.artist || '', alts: s.alts || '',
      start: Math.max(0, parseInt(s.start, 10) || 0),
    };
  }).filter((s) => s.url || s.title);
}

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function songsToCsv(songs) {
  const lines = [['Spotify link', 'Song title', 'Original artist', 'Also accept', 'Start at (seconds)']]
    .concat(songs.map((s) => [s.url, s.title, s.artist, s.alts, s.start || 0]));
  return lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
}
