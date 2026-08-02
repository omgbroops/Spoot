import test from "node:test";
import assert from "node:assert/strict";

import {
  annotateSpotifyOccurrences,
  hybridUpcomingItems,
  isLocalEntry,
  localEntry,
  makeRoomForPrependedPlacement,
  nextHybridIndex,
  placementsFromMerged,
  previousHybridIndex,
} from "../src/js/local/hybrid-playlist-service.js";

test("hybrid playlists distinguish duplicate Spotify occurrences and anchor local songs between them", () => {
  const spotify = annotateSpotifyOccurrences([
    { uri: "spotify:track:dup", title: "First occurrence", position: 0 },
    { uri: "spotify:track:dup", title: "Second occurrence", position: 1 },
    { uri: "spotify:track:tail", title: "Tail", position: 2 },
  ]);
  assert.notEqual(spotify[0].hybridKey, spotify[1].hybridKey);
  assert.deepEqual(spotify.map((item) => item.spotifyPosition), [0, 1, 2]);

  const local = localEntry({ id: "local-one", uri: "spoot:local:local-one", title: "Local one" });
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
  const first = localEntry({ id: "one", uri: "spoot:local:one", title: "One" });
  const second = localEntry({ id: "two", uri: "spoot:local:two", title: "Two" });
  assert.deepEqual(
    placementsFromMerged([spotify[0], first, second, spotify[1]]).map((item) => item.rank),
    [0, 1],
  );
});

test("hybrid transport preserves merged order across previous, natural endings, and repeat", () => {
  const items = ["kitten", "opm-babi", "one-call-away"];
  assert.equal(nextHybridIndex(items, 0), 1);
  assert.equal(previousHybridIndex(items, 1), 0);
  assert.equal(previousHybridIndex(items, 2), 1);
  assert.equal(nextHybridIndex(items, 2), null);
  assert.equal(nextHybridIndex(items, 2, { repeatMode: "context", fromEnded: true }), 0);
  assert.equal(nextHybridIndex(items, 1, { repeatMode: "track", fromEnded: true }), 1);
  assert.deepEqual(
    hybridUpcomingItems(items, 0, { repeatMode: "context" }),
    ["opm-babi", "one-call-away", "kitten"],
  );
});

test("a newly liked local song is representable before every existing row", () => {
  const spotify = annotateSpotifyOccurrences([{ uri: "spotify:track:kitten", position: 0 }]);
  const older = localEntry({ id: "older", uri: "spoot:local:older" });
  const newest = localEntry({ id: "newest", uri: "spoot:local:newest" });
  const placements = placementsFromMerged([newest, older, spotify[0]]);
  assert.deepEqual(placements.map((item) => item.localId), ["newest", "older"]);
  assert.equal(placements[0].beforeKey, spotify[0].hybridKey);
});

test("repeated local likes make room at index zero for the newest song", () => {
  assert.deepEqual(
    makeRoomForPrependedPlacement([
      { localId: "older", fallbackIndex: 0, rank: 0 },
      { localId: "oldest", fallbackIndex: 1, rank: 0 },
    ]).map(({ localId, fallbackIndex }) => ({ localId, fallbackIndex })),
    [
      { localId: "older", fallbackIndex: 1 },
      { localId: "oldest", fallbackIndex: 2 },
    ],
  );
});
