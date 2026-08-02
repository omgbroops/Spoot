import { MOCK_TRACKS } from "./mock-fixtures.js";

export class MockPlaylistService {
  async loadPlaylist(playlistId) {
    return {
      playlist: {
        id: playlistId || "mock-playlist",
        uri: `spotify:playlist:${playlistId || "mock-playlist"}`,
        name: "Glass Signals",
        description: "A mock playlist for testing Spoot catalog navigation.",
        artworkUrl: "./src/assets/mock-cover-silver.svg",
        ownerName: "Spoot Mock",
        public: true,
        collaborative: false,
        total: 2,
        externalUrl: "https://open.spotify.com/playlist/mock-playlist",
      },
      items: MOCK_TRACKS.filter((track) => track.type === "track").map((track, position) => ({
        ...track,
        item: track,
        position,
        playable: true,
        albumId: position === 0 ? "mock-album-afterimage" : "mock-album-orbit",
        albumUri: position === 0 ? "spotify:album:mock-album-afterimage" : "spotify:album:mock-album-orbit",
      })),
      total: 2,
      durationMs: 415_000,
      unavailableReason: null,
    };
  }
}
