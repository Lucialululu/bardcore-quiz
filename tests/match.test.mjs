// Run with: node tests/match.test.mjs
import { checkGuess } from '../js/match.js';

const cases = [
  // [guess, answers, expected]
  ['Bohemian Rhapsody', ['Bohemian Rhapsody'], 'correct'],
  ['bohemian rapsody', ['Bohemian Rhapsody'], 'correct'],
  ['BOHEMIAN RHAPSODY!!', ['Bohemian Rhapsody'], 'correct'],
  ['bohemian', ['Bohemian Rhapsody'], 'close'],
  ['bohemain', ['Bohemian Rhapsody'], 'close'],
  ['final countdown', ['The Final Countdown'], 'correct'],
  ['dont stop believing', ["Don't Stop Believin'"], 'correct'],
  ['toxik', ['Toxic'], 'correct'],
  ['tox', ['Toxic'], 'wrong'],
  ['hey ya', ['Hey Ya!'], 'correct'],
  ['bad romance lady gaga', ['Bad Romance'], 'correct'],
  ['poker face', ['Bad Romance'], 'wrong'],
  ['rah rah ah ah ah', ['Bad Romance', 'Rah rah ah ah ah'], 'correct'],
  ['beyonce', ['Beyoncé'], 'correct'],
  ['seven nation army', ['Seven Nation Army'], 'correct'],
  ['seven nations', ['Seven Nation Army'], 'close'],
  ['army', ['Seven Nation Army'], 'wrong'],
  ['old town road', ['Old Town Road (feat. Billy Ray Cyrus)'], 'correct'],
  ['', ['Toxic'], 'wrong'],
  ['smells like teen spirit', ['Smells Like Teen Spirit'], 'correct'],
  ['smells like teen', ['Smells Like Teen Spirit'], 'close'],
  ['Lady Gaga', ['Lady Gaga'], 'correct'],
  ['lady gagaa', ['Lady Gaga'], 'correct'],
  ['gaga', ['Lady Gaga'], 'close'],
  ['queen', ['Lady Gaga'], 'wrong'],
];

let fail = 0;
for (const [g, a, exp] of cases) {
  const got = checkGuess(g, a);
  const ok = got === exp;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(g).padEnd(28)} vs ${JSON.stringify(a[0]).padEnd(40)} -> ${got}${ok ? '' : ` (expected ${exp})`}`);
}
console.log(fail ? `\n${fail} failing` : '\nAll passed');
process.exit(fail ? 1 : 0);
