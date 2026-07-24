import { MOCK_TRACKS } from "./mock-fixtures.js";

export class MockSearchService {
  async search(query) {
    const needle = String(query || "").trim().toLocaleLowerCase();
    const tracks = MOCK_TRACKS
      .filter((track) => !needle || `${track.title} ${track.artist}`.toLocaleLowerCase().includes(needle))
      .map((track) => ({
        id: track.id,
        type: "track",
        title: track.title,
        subtitle: track.artist,
        artworkUrl: track.artworkUrl,
        uri: track.uri,
        contextUri: null,
        externalUrl: null,
        playable: true,
      }));
    return { tracks, artists: [], albums: [], playlists: [], total: tracks.length };
  }
}
