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
    const albums = !needle || "afterimage spool mock artists".includes(needle)
      ? [{
          id: "mock-album",
          type: "album",
          title: "Afterimage",
          subtitle: "Spool Mock Artists · 2 tracks",
          artworkUrl: MOCK_TRACKS[0]?.artworkUrl || null,
          contextUri: "spotify:album:mockalbum",
          externalUrl: null,
          playable: true,
          browseable: true,
        }]
      : [];
    return { tracks, artists: [], albums, playlists: [], total: tracks.length + albums.length };
  }
}
