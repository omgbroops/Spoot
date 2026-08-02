# Authenticated Spotify manual test

This is the final live-account check for Spoot. The automated suite covers the
PKCE helpers, token and API edge cases, state normalization, mock controller,
UI plumbing, and the guard against starting the legacy audio engine. It cannot
prove that a real Spotify account can authorize, that Spotify will provision a
Web Playback SDK device, or that protected audio will play in your browser.

No live Spotify login or playback is claimed to have been tested by the
repository's automated checks. Perform the 19 steps below with your own account.

## Before you begin: current Spotify limits

These constraints were checked against Spotify's documentation on July 23,
2026 and can change:

- The owner of a Development Mode app must have an active Spotify Premium
  subscription. A Development Mode app supports up to five authenticated users,
  and each user must be added to the app's allowlist. An unallowlisted user may
  appear to log in but their API calls return `403`. Spotify documents this in
  [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
- The account actually using Spoot must have a Spotify Premium subscription;
  the Web Playback SDK does not support free accounts or mobile-only Premium
  plans. See the official [Web Playback SDK overview](https://developer.spotify.com/documentation/web-playback-sdk)
  and [SDK reference](https://developer.spotify.com/documentation/web-playback-sdk/reference).
- Spotify's Web Playback SDK authorization guide currently requires
  `streaming`, `user-read-private`, and `user-read-email`. Spoot never reads or
  stores the account email; that scope is requested only because the SDK lists
  it as a browser-player prerequisite.
- Library browsing additionally requires `user-library-read`,
  `playlist-read-private`, and `playlist-read-collaborative`. Current
  Development Mode only exposes the items of playlists the user owns or
  collaborates on; followed Spotify/editorial/generated playlists can be
  returned as metadata without readable items. Spotify does not return playlist
  folders through the Web API.
- Access tokens normally last one hour. Refresh tokens issued to Developer
  Dashboard apps last six months from the original user authorization, and
  refreshing an access token does not extend that six-month lifetime. An
  expired or rejected refresh token requires a new sign-in. See Spotify's
  [refresh-token guide](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).
- Spotify permits HTTP only for an explicit loopback IP during local
  development. `http://localhost` is not accepted. See
  [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

Use a current Chrome, Edge, Firefox, or Safari release with protected-content
playback enabled. The Spotify SDK may fail when Encrypted Media Extensions
(EME), autoplay, or required iframe permissions are blocked. Privacy,
anti-tracking, script-blocking, and third-party-content extensions can also
prevent the SDK from loading. Spotify lists these browser issues in its
[Web Playback SDK troubleshooting notes](https://developer.spotify.com/documentation/web-playback-sdk).

## The 19-step check

### 1. Create or configure the Spotify Developer app

Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard),
create or select the app, and confirm its owner has Premium. Under **Users
Management**, add the Spotify name and email for every account that will test
Spoot; Development Mode permits at most five authenticated users. The playback
account itself must also be Premium.

### 2. Register the redirect URI

In the app settings, add and save exactly:

```text
http://127.0.0.1:5173/
```

The scheme, explicit IP, port, path, and trailing slash must match. Do not
substitute `localhost`.

### 3. Add the Client ID locally

From the repository root in PowerShell:

```powershell
Copy-Item .\src\js\config.example.js .\src\js\config.local.js
```

Open `src/js/config.local.js` and replace only
`YOUR_SPOTIFY_CLIENT_ID`. Leave the redirect URI as
`http://127.0.0.1:5173/` and the device name as `Spoot` unless you intentionally
need a different display name. Never paste a Spotify Client Secret into this
browser app. `config.local.js` is ignored by Git.

### 4. Start the static server

Run the exact Windows command from the repository root:

```powershell
python -m http.server 5173 --bind 127.0.0.1
```

Keep the terminal open for the rest of the test. A successful request should be
visible in its access log.

### 5. Open the correct loopback address

Navigate directly to [http://127.0.0.1:5173/](http://127.0.0.1:5173/).
Do not open `index.html` through `file://`, do not use `localhost`, and do not
include `mock=1`. Confirm that setup/login remains visible rather than leaving
you on a blank player.

### 6. Log in

Choose **Log in**, allow the popup for `127.0.0.1`, authenticate with an
allowlisted Premium account, and approve the requested scopes. Keep the
original Spoot tab open while the popup is on Spotify. After Spotify redirects
the popup back:

- the popup should close and the original Spoot tab should remain at the exact
  loopback URL;
- the original tab should never receive `code`, `state`, or other OAuth
  callback parameters in its address bar;
- the SDK should begin registering the Spoot device automatically without
  transferring playback away from another device;
- no access or refresh token should be printed in the console or URL.

If you deny access, Spoot should show a readable denial and allow a fresh login.

### 7. Verify automatic Web Playback SDK registration

Wait for Spoot to report a ready player/device; no separate Connect Player click
is required. In another Spotify client, open the device picker and confirm that
**Spoot** appears. Registration must not steal playback from the current device.
Initialization, account, authentication, and playback failures should be shown
as actionable errors rather than leaving the page blank.

### 8. Transfer playback into Spoot

If another client is active, confirm the banner says **Listening on _device_**
(or the neutral fallback) and choose **Listen here**. The status should move
through transfer and then disappear while Spoot is active, without repeatedly
transferring in a loop. If playback arrives paused or
the browser reports an autoplay failure, click or press play once in Spoot; that
user gesture unlocks protected browser audio. Spotify explicitly recommends
activating the SDK element from a user interaction in its
[SDK player reference](https://developer.spotify.com/documentation/web-playback-sdk/reference#api-spotify-player-activateelement).

### 9. Start a track elsewhere if needed

If Spotify reports no current player state, start an ordinary track in the
Spotify desktop, mobile, or web app, then select **Spoot** again. Confirm the
main artwork, title, artists, duration, ambient background, and document title
reconcile to that track. A temporary null state should show an empty/recoverable
state, not crash the UI.

### 10. Test play and pause

Use the main play/pause button several times. Confirm the icon, accessible
label, status, and progress agree with audible playback. While paused, progress
must stop; after resuming it should continue without calling Spotify every
animation frame. The spacebar shortcut should operate the same controller when
focus is not inside an input.

### 11. Test previous and next

Use both transport buttons and the Shift+Left/Shift+Right shortcuts. Confirm
that metadata, artwork, duration, background, document title, and queue update
after each confirmed Spotify track change. Restrictions or command rejection
must produce a readable message rather than a fake local change.

### 12. Test seeking

Click or drag the main seek bar to an interior position, then use Left/Right to
move by five seconds. Confirm Spotify playback and the displayed current time
reconcile. Repeat near the beginning and end to verify clamping. A restricted or
non-seekable item should remain stable and report the rejection.

### 13. Test shuffle

Toggle shuffle from the main player. Confirm its pressed/active state changes
only after the Spotify command succeeds and remains correct after the next
authoritative state refresh.

### 14. Test repeat

Press repeat three times and verify the order `off` -> `context` -> `track` ->
`off`. The title/label and visual state should match Spotify after each command.

### 15. Test queue, Library, and search behavior

Open **Up Next** (or press Q). Confirm it renders a **Now Playing** row and the
upcoming Spotify items with artwork, title, artist/show names, and sensible
track/episode handling. Click the first and then a later ordinary upcoming song.
When the current source is an album or playlist, Spoot should issue one Start
Playback request with that context and the selected track offset; Spotify should
rebuild the remaining queue. It must not send a burst of Skip Next commands to
walk down the list. A source without an addressable album/playlist context may
start the selected track directly because Spotify exposes no jump-to-queue-row
endpoint. If Spotify has appended autoplay recommendations after an album,
click one of those recommendation rows and confirm Spoot starts from that
visible recommendation tail instead of sending an invalid album offset.
Episode, local, null, restricted, and unplayable rows must remain grey and
inert. Skip a track and verify the queue refreshes. An empty Spotify queue
should show an honest empty state. **Clear**, remove, and drag to reorder must
remain inactive.

Open **Library**. Confirm Liked Songs and every playlist returned by Spotify are
listed. The back arrow belongs beside the **Library** title. An
owned/collaborative playlist should load all item pages, show song count and
total duration, and list each song's album and duration without a date-added
column. Click a song in the middle: Spotify's queue should contain the rest of
that playlist after the selected position instead of repeated copies of one
song. A followed Spotify/editorial or generated playlist should remain visible
but grey as **Metadata only**. A playlist-item `403` must downgrade to that state
instead of looking empty. The Library note must explain that Spotify does not
expose playlist folders or DJ; Spoot must not invent either.

Open **Search** from the dock or press `/`. Confirm the debounced results are
grouped into Songs, Artists, Albums, and Playlists. Song results should start in
their album context; artist and playlist results should start the whole returned
context. Selecting an album should open its Album page instead of immediately
starting playback. Confirm the page shows its artwork, artist, year, song count,
total duration, complete paginated track list, per-song artist and duration, and
a back arrow beside **Album**. Play a middle song and verify Spotify retains the
album context and continues with the following tracks. Unavailable rows must
stay inert, and the external Spotify link must not accidentally trigger playback.

### 16. Test devices, volume, system media, and immersive mode

Open Settings and expand the custom Listening Device control. Confirm the
active device is selected, unavailable/restricted devices cannot be chosen, and
selecting another available device transfers playback there. After transfer,
the top banner should offer **Listen here** again. Select Spoot and confirm it
hides.

Press L to open the floating lyrics widget while a normal song is playing.
Synced lyrics should highlight and follow the current line; wheel/touch scrolling
should pause auto-follow for about five seconds, and clicking a timed line should
seek Spotify. Plain lyrics should render without fake timing. Instrumental and
not-found responses should be stated honestly. Provider failures must fall
through without breaking playback or logging a Bearer token. The LRCLIB request
must remain a direct, header-free GET so it does not trigger a CORS preflight.

Open immersive mode with its button or F, then use its lyrics button. Confirm
its artwork, title, artists, progress, lyrics, play/pause, previous/next, seek,
shuffle, and repeat remain synchronized with the main player. Test a narrow
viewport and click a lyric line there. Collapse with the on-screen control and
with Escape.

### 17. Reload and verify restoration/refresh

Reload [http://127.0.0.1:5173/](http://127.0.0.1:5173/). The authenticated
session should restore as **Spotify connected** without another authorization
prompt while the stored grant remains valid. The SDK should recreate one Spoot
device automatically and state/queue/device data should hydrate. Leaving
the app open across an access-token expiry should refresh once rather than
racing duplicate refreshes. Do not copy token values out of browser storage to
perform this check. At the six-month refresh-token boundary, a clean request to
sign in again is expected behavior.

### 18. Log out and verify credentials are cleared

Choose **Log out**. The SDK device should disconnect, playback data should clear,
and login/setup should become visible. In browser developer tools, inspect
storage by key name only and confirm `spoot.auth.tokens` is absent; do not expose
or paste any prior token value. Reload and verify Spoot stays logged out.

## Interpreting common failures

### `403 Forbidden`

First verify that the app owner still has Premium, the testing user is on the
Development Mode allowlist, the testing user has a compatible Premium plan, and
the authorization granted all requested scopes. Development Mode explicitly
returns `403` for an unallowlisted user's API calls even if login appeared to
succeed; see [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
A `403` can also represent an account, content, market, device, or playback
restriction, so preserve the Spotify error message when reporting it.

### `429 Too Many Requests`

Do not repeatedly click controls or reload. For ordinary rate limiting, wait for
the number of seconds in Spotify's `Retry-After` response header; Spotify
documents the rolling-window behavior in [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits).
Development Mode can also return `429` with reason `QUOTA_EXCEEDED`; treat that
as a quota condition, not permission to create a tight retry loop. As of July
23, 2026, Spotify counts Development Mode quota across the apps owned by the
same developer account; see Spotify's [Web API quota update](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates).
Capture the status, safe error reason, action attempted, and approximate time,
but never a Bearer token.

### Token request was blocked

Spoot first uses the browser Fetch API for Spotify's documented PKCE token
request, then retries through `XMLHttpRequest` if Fetch was intercepted before
an HTTP response arrived. If both browser transports fail, Spoot retains the
short-lived verifier so **Retry** can repeat the exchange after
`accounts.spotify.com` is allowed in the browser, extension, VPN, or DNS
filter. The safe console diagnostic reports transport names only; do not paste
the callback URL, authorization code, verifier, or token values.

### SDK is absent, not ready, or silent

- Confirm the browser supports EME/protected content and that Spotify playback
  is allowed.
- Allow autoplay after a direct user gesture; press play once after transfer.
- If Spoot is embedded cross-origin, the iframe must allow `encrypted-media`
  and `autoplay`.
- Temporarily disable privacy, anti-tracking, script-blocking, or third-party
  content extensions and retry in a clean browser profile.
- Check that the Spotify SDK script and Spotify API requests were not blocked by
  the network, DNS filter, VPN, or browser policy.

### LRCLIB certificate or network error

Spoot calls `https://lrclib.net/api` directly with a plain GET, exactly as the
preserved single-file player does. `ERR_CERT_COMMON_NAME_INVALID` means the
browser reached a host whose certificate does not belong to `lrclib.net`; it is
not a CORS response Spoot can repair. Check whether a DNS filter, ISP security
feature, VPN, antivirus, or router has replaced the domain. Allow `lrclib.net`
or use a trusted encrypted-DNS resolver, then reload. Do not disable certificate
validation and do not add a local proxy to Spoot.

### Redirect or authorization loops

Confirm the dashboard, `config.local.js`, address bar, and server all use exactly
`http://127.0.0.1:5173/`. Clear Spoot through its Log out action and begin again.
Do not share screenshots or logs that contain OAuth callback codes, token
values, or authorization parameters.
