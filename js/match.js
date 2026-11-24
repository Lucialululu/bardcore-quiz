// Fuzzy answer matching for typed guesses.
// Returns 'correct', 'close' or 'wrong'. Never returns the answer itself,
// so the player's phone can't learn it from a near-miss.

export function normalize(input) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')      // strip accents: "Beyoncé" -> "beyonce"
    .replace(/\(.*?\)|\[.*?\]/g, ' ')     // drop "(feat. X)", "[Bardcore]"
    .replace(/&/g, ' and ')
    .replace(/['’`´]/g, '')               // "don't" -> "dont"
    .replace(/[^a-z0-9]+/g, ' ')          // punctuation -> space
    .replace(/\b(feat|ft|featuring)\b.*$/, '')
    .trim()
    .replace(/^(the|a|an) /, '')          // "The Final Countdown" == "Final Countdown"
    .replace(/\s+/g, ' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

// How many typos we forgive, based on answer length (without spaces).
function tolerance(len) {
  if (len <= 4) return 0;
  if (len <= 8) return 1;
  if (len <= 14) return 2;
  return 3;
}

function judgeOne(guess, answer) {
  const g = guess.replace(/ /g, '');
  const a = answer.replace(/ /g, '');
  if (!g || !a) return 'wrong';
  if (g === a) return 'correct';

  const d = levenshtein(g, a);
  if (d <= tolerance(a.length)) return 'correct';

  // Answer plus a little extra, e.g. "bad romance lady gaga".
  if (a.length >= 4 && g.includes(a) && g.length <= a.length * 1.6 + 4) return 'correct';

  // --- "So close!" territory ---
  const similarity = 1 - d / Math.max(g.length, a.length);
  if (g.length >= 4 && similarity >= 0.6) return 'close';

  // Got the start of it (typos allowed): "bohemain" for "bohemian rhapsody".
  if (g.length >= 4 && g.length >= a.length * 0.4 &&
      levenshtein(g, a.slice(0, g.length)) <= tolerance(g.length + 2)) return 'close';

  // Half or more of the answer's words are present.
  const aw = answer.split(' ').filter((w) => w.length > 2);
  const gw = new Set(guess.split(' '));
  if (aw.length >= 2) {
    const hits = aw.filter((w) => gw.has(w)).length;
    if (hits / aw.length >= 0.5) return 'close';
  }
  return 'wrong';
}

const RANK = { wrong: 0, close: 1, correct: 2 };

export function checkGuess(guess, answers) {
  const g = normalize(guess);
  if (!g) return 'wrong';
  let best = 'wrong';
  for (const raw of answers) {
    const a = normalize(raw);
    if (!a) continue;
    const v = judgeOne(g, a);
    if (RANK[v] > RANK[best]) best = v;
    if (best === 'correct') break;
  }
  return best;
}

// "Bad Romance, Rah rah ah ah" -> ["Bad Romance", "Rah rah ah ah"]
export function splitAlts(text) {
  return String(text ?? '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
