# Spoot

Spoot is a personal, non-commercial Spotify player for people who want the
music without the feed. It turns the browser into a Spotify Connect device and
keeps the original player's monochrome liquid-glass interface: floating Now
Playing and queue widgets, compact transport controls, and an immersive view.

The app is plain HTML, CSS, and JavaScript. It has no framework, build step,
backend, or Spotify Client Secret.

## What works

- Spotify Authorization Code with PKCE and session restoration
- automatic registration of a Web Playback SDK device named `Spoot`
- a device-aware **Listen here** handoff and custom Spotify Connect picker
- play/pause, previous/next, seeking, and repeat; shuffle is intentionally disabled while hybrid local/Spotify ordering is active
- live browser volume, Media Session metadata, and optional media-key skipping
- normalized Spotify playback state, artwork, progress, and queue rendering
- queue selection that advances Spotify's real open-ended queue one item at a
  time, preserving the active album/playlist context and Spotify's appended
  recommendation tail instead of replacing it with a finite URI list
- Liked Songs plus fully paginated owned/collaborative playlists; playlist
  playback keeps the full Spotify context and selected position
- session-only bounded caches for search, the playlist list, opened playlist
  contents, and Liked Songs; explicit refresh controls bypass the cache
- an Add to playlist picker with client-side filtering, lazy membership checks,
  Spotify and Spoot-only Liked Songs support, and a separate full Create Playlist form
- owned-playlist editing for name, description, privacy, custom cover, song
  removal, and drag-to-reorder with Spotify snapshot-aware rollback
- a separate Local Files collection backed by IndexedDB, with imports from the
  computer or Dropbox, isolated browser-audio playback, and client-only placement
  inside Spotify playlists and Spoot's local Liked Songs overlay
- playlist song counts, exact loaded duration, album names, and track durations
- metadata-only display for followed playlists Spotify will not expose
- Spotify catalog search across songs, artists, albums, and playlists
- album pages with complete paginated track lists, release metadata, duration,
  and context-preserving playback from any selected song
- synced or plain lyrics in the floating and immersive players, with
  click-to-seek, persistent manual/embedded-over-LRCLIB priority, editable text,
  provider result selection, and the original timestamp-sync workflow
- draggable widget positions and responsive immersive mode
- an explicit mock adapter that exercises the same controller and UI boundary

## Try the interface without Spotify

From the repository root, start the static server on Windows:

```powershell
python -m http.server 5173 --bind 127.0.0.1
```

Open [http://127.0.0.1:5173/?mock=1](http://127.0.0.1:5173/?mock=1).
Mock mode requires `mock=1`; it is never selected during an ordinary live
startup.

Use `scenario` to inspect specific states:

| Scenario | URL suffix | Expected state |
| --- | --- | --- |
| Default | `?mock=1` or `?mock=1&scenario=default` | ready device, playing track, queue, and moving progress |
| Paused | `?mock=1&scenario=paused` | paused track |
| Empty queue | `?mock=1&scenario=empty-queue` | current item with no upcoming items |
| Authorization error | `?mock=1&scenario=auth-error` | actionable sign-in failure |
| SDK error | `?mock=1&scenario=sdk-error` | actionable player initialization failure |
| Rate limit | `?mock=1&scenario=rate-limit` | simulated Spotify throttling error |
| Null state | `?mock=1&scenario=null` | connected device with no current playback state |

## Connect Spotify

Spoot's live player requires Spotify Premium. Development Mode also requires
the app owner to have Premium and limits the app to five allowlisted users; see
Spotify's current [Development Mode rules](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
and [Web Playback SDK requirements](https://developer.spotify.com/documentation/web-playback-sdk).
The SDK currently requires `streaming`, `user-read-private`, and
`user-read-email`; Spoot requests the email scope for SDK authorization but
does not read, display, or store the account's email address.
Library access uses `user-library-read`, `playlist-read-private`, and
`playlist-read-collaborative`. Adding/removing songs and creating or editing playlists also uses
`user-library-modify`, `playlist-modify-private`, `playlist-modify-public`, and
`ugc-image-upload` for custom playlist covers. Existing Spoot sessions must log
out and authorize one more time after these scopes are added.

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Register this exact redirect URI: `http://127.0.0.1:5173/`
3. Copy the example configuration:

   ```powershell
   Copy-Item .\src\js\config.example.js .\src\js\config.local.js
   ```

4. Replace `YOUR_SPOTIFY_CLIENT_ID` in `config.local.js` with the app's Client
   ID. A Client ID identifies a public browser app; it is not a secret. Do not
   add a Client Secret anywhere in Spoot.
5. Start the server:

   ```powershell
   python -m http.server 5173 --bind 127.0.0.1
   ```

6. Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/), choose **Log in**,
   and allow the Spotify sign-in popup. Spoot keeps its original tab open so
   the same in-memory authorization instance that created the temporary PKCE
   verifier can validate Spotify's callback. The popup hands the callback to
   that tab through a same-origin browser channel and closes after the token
   exchange succeeds. Spoot registers its browser player automatically without
   stealing playback. If Spotify is active elsewhere, the banner names that
   device and offers **Listen here**; the same devices are available from the
   custom picker in Settings. If the browser blocks autoplay, press play once
   to unlock audio.

The address bar should remain at the root URL. Query strings such as
`?oauth=11` were temporary development cache busters and are not required;
Spoot removes that legacy parameter if it is present.

Do not use `localhost`, a different port, or `file://`; Spotify compares the
redirect URI exactly. The complete authenticated procedure is in
[MANUAL_TESTING.md](./MANUAL_TESTING.md).


## Session cache and Local Files

Spotify catalog data is cached only for the lifetime of the tab. Spoot keeps a
bounded number of search results and recently opened detail pages, retains the
playlist list once per session, and stores at most three fully opened Spotify
collections. It does not preload every playlist. The refresh button in Library
reloads either the playlist list or the currently open collection from Spotify.

Local Files are different: files selected from the computer or imported from
Dropbox are user-provided media and are stored persistently in the
`spoot-local-media` IndexedDB database. Audio blobs are read only when a local
song is played, and artwork object URLs are capped so browsing local files does
not grow memory without bound. Starting a local file pauses Spotify; starting a
Spotify item pauses the local `<audio>` player.

## Hybrid playlists and lyrics

Spotify remains authoritative for every Spotify song. Spoot stores only local-file
placements in IndexedDB, anchored between stable Spotify occurrences so duplicate
tracks can still be distinguished. Dragging a Spotify row sends one Spotify reorder
request; dragging a local row updates only Spoot's overlay. Deleting a song from
Local Files removes its blob, metadata, lyrics, and every client-only placement.

Hybrid playback follows the merged order and switches between the Web Playback SDK
and one local `<audio>` element. The final remote item is released back to Spotify's
open-ended queue, while an all-local overlay resumes the Spotify session that was
playing before it. Shuffle is disabled in this release because Spotify cannot shuffle
files it does not know exist.

Lyrics are stored in the `spoot-lyrics` IndexedDB database. User edits have highest
priority, then embedded local-file lyrics, then the previously selected LRCLIB result.
Spoot performs at most one automatic LRCLIB lookup per song and persists a negative
match; the LRCLIB button always allows a manual refresh.

## Tests

Tests use Node's built-in runner and install no runtime dependencies. Node 20+
is required.

```powershell
npm test
```

`npm run check` also performs the configured JavaScript entry-point syntax
check.

## Scope

This release is intentionally a focused playback client. Library browsing is
limited to data Spotify's current Web API actually returns. Spotify does not
[return playlist folders](https://developer.spotify.com/documentation/web-api/concepts/playlists),
has no public DJ-library endpoint, and [current Development Mode](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
only exposes playlist contents for playlists the current user owns or
collaborates on. Followed Spotify/editorial/generated playlists that appear in
`/me/playlists` stay visible as grey metadata-only rows instead of pretending
to be empty.

Search and album pages use Spotify's public catalog endpoints. Lyrics remain a
fully serverless, best-effort browser integration: Spoot sends plain GET
requests directly to [LRCLIB](https://lrclib.net/), prefers synchronized
responses, and falls back to plain lyrics. Provider availability, local DNS
filtering, and catalog coverage can vary. Spoot never runs a local proxy or
extracts Spotify Desktop credentials.

The original local player is preserved, unchanged, under [`reference/`](./reference/README.md).
See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for runtime boundaries and
[`src/js/legacy/README.md`](./src/js/legacy/README.md) for the legacy feature
policy.

Live Spotify login and playback require the repository owner's own credentials
and Premium account. Automated and mock checks do not claim to verify that live
path.
