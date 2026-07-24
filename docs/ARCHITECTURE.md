# Spool architecture

Spool is a static browser application with one directional playback pipeline:

```text
PKCE auth -> token provider -> Spotify Web API + Web Playback SDK
          -> playback controller -> normalized state -> UI renderers
```

Mock mode replaces the Spotify-facing controller with a deterministic adapter
that exposes the same application-level events and commands. It does not load a
separate demo page or bypass the production UI.

## Runtime entry and configuration

`index.html` contains the preserved player shell and imports only
`src/js/app.js` as an ES-module entry point. `app.js` loads the public runtime
configuration, chooses live or explicit mock mode, creates one controller, and
wires it to the UI.

`src/js/config.js` owns the nine requested Spotify scopes and validates the
development origin. Live mode dynamically imports `config.local.js`, falling
back to `config.example.js` only to show an unconfigured state. Mock mode is
selected only when the URL contains `mock=1`; the optional `scenario` parameter
selects one of the finite mock fixtures.

`config.local.js` contains a public Client ID, exact redirect URI, and optional
device name. It is local-only and must never contain a Client Secret.

## Authentication and token authority

`auth/pkce.js` generates the verifier, SHA-256 challenge, and OAuth state with
Web Crypto. `auth/spotify-auth.js` owns the Authorization Code with PKCE
transaction and is the only authority allowed to exchange, refresh, return, or
clear Spotify tokens.

The OAuth verifier/state transaction is short-lived and state is compared
before a callback code is accepted. Authorization runs in a popup while the
original loopback-origin tab remains open. When Spotify returns, the same-origin
popup passes its callback URL to that original tab with direct `postMessage`
and a `BroadcastChannel` fallback if the cross-site round trip severed
`window.opener`. Only the tab that owns the callback state accepts a broadcast.
Its original `SpotifyAuth` instance validates state and exchanges the code
using the verifier it created. The token exchange follows Spotify's documented
form request through Fetch, with an `XMLHttpRequest` fallback for fetch-only
browser interception. A failure before either transport receives an HTTP
response retains the verifier for an explicit retry. The popup closes after
the opener reports the result for its exact state. Direct callback fallbacks
remove authorization parameters with `history.replaceState`.
Access-token refresh begins shortly before expiry and concurrent callers share
one in-flight refresh promise. A rejected `invalid_grant` clears the unusable
grant and returns the UI to authorization. Both the API client and
`Spotify.Player.getOAuthToken` request credentials from this same provider;
neither caches a competing token.

## Spotify boundary

The live controller composes two Spotify adapters:

- The centralized Web API client attaches the current Bearer token and owns all
  raw Spotify API `fetch` calls. It handles empty `204` responses, safe JSON
  parsing, one forced-refresh retry after `401`, bounded `429` handling using
  `Retry-After`, readable `403`/restriction errors, and `AbortSignal` where the
  caller can cancel work. Playback-state requests are deduplicated rather than
  polled aggressively. It also owns device discovery/transfer and the current
  profile, saved-track, playlist, `/playlists/{id}/items`, and catalog-search
  requests.
- `spotify/playback-sdk.js` loads the official SDK script once and creates one
  `Spotify.Player`. It translates `ready`, `not_ready`,
  `player_state_changed`, initialization, authentication, account, playback,
  and autoplay events into application events. It owns local SDK commands such
  as toggle, previous, next, seek, and browser-device volume. A bounded
  reconnect reuses the same player object after `not_ready` instead of creating
  duplicate Connect devices.

`spotify/library-service.js` owns Spotify-specific library pagination and
capability classification. It synthesizes Liked Songs from `/me/tracks`,
flattens `/me/playlists`, and permits drilldown only for owned or collaborative
playlists. It walks every readable item page sequentially so song count and
duration describe the complete collection. A playlist-item `403` becomes a
stable metadata-only state. Null, local, restricted, unplayable, and non-track
rows remain visible but cannot dispatch browser playback.

`spotify/search-service.js` normalizes Spotify's track, artist, album, and
playlist groups into one small renderer contract. Track results retain their
album context; other playable results carry their own context URI.

`lyrics/lyrics-service.js` is a separate, read-only metadata boundary adapted
from BetterLyrics' provider strategy. It tries synchronized SpicyLyrics data,
Spotify color-lyrics data, and LRCLIB before falling back to static lyrics. Its
only authority is the existing short-lived Spotify access token; the Spotify
color-lyrics request and SpicyLyrics' required `SpicyLyrics-WebAuth` header use
that access token, while LRCLIB receives no Spotify credential. The refresh
token never leaves the token provider and diagnostics never include either
token. Because Spool remains a static browser app, each provider must permit
the browser request directly. There is intentionally no Spotify
Desktop/Spicetify companion bridge, loopback lyrics service, or desktop
credential extraction.

The controller chooses exactly one path for each command. SDK methods are used
for commands best targeted at the browser player; device-level operations such
as transfer, shuffle, repeat, queue reads, and add-to-queue go through the Web
API. The same user command is not sent through both interfaces.

## Controller and normalized state

The UI talks only to the application-level controller contract:

```text
connect()             disconnect()          transferHere()
transferToDevice(id)  playNow(uri, context)  playQueueItem(entry)
refreshDevices()
togglePlay()          previous()            next()
seek(positionMs)      setShuffle(enabled)   cycleRepeat()
refreshState()        refreshQueue()        addToQueue(uri)
refreshVolume()       setVolume(0..1)
```

The controller reconciles SDK `player_state_changed` events (the primary signal
for playback in Spool) with Web API hydration and recovery. SDK and API payloads
are converted to one normalized model before reaching the UI. The model carries
device readiness/activity, Spotify URI and ID, title, artist names, album,
artwork, duration and position in milliseconds, paused/playing, shuffle, repeat,
content type, restrictions, and an authoritative timestamp.

Visible progress is interpolated locally from the last authoritative position
and timestamp. It stops while paused, clamps to duration, and resynchronizes on
every Spotify state event; animation never becomes a reason to poll Spotify.
Queue payloads are separately normalized into current and upcoming items with
track/episode-safe metadata. Spotify exposes neither queue-entry identifiers
nor a jump-to-occurrence endpoint. Spool therefore reaches a clicked upcoming
entry with the documented Next operation, once per preceding occurrence, which
preserves Spotify's queue and playback context. A final state refresh detects a
queue that changed mid-command. Episodes, local files, and restricted rows
remain inert. Library playback instead uses Start Playback with the playlist
`context_uri` and its exact position; Liked Songs uses the loaded URI sequence
because Spotify exposes no context URI for that collection.

## UI boundary

UI modules cache elements, render connection status, Now Playing, queue,
Library, search, lyrics, and immersive mode, and translate gestures into
controller methods. Main and immersive controls share the same normalized
state, so neither becomes a second source of truth. The lyrics renderer also
shares the controller's interpolated millisecond position, supports timed-line
seeking, and pauses auto-follow after manual scrolling. Widget dragging handles
pointer ownership, front ordering, screen-edge clamping, responsive defaults,
and persisted positions.

The top status is hidden while Spool is active. When another Spotify Connect
device is active it displays the returned device name (or a neutral fallback)
and offers **Listen here**. Settings renders the current device list as a custom
glass listbox; restricted or identifier-less devices remain disabled.

Inactive legacy surfaces are identified in markup and resolve to a disabled
state or an explanatory toast. They never dispatch playback commands. Browser
volume is the only live Sound control; speed, EQ, reverb, crossfade, and gapless
remain isolated. Spool owns an optional Media Session adapter so the existing
system-media and headphone-skip settings can change without competing with the
SDK's disabled built-in Media Session integration.

## Storage ownership

Spool uses small, explicit browser-storage namespaces:

| Namespace/key | Storage | Owner | Data |
| --- | --- | --- | --- |
| `spool.auth.tokens` | `localStorage` | token store | access/refresh tokens, access and refresh expiry timestamps, authorization time, token type, granted scopes |
| `spool.auth.pkce` | mirrored `sessionStorage` + `localStorage` | Spotify auth | capped, short-lived verifier/state transactions keyed by OAuth state; the opener-owned auth instance handles popup callbacks, the persistent copy supports direct/fresh-tab fallback, and the matching entry is consumed from both stores |
| `spool.ui.widget-positions` | `localStorage` | `ui/widgets.js` | saved `{x, y}` positions for the Now Playing, queue, and lyrics widgets |
| `spool.ui.preferences` | `localStorage` | `app.js` | queue, dock, lyrics-widget visibility, Media Session visibility, and media-key skip preference |

Spotify playback state, device lists, Library pages, search results, queue data,
temporary lyrics/artwork caches, and audio are not persisted as a local media library. The
application never opens or reuses the original
`musicplayer` IndexedDB database.

Because this is a static browser client, tokens are stored in the user's browser
rather than on a backend. This is appropriate only for the stated personal
local-use boundary: keep the app free of third-party scripts, never log tokens,
and clear credentials on logout or unrecoverable authorization failure.

## Mock boundary

`mock/mock-playback-controller.js` implements the controller-shaped contract
using `mock/mock-fixtures.js`. `?mock=1&scenario=<name>` selects `default`,
`paused`, `empty-queue`, `auth-error`, `sdk-error`, `rate-limit`, or `null`.
Mock state drives the real renderers, transport handlers, progress path, queue,
device picker, browser volume, Library/search/lyrics renderers, widgets, and
immersive view.
Mock mode makes UI and orchestration testable; it
does not prove Spotify authorization, SDK provisioning, protected audio, or
real-account restrictions.

## Legacy isolation

`reference/original-local-player.html` is an immutable artifact, not a runtime
module. Nothing imports, embeds, navigates to, or executes it from Spool's entry
point. Runtime source contains no constructor path for the original
`HTMLAudioElement` decks, Web Audio graph, local import pipeline, or
`musicplayer` database. Static safety tests defend that boundary.

Future local playback must enter as an explicitly selected controller/engine
adapter with a new storage namespace and lifecycle. It must never initialize
alongside Spotify playback or allow one UI gesture to reach both engines. The
detailed legacy policy is in [`src/js/legacy/README.md`](../src/js/legacy/README.md).
