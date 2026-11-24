// Run with: node tests/csv.test.mjs
import { songsFromCsv, songsToCsv } from '../js/csv.js';
import assert from 'node:assert/strict';

const withHeader = `Spotify link,Song title,Original artist,Also accept,Start at (seconds)
https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC,Bad Romance,Lady Gaga,"Rah rah ah ah ah, Gaga oh la la",12
https://open.spotify.com/track/0SiywuOBRcynK0uKGWdCnn,"Don't Stop ""Believin""",Journey,,0
`;
let s = songsFromCsv(withHeader);
assert.equal(s.length, 2);
assert.equal(s[0].alts, 'Rah rah ah ah ah, Gaga oh la la');
assert.equal(s[0].start, 12);
assert.equal(s[1].title, 'Don\'t Stop "Believin"');

// no header, semicolons (Excel in Danish locale), CRLF
s = songsFromCsv('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC;Toxic;Britney Spears;;5\r\n');
assert.deepEqual(s[0], { url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', title: 'Toxic', artist: 'Britney Spears', alts: '', start: 5 });

// shuffled columns with header
s = songsFromCsv('title,artist,link\nHey Ya,OutKast,https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC\n');
assert.equal(s[0].title, 'Hey Ya'); assert.equal(s[0].artist, 'OutKast'); assert.match(s[0].url, /open\.spotify/);

// round trip
const back = songsFromCsv(songsToCsv(songsFromCsv(withHeader)));
assert.deepEqual(back, songsFromCsv(withHeader));
console.log('All CSV tests passed');
