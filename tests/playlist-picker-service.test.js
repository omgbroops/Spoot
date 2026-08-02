import test from "node:test";
import assert from "node:assert/strict";

import { SpotifyPlaylistPickerService } from "../src/js/spotify/playlist-picker-service.js";

const TRACK = { id: "Track123", uri: "spotify:track:Track123", title: "Signal Path" };

function createLibrary() {
  const sources = [
    { id: "liked-songs", kind: "liked", name: "Liked Songs", total: 10 },
    { id: "mine", kind: "playlist", name: "Mine", total: 2, owned: true, collaborative: false },
    { id: "followed", kind: "playlist", name: "Followed", total: 5, owned: false, collaborative: false },
  ];
  const invalidated = [];
  return {
    sources,
    profile: { id: "me" },
    invalidated,
    async loadSources() { return sources; },
    getCachedSource() { return undefined; },
    invalidateSource(id) { invalidated.push(id); },
    updateSource(id, patch) {
      const source = sources.find((entry) => entry.id === id);
      if (source) Object.assign(source, patch);
      return source;
    },
    addSource(source) { sources.splice(1, 0, source); },
  };
}

test("picker loads only writable destinations and caches membership checks", async () => {
  const library = createLibrary();
  let savedChecks = 0;
  let playlistChecks = 0;
  const api = {
    async checkSavedTracks() { savedChecks += 1; return [true]; },
    async getPlaylistItems() {
      playlistChecks += 1;
      return { items: [{ item: { uri: TRACK.uri } }], next: null };
    },
  };
  const service = new SpotifyPlaylistPickerService({ apiClient: api, libraryService: library });
  const destinations = await service.loadDestinations();
  assert.deepEqual(destinations.map((source) => source.id), ["liked-songs", "mine"]);

  assert.equal(await service.membership(destinations[0], TRACK), true);
  assert.equal(await service.membership(destinations[0], TRACK), true);
  assert.equal(savedChecks, 1);
  assert.equal(await service.membership(destinations[1], TRACK), true);
  assert.equal(await service.membership(destinations[1], TRACK), true);
  assert.equal(playlistChecks, 1);
});

test("picker mutations invalidate the matching session-cached source and update counts", async () => {
  const library = createLibrary();
  const calls = [];
  const api = {
    async saveTracks(ids) { calls.push(["save", ids]); },
    async removeSavedTracks(ids) { calls.push(["unsave", ids]); },
    async addPlaylistItems(id, uris) { calls.push(["add", id, uris]); },
    async removePlaylistItems(id, uris) { calls.push(["remove", id, uris]); },
  };
  const service = new SpotifyPlaylistPickerService({ apiClient: api, libraryService: library });
  const liked = library.sources[0];
  const playlist = library.sources[1];

  await service.setMembership(liked, TRACK, true);
  assert.equal(liked.total, 11);
  assert.ok(library.invalidated.includes("liked-songs"));

  await service.setMembership(playlist, TRACK, false);
  assert.equal(playlist.total, 1);
  assert.ok(library.invalidated.includes("mine"));
  assert.deepEqual(calls, [
    ["save", ["Track123"]],
    ["remove", "mine", [TRACK.uri]],
  ]);
});

test("adding a local song snapshots the current merged playlist before anchoring it", async () => {
  const library = createLibrary();
  const remote = { uri: "spotify:track:kitten", title: "Kitten" };
  const existingLocal = { uri: "spoot:local:older", localId: "older", title: "Older local" };
  library.loadSource = async () => ({ complete: true, items: [remote] });
  const calls = [];
  const hybrid = {
    async mergeCollection(id, items) {
      calls.push(["merge", id, items]);
      return [...items, existingLocal];
    },
    async setLocalTrackMembership(id, localId, desired, options) {
      calls.push(["membership", id, localId, desired, options.mergedItems]);
    },
  };
  const service = new SpotifyPlaylistPickerService({
    apiClient: {},
    libraryService: library,
    hybridService: hybrid,
  });
  const track = { id: "new-local", uri: "spoot:local:new-local", title: "New local" };

  await service.setMembership(library.sources[1], track, true);
  assert.deepEqual(calls, [
    ["merge", "mine", [remote]],
    ["membership", "mine", "new-local", true, [remote, existingLocal]],
  ]);
});
