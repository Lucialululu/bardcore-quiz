# 🪕 Bardcore Quiz

A live music quiz for medieval ("bardcore") covers of modern songs. The host screen plays the cover from Spotify, players type the original song's title on their phones, and near-misses get a **"So close! 🔥"** nudge without giving the answer away.

- **Host screen** (`/host`): set up songs and settings, show the room code + QR code, play each clip, reveal the answer and the scores.
- **Phones** (`/`): join with a 4-letter code and a name (or team name), then guess as many times as they like.

No build step, no server code: it's a static site. The live connection between phones and the host uses **Supabase Realtime** (free plan).

---

## How a game works

1. **Setup**: paste Spotify links to the covers. For each one, enter the **original song title** (the answer), the original artist, any alternative answers, and the second the clip should start at. Choose the time per song and the other settings.
2. **Lobby**: the big screen shows the join address, a QR code and the room code. Players appear as they join. Click a name to remove a player.
3. **Each song**: the clip plays while the Spotify player stays hidden, so the title isn't shown. Players type guesses with unlimited tries:
   - **Correct**: small typos, capital letters, punctuation and a leading "The" are all forgiven. 400–1000 points, and faster answers earn more.
   - **So close! 🔥**: the guess is near the answer (a misspelling, or part of the title). The answer itself is never shown.
   - **Artist bonus** (optional): +300 for the original artist.
4. **Reveal**: when time runs out (or you press **Reveal answer**), the big screen shows the answer, who got it and how fast, points this round, and the leaderboard with ▲▼ moves. You press **Next song** when you're ready.
5. **Final**: a podium and the full standings.

Host controls during a song: **Replay clip**, **Pause music**, **+10 s**, **Show player** (peek at the Spotify embed), **Reveal answer**.

### Settings

| Setting | What it does |
|---|---|
| Time per song | 10–120 seconds |
| Artist bonus | Shows a second "original artist" box on phones (+300) |
| Reveal automatically | When time runs out, go straight to the reveal. Turn it off to show "Time's up!" and reveal yourself |
| End early | If everyone has found the answer (and the artist, if the bonus is on), end the song right away |
| Shuffle | Randomise the song order when the game starts |

Your song list is saved in the host browser automatically. Use **Export quiz** and **Import quiz** to keep it as a file or move it to another computer. If the host tab is refreshed mid-game, a **Resume** button brings the game back.

### Answer tips

- **Also accept** takes comma-separated alternatives, for example `Rah rah ah ah ah, Gaga oh la la`.
- In **Original artist**, separate alternatives with `/`, for example `Simon & Garfunkel / Simon and Garfunkel`.
- Text in brackets is ignored on both sides, so `Old Town Road (feat. Billy Ray Cyrus)` accepts `old town road`.

---

## Setup (about 10 minutes, once)

### 1. Supabase (the live connection)

1. Create a free account at [supabase.com](https://supabase.com) and click **New project**. Any name and password will do. Pick the region closest to you, e.g. *Central EU (Frankfurt)*.
2. Open **Project Settings → API** (in newer dashboards, **Project Settings → API Keys** and **Data API**) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **anon / public** key (the long `eyJ…` string, or the `sb_publishable_…` key)
3. Paste them into [`js/config.js`](js/config.js):

   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi…';
   ```

   The anon key is designed to be public, so it's fine to commit it.
4. You don't need any database tables. The quiz only uses Realtime *broadcast* messages. If you ever changed it: under **Realtime → Settings**, "Allow public access" must be **on**.

Until `config.js` is filled in, the app runs in **demo mode**, where it only works between tabs in one browser. That's handy for trying it out.

### 2. Vercel (hosting)

1. Go to [vercel.com](https://vercel.com), sign in with GitHub, and click **Add New → Project**.
2. Import `bardcore-quiz`. Framework preset: **Other**. Leave the build settings empty, then click **Deploy**.
3. You'll get an address like `bardcore-quiz.vercel.app`:
   - Host screen: `https://bardcore-quiz.vercel.app/host`
   - Players: `https://bardcore-quiz.vercel.app` (or scan the QR code in the lobby)

Every push to `main` redeploys automatically.

### 3. Spotify

There's no Spotify developer account or API key to set up. The app uses Spotify's public embed player.

- **Log in to Spotify in the browser you host from** (open open.spotify.com once). Logged in, full songs play. Logged out, Spotify usually only plays a 30-second preview, so keep **Start at** within the first 30 seconds.
- Some browsers block autoplay the first time. If a song doesn't start, the app shows the player. Press ▶ once and it works from then on.
- Ad blockers can block the Spotify player. If it won't load, try turning the ad blocker off for your quiz site.

---

## Running locally

```bash
python3 -m http.server 8000
# host:   http://localhost:8000/host.html
# player: http://localhost:8000/   (another tab, in demo mode)
```

Answer-matching tests:

```bash
node tests/match.test.mjs
```

## Files

```
index.html        phone / player page
host.html         host screen
css/style.css     medieval styling
js/config.js      ← your Supabase URL + key
js/host.js        game logic (the host is the referee: answers never leave the host screen until the reveal)
js/play.js        phone logic
js/match.js       fuzzy answer matching ("correct" / "close" / "wrong")
js/net.js         Supabase Realtime broadcast (or BroadcastChannel in demo mode)
js/spotify.js     Spotify embed controller
```
