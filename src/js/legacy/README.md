# Legacy player boundary

The original local-files player is preserved at
`reference/original-local-player.html` with a recorded SHA-256 digest. It is a
reference artifact for design and future feature work, not part of Spool's
runtime module graph.

## What the reference preserves

The original single-file application contains substantially more than the
Spotify-focused Spool pass:

- two local `HTMLAudioElement` decks and a Web Audio graph;
- local-file and Dropbox import, metadata/artwork parsing, and IndexedDB media
  storage;
- local queue selection, clearing, removal, and drag reordering;
- playlist creation/editing, library search, and import workflows;
- lyrics storage, editing, synchronization, and immersive lyrics;
- volume, playback speed, EQ presets/bands, reverb, crossfade, and gapless
  playback;
- sleep timer, listening statistics, Media Session integration, hidden mode,
  keyboard controls, and playback restoration;
- the draggable glass widgets, bottom dock, modals, ambient artwork, and
  responsive immersive layout inherited by Spool.

The preserved file should not be modified to make Spotify work. Changes belong
in modular Spool source; the reference hash exists so accidental drift is
detectable.

## What is active now

Spool carries forward the visual shell and the interactions that have a clear
Spotify-safe mapping: Now Playing, the Spotify queue renderer, draggable widget
placement, main and immersive transport controls, responsive immersive mode,
keyboard shortcuts, modal treatment, connection/status surfaces, Spotify
Library/search browsing, and fetched lyrics with synchronized highlighting.

The following preserved surfaces are deliberately dormant in this pass:

- local file and Dropbox import;
- recommendations and Spotify DJ;
- playlist creation or editing;
- lyrics editing or manual synchronization;
- Sound controls: volume, speed, EQ, reverb, crossfade, and gapless playback;
- sleep timer and listening statistics;
- queue clear, arbitrary remove, reorder, and other full queue editing.

Dormant UI must remain disabled or produce a small explanatory message. It must
not display success, mutate a local imitation of Spotify state, or reach any
audio engine. Live lyrics may update only their existing display surfaces and
seek through the selected Spotify controller.

## Why the local engine never executes

The reference is outside the `src/js` module tree and `index.html` imports only
Spool's modular `app.js`. No runtime module imports or embeds the reference.
Consequently its script blocks, audio decks, Web Audio nodes, timers, event
handlers, and `musicplayer` IndexedDB calls are never evaluated.

This is a functional boundary, not merely a CSS-disabled state. Starting the
old engine in the background would create competing playback, double-handle
transport gestures, expose sound controls that cannot validly process Spotify's
protected stream, and mix local library persistence with OAuth credentials.
Spool's static-safety tests check runtime source for accidental local audio/Web
Audio initialization and reuse of the legacy database name.

## Rules for a future local-player pass

Local playback can return only as separately scoped work with these boundaries:

- introduce a controller-compatible local engine adapter instead of copying
  the original global script into `app.js`;
- require an explicit user choice of playback engine before initializing it;
- guarantee that Spotify and local audio lifecycles are mutually exclusive;
- route transport/UI gestures to one selected controller only;
- use a new `spool.local.*` storage namespace rather than reopening or silently
  migrating `musicplayer`;
- keep OAuth/token storage isolated from local media and preferences;
- design queue semantics honestly for each engine instead of pretending
  Spotify supports local clear/remove/reorder behavior;
- add focused migration, persistence, media cleanup, and engine-switch tests;
- preserve the immutable reference and update this boundary document as
  capabilities deliberately graduate from dormant to active.

Until that work is commissioned and tested, the correct behavior is for legacy
controls to remain present, honest, and inert.
