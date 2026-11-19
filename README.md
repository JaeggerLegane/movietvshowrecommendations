# Next Watch

Netflix-style recommendations for movies and TV shows that are **not on your NAS yet**.

- **Home**: rows of posters like Netflix and Plex: *Top picks for you*, *Because you recently added …*, one row per favourite (Horror, Detective, Mafia & drugs, War, Sci-Fi), *New releases*, *Highest rated on IMDb*, *Hidden gems*, *Because you have …* and a row per other genre.
- **Filters**: All / Movies / TV shows at the top, and genre chips below it (★ = your favourites).
- **Title page** (like Plex): poster, description, content rating, IMDb and TMDB scores, runtime or seasons and episodes, seasons with posters, cast & crew, trailer, links to IMDb and TMDB, and *why* it is recommended ("Because you have Sicario and Narcos").
- **My list** and **Not interested** on every title. Hidden titles can be brought back on the Status page.
- **Search** finds titles in your recommendations, and other titles with the reason they're left out (already on the NAS, too old, rated too low, ...).
- **Status page** (gear icon): what was found on the NAS, folders that weren't recognised, why titles were left out, the TMDB key, the version that's running.

## Your rules

| Rule | Setting in `nas/.env` |
| --- | --- |
| Released in 1970 or later | `MIN_YEAR=1970` |
| IMDb rating 6 or higher, except horror (horror is always allowed) | `MIN_IMDB=6` |
| An IMDb rating counts from 500 votes. Titles from the last 6 months that have no IMDb rating yet use the TMDB score instead | `MIN_VOTES=500` |
| Not already on the NAS (any library: movies, tv, anime, biographies, ...), including re-edits of movies you have such as *The Godfather Trilogy: 1901-1980* | — |
| Favourites rank higher: horror, detective, mafia & drug crime, war, sci-fi | `src/genres.js` |

TV reality, talk shows, news, soaps and kids' shows are never recommended.

## How it works

1. Every 6 hours it reads `\\jaeggerlegane\media\libraries` (read-only): `movies`, `tv`, and every other library next to them (anime, biographies, Korean, ...). In those other libraries a folder with seasons or episodes counts as a show, anything else as a movie; photo and home-video folders are skipped. Each folder name is matched to a TMDB title. Names like `Heat (1995)`, `Heat.1995.1080p.BluRay.x264`, `Aliens DC (1986) [1080p]`, `Heat (1995) {tmdb-949}` and collection folders all work. The Status page lists the folders that could not be recognised.
2. It collects candidates from TMDB: "people who liked *this title you have* also liked …" for every title on your NAS, plus the best and most popular titles in your favourite genres.
3. It looks up the details of the best ~2,500 movies and ~1,500 shows (poster, seasons, cast) and their IMDb ratings. Ratings come from IMDb's free daily download (datasets.imdbws.com, personal use).
4. It applies your rules, scores what's left (IMDb rating + favourite genres + how many of your titles point to it + recent), and saves the result.

The first run takes about 5 minutes; after that everything is remembered (title details for 14 days) and an update takes a minute or two. Nothing is written to your media folders.

## Where things are

| What | Where |
| --- | --- |
| Settings and your rules | `src/config.js` (values come from `nas/.env`) |
| Genres, favourites, keywords for "mafia & drugs" and "detective" | `src/genres.js` |
| Reading the NAS folders and matching them to TMDB | `src/library.js` |
| Collecting candidates, rules, scoring, the rows on the home page | `src/engine.js` |
| TMDB and IMDb | `src/tmdb.js`, `src/imdb.js` |
| Pages | `public/` |
| What the app remembers (recommendations, your list, hidden titles, the TMDB key) | `data/` on the NAS, never on GitHub |

`npm test` checks that folder names are read correctly.

## Run it on the Synology NAS (same setup as the promotion hunter and the family wishlist)

The `nas` folder runs the app in Container Manager next to a small Tailscale container. Tailscale Funnel publishes it at `https://nextwatch.<your-tailnet>.ts.net`. The NAS downloads the code from this private GitHub repository and checks it every 5 minutes: after a push, the NAS updates and restarts the app by itself.

1. **Tailscale auth key**: login.tailscale.com/admin/settings/keys → *Generate auth key*. Copy it (starts with `tskey-auth-`).
2. **GitHub token** (lets the NAS read this repository, nothing else): github.com → your picture → *Settings* → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* → *Generate new token*. Name `NAS next watch`, the longest expiration. Repository access: *Only select repositories* → `movietvshowrecommendations`. Permissions → *Contents*: **Read-only**. Copy the token.
3. **Folders**: in File Station open the shared folder `docker`, create `nextwatch/nas`, and inside `nas` the folders `code`, `data`, `tailscale` and `serve`.
4. **Two files**: put `nas/serve/serve.json` from this repository in `serve`. Save `nas/.env.example` as `.env` in `docker/nextwatch/nas` and fill in the 2 lines that say FILL-IN (the Tailscale key and a password you choose).
5. **Container Manager** → *Project* → *Create*: name `nextwatch`, path `docker/nextwatch/nas`, *Create docker-compose.yml*, paste the contents of `nas/docker-compose.yml`, and replace the `FILL-IN: ...` text after `GITHUB_TOKEN:` with the GitHub token (keep the quotes). If your `media` shared folder isn't on `volume1`, change the two `/volume1/media/...` lines. Skip the web portal step, then build and start.
6. Open `https://nextwatch.<your-tailnet>.ts.net` and sign in with your password. The first time, the address can take a few minutes to start working.
7. The app asks for a **TMDB key** (free): make an account on themoviedb.org → *Settings* → *API* → request a key (*Developer*, personal use). Paste the long **API Read Access Token** in the app. It then builds your recommendations (about 5 minutes the first time; the page shows the progress).

**Your other libraries** (anime, biographies, ...). The app counts everything in `\\jaeggerlegane\media\libraries` as yours, so it needs the whole folder. Projects made before 19 November 2026 only share `movies` and `tv`. To change that once: Container Manager → *Project* → `nextwatch` → *Action* → *Stop*. Open the project's YAML and replace the two lines that start with `- /volume1/media/libraries/` with this one line (same indentation): `- /volume1/media/libraries:/library:ro`. Save, then *Action* → *Build*. The Status page then lists every library it read. To leave a library out, add `IGNORE_LIBRARIES=Fights,Concerts` (folder names) to `.env`.

**Updates** arrive within 5 minutes of a push. To update right away: Container Manager → *Project* → `nextwatch` → *Action* → *Restart*. The Status page shows which version is running.

**Something wrong?** Container Manager → *Container* → `nextwatch-nextwatch-1` → *Log*, or the Status page in the app.

## Try it in the browser with GitHub Codespaces

For when the NAS address is blocked, such as at the office. In the repository on github.com: **Code → Codespaces → Create codespace on main**. The app starts by itself and opens in a new tab, without signing in (the address is private to your GitHub login). There are no NAS folders there, so it recommends as if your library were empty. Stop the codespace when you are done (*Codespaces → Stop*).

## Try it on a computer

Needs Node.js 22 or later. Copy `.env.example` to `.env` (it already points at your NAS folders through the network) and fill in a password and your TMDB key.

```sh
npm ci
npm start
```

Then open http://localhost:3000.

**Without a TMDB key or internet** (for testing): `npm run mock` starts a pretend TMDB with made-up titles and a fake library in `test/library`. The command to start the app against it is at the top of `test/mock-tmdb.js`.
