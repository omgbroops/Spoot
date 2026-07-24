# Spool

Spool is a personal, non-commercial Spotify player for people who want the
music without the feed. It turns the browser into a Spotify Connect device and
keeps the original player's monochrome liquid-glass interface: floating Now
Playing and queue widgets, compact transport controls, and an immersive view.

The app is plain HTML, CSS, and JavaScript. It has no framework, build step,
backend, or Spotify Client Secret.

## What works

- Spotify Authorization Code with PKCE and session restoration
- automatic registration of a Web Playback SDK device named `Spool`
- a device-aware **Listen here** handoff and custom Spotify Connect picker
- play/pause, previous/next, seeking, shuffle, and repeat
- live browser volume, Media Session metadata, and optional media-key skipping
- normalized Spotify playback state, artwork, progress, and queue rendering
- queue-preserving click-to-play for ordinary songs in Up Next
- Liked Songs plus fully paginated owned/collaborative playlists; playlist
  playback keeps the full Spotify context and selected position
- playlist song counts, exact loaded duration, album names, and track durations
- metadata-only display for followed playlists Spotify will not expose
- Spotify catalog search across songs, artists, albums, and playlists
- synced or plain lyrics in the floating and immersive players, with
  click-to-seek and timed auto-follow
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

Spool's live player requires Spotify Premium. Development Mode also requires
the app owner to have Premium and limits the app to five allowlisted users; see
Spotify's current [Development Mode rules](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
and [Web Playback SDK requirements](https://developer.spotify.com/documentation/web-playback-sdk).
The SDK currently requires `streaming`, `user-read-private`, and
`user-read-email`; Spool requests the email scope for SDK authorization but
does not read, display, or store the account's email address.
Library access additionally uses `user-library-read`, `playlist-read-private`,
and `playlist-read-collaborative`.

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Register this exact redirect URI: `http://127.0.0.1:5173/`
3. Copy the example configuration:

   ```powershell
   Copy-Item .\src\js\config.example.js .\src\js\config.local.js
   ```

4. Replace `YOUR_SPOTIFY_CLIENT_ID` in `config.local.js` with the app's Client
   ID. A Client ID identifies a public browser app; it is not a secret. Do not
   add a Client Secret anywhere in Spool.
5. Start the server:

   ```powershell
   python -m http.server 5173 --bind 127.0.0.1
   ```

6. Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/), choose **Log in**,
   and allow the Spotify sign-in popup. Spool keeps its original tab open so
   the same in-memory authorization instance that created the temporary PKCE
   verifier can validate Spotify's callback. The popup hands the callback to
   that tab through a same-origin browser channel and closes after the token
   exchange succeeds. Spool registers its browser player automatically without
   stealing playback. If Spotify is active elsewhere, the banner names that
   device and offers **Listen here**; the same devices are available from the
   custom picker in Settings. If the browser blocks autoplay, press play once
   to unlock audio.

The address bar should remain at the root URL. Query strings such as
`?oauth=11` were temporary development cache busters and are not required;
Spool removes that legacy parameter if it is present.

Do not use `localhost`, a different port, or `file://`; Spotify compares the
redirect URI exactly. The complete authenticated procedure is in
[MANUAL_TESTING.md](./MANUAL_TESTING.md).

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

Search uses Spotify's public catalog endpoint. Lyrics are a best-effort static
browser integration: Spool tries the provider formats used by BetterLyrics,
prefers synchronized responses, and falls back to
[LRCLIB](https://www.lrclib.net/docs). Provider CORS, availability, and catalog
coverage can vary. Spool deliberately does not include BetterLyrics' optional
Spotify Desktop/Spicetify companion bridge, and it never runs a local service
or extracts desktop credentials.

Local-file and Dropbox import, playlist editing, recommendations, statistics,
sleep timer, lyrics editing/manual synchronization, full queue editing,
playback speed, EQ, reverb, crossfade, and gapless controls remain inactive.
The Sound modal's Spool volume is the deliberate exception and controls only
the browser SDK device. No inactive surface reports fake success or controls a
hidden local audio engine.

The original local player is preserved, unchanged, under [`reference/`](./reference/README.md).
See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for runtime boundaries and
[`src/js/legacy/README.md`](./src/js/legacy/README.md) for the legacy feature
policy.

Live Spotify login and playback require the repository owner's own credentials
and Premium account. Automated and mock checks do not claim to verify that live
path.
