# Original local player reference

`original-local-player.html` is an exact copy of the source player at
`C:\Users\Mohammed\Documents\MusicPlayer\player.html` when the Spotify-focused
Spoot conversion began on July 23, 2026.

The copy is intentionally immutable. Its SHA-256 digest is recorded beside it
so later work can verify that the reference has not drifted.

## Source inventory

The original single-file application contains the complete monochrome
liquid-glass interface and its local playback implementation:

- two-deck `HTMLAudioElement`/Web Audio playback with EQ, speed, volume,
  reverb, crossfade, and gapless handoff;
- IndexedDB storage for songs, audio blobs, artwork, playlists, settings,
  queue state, lyrics, and playback restoration;
- local and Dropbox imports, ID3 parsing, playlists, search, queue editing,
  listening statistics, sleep timers, and Media Session handlers;
- draggable Now Playing, Queue, Lyrics, and modal surfaces with saved widget
  positions and screen-edge clamping;
- desktop and responsive immersive playback layouts;
- keyboard shortcuts, hidden mode, command palette, lyric display, and lyric
  synchronization tooling.

Spoot's Spotify application may reuse the visual and interaction language, but
must never execute this reference file or initialize its local audio engine.
Legacy implementations remain here for future, separately scoped work.

The adjacent MP3 files and obsolete launchers in the original directory were
inspected but are not part of this reference import and are not copied into the
repository.
