import test from "node:test";
import assert from "node:assert/strict";

import {
  annotateSpotifyOccurrences,
  isLocalEntry,
  localEntry,
  placementsFromMerged,
} from "../src/js/local/hybrid-playlist-service.js";

test("hybrid playlists distinguish duplicate Spotify occurrences and anchor local songs between them", () => {
  const spotify = annotateSpotifyOccurrences([
    { uri: "spotify:track:dup", title: "First occurrence", position: 0 },
    { uri: "spotify:track:dup", title: "Second occurrence", position: 1 },
    { uri: "spotify:track:tail", title: "Tail", position: 2 },
  ]);
  assert.notEqual(spotify[0].hybridKey, spotify[1].hybridKey);
  assert.deepEqual(spotify.map((item) => item.spotifyPosition), [0, 1, 2]);

  const local = localEntry({ id: "local-one", uri: "spool:local:local-one", title: "Local one" });
  const placements = placementsFromMerged([spotify[0], spotify[1], local, spotify[2]]);
  assert.deepEqual(placements, [{
    localId: "local-one",
    beforeKey: spotify[2].hybridKey,
    afterKey: spotify[1].hybridKey,
    fallbackIndex: 2,
    rank: 0,
  }]);
  assert.equal(isLocalEntry(local), true);
});

test("multiple local songs keep a stable rank inside the same Spotify gap", () => {
  const spotify = annotateSpotifyOccurrences([
    { uri: "spotify:track:a", position: 0 },
    { uri: "spotify:track:b", position: 1 },
  ]);
  const first = localEntry({ id: "one", uri: "spool:local:one", title: "One" });
  const second = localEntry({ id: "two", uri: "spool:local:two", title: "Two" });
  assert.deepEqual(
    placementsFromMerged([spotify[0], first, second, spotify[1]]).map((item) => item.rank),
    [0, 1],
  );
});
